"""
视频流处理管道模块

整合所有检测模块，处理视频流并输出结果。

Author: SSP Team
"""

from __future__ import annotations

import logging
import time
from typing import Optional, Callable, Any, Union
from dataclasses import asdict
import threading

import cv2
import numpy as np

from .types import (
    FocusState,
    WarningReason,
    FrameResult,
    HeadPoseData,
    EyeData,
    PipelineConfig,
    SystemInfo
)
from .detector import CoreDetector, FaceDetectorLite
from .ear import EARCalculator
from .focus_fsm import SessionManager, FocusFSM
from .websocket_server import WebSocketServer, WSMessageType


logger = logging.getLogger(__name__)


class FocusPipeline:
    """专注检测流水线
    
    整合人脸检测、头部姿态估计、EAR 计算和状态机，
    提供完整的视频流处理能力。
    """
    
    def __init__(
        self,
        config: Optional[PipelineConfig] = None,
        use_cuda: bool = True,
        detector_type: str = "retinaface",
        enable_visualization: bool = True
    ):
        """
        初始化流水线
        
        Args:
            config: 流水线配置
            use_cuda: 是否使用 CUDA
            detector_type: 检测器类型
            enable_visualization: 是否启用可视化
        """
        self.config = config or PipelineConfig()
        self.use_cuda = use_cuda
        self.detector_type = detector_type
        self.enable_visualization = enable_visualization
        
        # 帧计数
        self._frame_id = 0
        self._start_time = time.time()
        self._last_frame_time = time.time()
        self._fps = 0.0
        
        # 回调函数
        self._on_result_callback: Optional[Callable] = None
        self._on_state_change_callback: Optional[Callable] = None
        self._on_milestone_callback: Optional[Callable] = None
        
        # WebSocket 服务器
        self._ws_server: Optional[WebSocketServer] = None
        
        # 初始化组件
        self._init_components()
        
        logger.info(f"FocusPipeline initialized: CUDA={use_cuda}, detector={detector_type}")
    
    def _init_components(self) -> None:
        """初始化所有组件"""
        # 1. 核心检测器
        logger.info("Initializing core detector...")
        self.detector = CoreDetector(
            config=self.config,
            use_cuda=self.use_cuda,
            detector_type=self.detector_type
        )
        
        # 2. EAR 计算器
        logger.info("Initializing EAR calculator...")
        self.ear_calculator = EARCalculator(self.config)
        
        # 3. 会话管理器
        logger.info("Initializing session manager...")
        self.session_manager = SessionManager(self.config)
        
        # 注册状态变化回调
        self.session_manager.register_callback(
            "state_change",
            self._on_state_change
        )
        self.session_manager.register_callback(
            "milestone",
            self._on_milestone
        )
    
    def _on_state_change(self, old_state: FocusState, new_state: FocusState) -> None:
        """状态变化回调"""
        logger.info(f"State changed: {old_state.value} -> {new_state.value}")
        
        if self._on_state_change_callback:
            self._on_state_change_callback(old_state, new_state)
    
    def _on_milestone(self, milestone: dict) -> None:
        """里程碑回调"""
        logger.info(f"Milestone reached: {milestone}")
        
        if self._on_milestone_callback:
            self._on_milestone_callback(milestone)
    
    def set_on_result(self, callback: Callable) -> None:
        """设置结果回调"""
        self._on_result_callback = callback
    
    def set_on_state_change(self, callback: Callable) -> None:
        """设置状态变化回调"""
        self._on_state_change_callback = callback
    
    def set_on_milestone(self, callback: Callable) -> None:
        """设置里程碑回调"""
        self._on_milestone_callback = callback
    
    def get_system_info(self) -> SystemInfo:
        """获取系统信息"""
        return self.detector.get_system_info()
    
    def warmup(self) -> None:
        """预热模型"""
        logger.info("Warming up models...")
        self.detector.warmup()
        logger.info("Warmup complete")
    
    def process_frame(self, image: np.ndarray) -> dict:
        """
        处理单帧
        
        Args:
            image: 输入图像 (BGR 格式)
            
        Returns:
            处理结果字典
        """
        current_time = time.time()
        delta_time = current_time - self._last_frame_time
        self._last_frame_time = current_time
        
        # 更新 FPS
        if delta_time > 0:
            self._fps = 1.0 / delta_time
        
        frame_start = time.time()
        
        # 1. 人脸检测
        detection = self.detector.detect_face(image)
        
        has_face = detection is not None
        pitch = yaw = roll = 0.0
        ear_avg = 1.0
        consecutive_closed = 0
        
        if has_face:
            # 2. 头部姿态
            head_pose_data = detection["head_pose"]
            pitch = head_pose_data.pitch
            yaw = head_pose_data.yaw
            roll = head_pose_data.roll
            
            # 3. EAR 计算
            eye_data = self.ear_calculator.get_eye_data(detection["landmarks_106"])
            ear_avg = eye_data.ear_avg
            consecutive_closed = eye_data.consecutive_closed
        
        # 4. 状态机处理
        result = self.session_manager.process_frame(
            has_face=has_face,
            pitch=pitch,
            yaw=yaw,
            roll=roll,
            ear_avg=ear_avg,
            consecutive_closed=consecutive_closed,
            frame_id=self._frame_id,
            timestamp=current_time,
            delta_time=delta_time
        )
        
        # 计算总处理时间
        total_time = (time.time() - frame_start) * 1000
        
        # 构建完整结果
        frame_result = {
            "frame_id": self._frame_id,
            "timestamp": current_time,
            "fps": round(self._fps, 1),
            "has_face": has_face,
            "face_confidence": detection["confidence"] if has_face else 0.0,
            "head_pose": {
                "pitch": round(pitch, 2),
                "yaw": round(yaw, 2),
                "roll": round(roll, 2)
            },
            "eye": {
                "ear_avg": round(ear_avg, 4),
                "consecutive_closed": consecutive_closed
            },
            "processing_time_ms": round(total_time, 2),
            **result
        }
        
        # 触发回调
        if self._on_result_callback:
            self._on_result_callback(frame_result)
        
        # WebSocket 广播
        if self._ws_server and self._ws_server.is_running:
            asyncio_run(self._ws_server.broadcast_frame_result(frame_result))
        
        self._frame_id += 1
        
        return frame_result
    
    async def process_frame_async(self, image: np.ndarray) -> dict:
        """异步处理单帧"""
        return self.process_frame(image)
    
    def process_camera(
        self,
        camera_id: int = 0,
        flip_horizontal: bool = True,
        max_frames: int = 0,
        window_name: str = "SSP - Smart Study Spot"
    ) -> None:
        """
        处理摄像头流
        
        Args:
            camera_id: 摄像头 ID
            flip_horizontal: 是否水平翻转
            max_frames: 最大帧数 (0 表示无限)
            window_name: 显示窗口名称
        """
        cap = cv2.VideoCapture(camera_id)
        
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open camera {camera_id}")
        
        logger.info(f"Camera opened: {camera_id}")
        
        frame_count = 0
        
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                
                # 翻转
                if flip_horizontal:
                    frame = cv2.flip(frame, 1)
                
                # 处理帧
                result = self.process_frame(frame)
                
                # 可视化
                if self.enable_visualization:
                    vis_frame = self._visualize_frame(frame, result)
                    cv2.imshow(window_name, vis_frame)
                    
                    key = cv2.waitKey(1) & 0xFF
                    if key == ord('q') or key == 27:
                        logger.info("User pressed 'q' to quit")
                        break
                
                frame_count += 1
                if max_frames > 0 and frame_count >= max_frames:
                    break
                    
        finally:
            cap.release()
            if self.enable_visualization:
                cv2.destroyAllWindows()
        
        logger.info(f"Camera processing complete. Total frames: {frame_count}")
    
    def process_video(
        self,
        video_path: str,
        output_path: Optional[str] = None,
        flip_horizontal: bool = False,
        max_frames: int = 0,
        window_name: str = "SSP - Smart Study Spot"
    ) -> dict:
        """
        处理视频文件
        
        Args:
            video_path: 视频文件路径
            output_path: 输出视频路径 (可选)
            flip_horizontal: 是否水平翻转
            max_frames: 最大帧数
            window_name: 显示窗口名称
            
        Returns:
            处理统计
        """
        cap = cv2.VideoCapture(video_path)
        
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {video_path}")
        
        # 获取视频信息
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        logger.info(f"Video info: {width}x{height}, {fps} FPS, {total_frames} frames")
        
        # 创建视频写入器
        writer = None
        if output_path:
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
        
        frame_count = 0
        start_time = time.time()
        
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                
                # 翻转
                if flip_horizontal:
                    frame = cv2.flip(frame, 1)
                
                # 处理帧
                result = self.process_frame(frame)
                
                # 可视化
                if self.enable_visualization or writer:
                    vis_frame = self._visualize_frame(frame, result)
                    
                    if writer:
                        writer.write(vis_frame)
                    
                    if self.enable_visualization:
                        cv2.imshow(window_name, vis_frame)
                        
                        key = cv2.waitKey(1) & 0xFF
                        if key == ord('q') or key == 27:
                            break
                
                frame_count += 1
                
                if max_frames > 0 and frame_count >= max_frames:
                    break
                
                if frame_count % 100 == 0:
                    elapsed = time.time() - start_time
                    logger.info(f"Processed {frame_count}/{total_frames} frames ({elapsed:.1f}s)")
                    
        finally:
            cap.release()
            if writer:
                writer.release()
            if self.enable_visualization:
                cv2.destroyAllWindows()
        
        elapsed = time.time() - start_time
        
        stats = {
            "total_frames": frame_count,
            "elapsed_seconds": round(elapsed, 2),
            "avg_fps": round(frame_count / elapsed, 1) if elapsed > 0 else 0,
            "session_summary": self.get_session_summary()
        }
        
        logger.info(f"Video processing complete: {stats}")
        return stats
    
    def _visualize_frame(self, frame: np.ndarray, result: dict) -> np.ndarray:
        """可视化帧"""
        vis = frame.copy()
        h, w = frame.shape[:2]
        
        # 状态颜色
        state = result.get("state", "idle")
        state_colors = {
            "idle": (128, 128, 128),
            "focused": (0, 255, 0),
            "warning": (0, 255, 255),
            "interrupted": (0, 0, 255)
        }
        color = state_colors.get(state, (255, 255, 255))
        
        # 绘制状态信息
        info_y = 30
        line_height = 25
        
        # 状态
        cv2.putText(
            vis,
            f"State: {state.upper()}",
            (10, info_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            color,
            2
        )
        info_y += line_height
        
        # FPS
        cv2.putText(
            vis,
            f"FPS: {result.get('fps', 0):.1f}",
            (10, info_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1
        )
        info_y += line_height
        
        # 头部姿态
        hp = result.get("head_pose", {})
        cv2.putText(
            vis,
            f"Pitch: {hp.get('pitch', 0):.1f}  Yaw: {hp.get('yaw', 0):.1f}  Roll: {hp.get('roll', 0):.1f}",
            (10, info_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1
        )
        info_y += line_height
        
        # EAR
        eye = result.get("eye", {})
        cv2.putText(
            vis,
            f"EAR: {eye.get('ear_avg', 0):.4f}  Closed: {eye.get('consecutive_closed', 0)}",
            (10, info_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1
        )
        info_y += line_height
        
        # 积分
        stats = result.get("stats", {})
        cv2.putText(
            vis,
            f"Points: {stats.get('total_points', 0)}  Focus: {stats.get('focus_time_min', 0):.1f} min",
            (10, info_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1
        )
        info_y += line_height
        
        # 宽容时间
        grace = result.get("grace_remaining", 0)
        if grace > 0:
            cv2.putText(
                vis,
                f"Grace: {grace:.1f}s",
                (10, info_y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 255),
                1
            )
        
        # 绘制边框 (指示状态)
        border_thickness = 3 if state == "focused" else 1
        cv2.rectangle(vis, (0, 0), (w - 1, h - 1), color, border_thickness)
        
        return vis
    
    def get_session_summary(self) -> dict:
        """获取会话摘要"""
        return self.session_manager.get_session_summary()
    
    def reset_session(self) -> None:
        """重置会话"""
        self.session_manager.reset_session()
        self._frame_id = 0
    
    def get_config(self) -> dict:
        """获取配置"""
        return {
            "pitch_threshold": self.config.pitch_threshold,
            "yaw_threshold": self.config.yaw_threshold,
            "ear_threshold": self.config.ear_threshold,
            "grace_period_seconds": self.config.grace_period_seconds,
            "points_per_minute": self.config.points_per_minute,
            "use_cuda": self.use_cuda,
            "detector_type": self.detector_type
        }
    
    def update_config(self, config: dict) -> None:
        """更新配置"""
        if "pitch_threshold" in config:
            self.config.pitch_threshold = config["pitch_threshold"]
        if "yaw_threshold" in config:
            self.config.yaw_threshold = config["yaw_threshold"]
        if "ear_threshold" in config:
            self.config.ear_threshold = config["ear_threshold"]
        if "grace_period_seconds" in config:
            self.config.grace_period_seconds = config["grace_period_seconds"]
        if "points_per_minute" in config:
            self.config.points_per_minute = config["points_per_minute"]
        
        logger.info(f"Config updated: {config}")
    
    def start_websocket_server(
        self,
        host: str = "0.0.0.0",
        port: int = 8765,
        max_connections: int = 10
    ) -> WebSocketServer:
        """启动 WebSocket 服务器"""
        if self._ws_server and self._ws_server.is_running:
            logger.warning("WebSocket server already running")
            return self._ws_server
        
        self._ws_server = WebSocketServer(
            host=host,
            port=port,
            max_connections=max_connections
        )
        
        # 设置帧结果广播
        async def on_connect(client, message):
            # 连接时发送当前会话摘要
            return WSMessageType.SESSION_SUMMARY, self.get_session_summary()
        
        self._ws_server.register_handler(WSMessageType.GET_SUMMARY, on_connect)
        
        # 启动服务器
        import asyncio
        asyncio.run(self._ws_server.start())
        
        return self._ws_server
    
    def stop_websocket_server(self) -> None:
        """停止 WebSocket 服务器"""
        if self._ws_server:
            import asyncio
            asyncio.run(self._ws_server.stop())
            self._ws_server = None


def asyncio_run(coro):
    """运行异步协程"""
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        # 如果已经在事件循环中，创建任务
        future = asyncio.ensure_future(coro)
        return future
    except RuntimeError:
        # 没有运行中的事件循环
        return asyncio.run(coro)


class VideoStreamServer:
    """视频流服务器 - 提供 MJPEG 视频流"""
    
    def __init__(self, pipeline: FocusPipeline, host: str = "0.0.0.0", port: int = 8554):
        """
        初始化视频流服务器
        
        Args:
            pipeline: 专注检测流水线
            host: 监听地址
            port: 监听端口
        """
        self.pipeline = pipeline
        self.host = host
        self.port = port
        self._frame = None
        self._running = False
    
    def update_frame(self, frame: np.ndarray) -> None:
        """更新当前帧"""
        result = self.pipeline.process_frame(frame)
        self._frame = self.pipeline._visualize_frame(frame, result)
    
    def generate_frames(self):
        """生成帧用于 MJPEG 流"""
        while self._running:
            if self._frame is not None:
                ret, buffer = cv2.imencode('.jpg', self._frame)
                if ret:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' +
                           buffer.tobytes() + b'\r\n')
            time.sleep(0.03)  # ~30 FPS
    
    async def start(self) -> None:
        """启动服务器"""
        self._running = True
        logger.info(f"Video stream server starting on {self.host}:{self.port}")
        # Note: 需要结合 FastAPI 或其他 HTTP 服务器使用
        # from fastapi.responses import StreamingResponse
        # return StreamingResponse(self.generate_frames(), media_type='multipart/x-mixed-replace; boundary=frame')
    
    def stop(self) -> None:
        """停止服务器"""
        self._running = False
        logger.info("Video stream server stopped")
