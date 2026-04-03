"""
完整工作流管道

整合所有模块，实现完整的专注检测工作流：

阶段一：系统初始化与用户身份绑定 (Auth)
阶段二：实时感知与数据提取循环 (Perception Loop)
阶段三：柔性状态机裁决 (State Evaluation)
阶段四：积分结算与数据持久化 (Reward)

Author: SSP Team
"""

from __future__ import annotations

import logging
import time
from typing import Optional, Callable, Any
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime

import cv2
import numpy as np

from .types import (
    FocusState,
    WarningReason,
    HeadPoseData,
    EyeData,
    PipelineConfig,
    SystemInfo,
    FrameResult
)
from .model_manager import ModelManager
from .auth import IdentityAuthenticator, UserProfile, VerificationResult
from .ear import EARCalculator, EYEIndexConfig
from .stream_controller import FrameController, FaceSelector, AntiSpoofingMonitor
from .focus_fsm import SessionManager
from .websocket_server import WebSocketServer, WSMessage


logger = logging.getLogger(__name__)


class WorkFlowPhase(Enum):
    """工作流阶段"""
    IDLE = "idle"                    # 空闲/未初始化
    AUTH = "auth"                   # 阶段一：身份绑定
    PERCEPTION = "perception"       # 阶段二：实时感知
    EVALUATION = "evaluation"       # 阶段三：状态裁决
    REWARD = "reward"              # 阶段四：积分结算
    TERMINATED = "terminated"      # 会话终止


@dataclass
class WorkFlowState:
    """工作流状态"""
    phase: WorkFlowPhase = WorkFlowPhase.IDLE
    session_id: str = ""
    user_id: Optional[str] = None
    seat_id: Optional[str] = None
    is_active: bool = False
    start_time: float = 0.0
    frame_count: int = 0
    processed_frames: int = 0
    last_update: float = 0.0


@dataclass
class PerceptionResult:
    """感知结果"""
    has_face: bool = False
    bbox: Optional[np.ndarray] = None
    face_confidence: float = 0.0
    
    # 头部姿态
    pitch: float = 0.0
    yaw: float = 0.0
    roll: float = 0.0
    
    # 眼部状态
    ear_left: float = 0.0
    ear_right: float = 0.0
    ear_avg: float = 0.0
    
    # 身份认证
    embedding: Optional[np.ndarray] = None
    identity_verified: bool = False
    identity_similarity: float = 0.0
    is_cheating: bool = False
    
    # 性能
    detection_time_ms: float = 0.0
    total_time_ms: float = 0.0
    
    def to_dict(self) -> dict:
        return {
            "has_face": self.has_face,
            "face_confidence": round(self.face_confidence, 3),
            "head_pose": {
                "pitch": round(self.pitch, 2),
                "yaw": round(self.yaw, 2),
                "roll": round(self.roll, 2)
            },
            "eye": {
                "ear_left": round(self.ear_left, 4),
                "ear_right": round(self.ear_right, 4),
                "ear_avg": round(self.ear_avg, 4)
            },
            "identity": {
                "verified": self.identity_verified,
                "similarity": round(self.identity_similarity, 4),
                "is_cheating": self.is_cheating
            },
            "detection_time_ms": round(self.detection_time_ms, 2),
            "total_time_ms": round(self.total_time_ms, 2)
        }


class FocusWorkFlow:
    """专注检测完整工作流
    
    四阶段工作流:
    1. AUTH: 初始化模型，绑定用户身份
    2. PERCEPTION: 抽帧检测，提取数据
    3. EVALUATION: 状态机裁决
    4. REWARD: 积分结算
    """
    
    def __init__(
        self,
        config: Optional[PipelineConfig] = None,
        use_cuda: bool = True,
        target_fps: float = 4.0,
        enable_visualization: bool = True
    ):
        """
        初始化工作流
        
        Args:
            config: 流水线配置
            use_cuda: 是否使用 CUDA
            target_fps: 目标处理帧率 (默认 4 FPS，降低功耗)
            enable_visualization: 是否启用可视化
        """
        self.config = config or PipelineConfig()
        self.use_cuda = use_cuda
        self.target_fps = target_fps
        self.enable_visualization = enable_visualization
        
        # 工作流状态
        self.workflow_state = WorkFlowState()
        
        # 模型管理器
        self.model_manager: Optional[ModelManager] = None
        
        # 身份认证器
        self.authenticator = IdentityAuthenticator(
            similarity_threshold=0.6,
            cheating_threshold=0.5,
            verification_interval=60.0  # 每60秒验证一次
        )
        
        # EAR 计算器
        self.ear_calculator = EARCalculator(self.config)
        
        # 帧控制器 (抽帧)
        self.frame_controller = FrameController(target_fps=target_fps)
        
        # 人脸选择器
        self.face_selector = FaceSelector()
        
        # 防作弊监控
        self.anti_spoofing = AntiSpoofingMonitor()
        
        # 会话管理器
        self.session_manager: Optional[SessionManager] = None
        
        # WebSocket
        self.ws_server: Optional[WebSocketServer] = None
        
        # 回调
        self._callbacks = {
            "phase_change": [],
            "state_change": [],
            "milestone": [],
            "interruption": [],
            "cheating_detected": [],
            "frame_result": []
        }
        
        # 上一帧时间
        self._last_frame_time = time.time()
        self._last_verification_time = time.time()
        
        logger.info(f"FocusWorkFlow initialized: CUDA={use_cuda}, target_fps={target_fps}")
    
    def initialize(self) -> SystemInfo:
        """
        阶段一：初始化系统，加载模型
        
        加载:
        - RetinaFace (人脸检测)
        - ArcFace (512维特征向量)
        - Landmark106 (106点关键点)
        - HeadPose (3D头部姿态)
        """
        self.workflow_state.phase = WorkFlowPhase.AUTH
        
        logger.info("=" * 60)
        logger.info("PHASE 1: AUTH - Initializing System")
        logger.info("=" * 60)
        
        # 初始化模型管理器
        self.model_manager = ModelManager(
            use_cuda=self.use_cuda,
            detector_type="retinaface",
            recognition_model="arcface"
        )
        
        # 加载所有模型
        logger.info("Loading models...")
        self.model_manager.load_all_models()
        
        # 预热
        logger.info("Warming up models...")
        self.model_manager.warmup(iterations=3)
        
        # 获取系统信息
        system_info = self.model_manager.get_system_info()
        logger.info(f"System info: GPU={system_info.gpu_available}")
        
        self._emit("phase_change", WorkFlowPhase.AUTH, "Models loaded")
        
        return system_info
    
    def bind_user(
        self,
        image: np.ndarray,
        user_id: str,
        seat_id: str = "default"
    ) -> dict:
        """
        绑定用户身份 (阶段一核心)
        
        当用户点击"开始专注"时:
        1. 检测人脸
        2. 提取512维特征向量
        3. 绑定到座位
        
        Args:
            image: 当前帧图像
            user_id: 用户ID
            seat_id: 座位ID
            
        Returns:
            绑定结果
        """
        logger.info(f"Binding user: user_id={user_id}, seat_id={seat_id}")
        
        # 检测人脸
        faces = self.model_manager.detect_faces(image)
        
        if not faces:
            return {
                "success": False,
                "error": "No face detected"
            }
        
        # 选择最大/最居中的人脸
        self.face_selector.update_image_params(image.shape[1], image.shape[0])
        bbox = self.face_selector.select_target_face(faces)
        
        if bbox is None:
            return {
                "success": False,
                "error": "Failed to select target face"
            }
        
        # 提取特征向量
        for face in faces:
            if np.allclose(face.bbox, bbox, atol=1.0):
                embedding, aligned_face = self.model_manager.extract_face_embedding(image, face)
                break
        else:
            return {
                "success": False,
                "error": "Face not found"
            }
        
        # 绑定用户
        profile = self.authenticator.bind_user(
            user_id=user_id,
            seat_id=seat_id,
            embedding=embedding
        )
        
        # 初始化会话管理器
        self.session_manager = SessionManager(
            config=self.config,
            user_id=user_id,
            seat_id=seat_id
        )
        self.session_manager.start_session()
        
        # 更新工作流状态
        self.workflow_state.phase = WorkFlowPhase.PERCEPTION
        self.workflow_state.is_active = True
        self.workflow_state.start_time = time.time()
        self.workflow_state.user_id = user_id
        self.workflow_state.seat_id = seat_id
        self.workflow_state.session_id = self.session_manager.session_id
        
        # 重置帧计数器
        self.frame_controller.reset()
        self.anti_spoofing.reset()
        
        logger.info("=" * 60)
        logger.info(f"PHASE 2: PERCEPTION - User bound successfully")
        logger.info(f"Session ID: {self.session_manager.session_id}")
        logger.info("=" * 60)
        
        self._emit("phase_change", WorkFlowPhase.PERCEPTION, profile.to_dict())
        
        return {
            "success": True,
            "session_id": self.session_manager.session_id,
            "user_id": user_id,
            "seat_id": seat_id,
            "embedding_norm": float(np.linalg.norm(embedding)),
            "message": "User bound successfully"
        }
    
    def process_frame(self, image: np.ndarray) -> Optional[dict]:
        """
        处理单帧 (阶段二+三+四)
        
        包含:
        - 抽帧控制
        - 人脸检测和选择
        - EAR 计算
        - 头部姿态估计
        - 身份验证 (定期)
        - 状态机处理
        - 积分计算
        
        Args:
            image: 输入图像
            
        Returns:
            处理结果 或 None (如果跳过此帧)
        """
        if not self.workflow_state.is_active:
            return None
        
        current_time = time.time()
        delta_time = current_time - self._last_frame_time
        self._last_frame_time = current_time
        
        # 更新图像参数
        self.face_selector.update_image_params(image.shape[1], image.shape[0])
        
        # ========== 阶段二：感知 ==========
        
        # 1. 抽帧控制
        if not self.frame_controller.should_process_frame():
            return None  # 跳过此帧
        
        frame_start = time.time()
        self.workflow_state.frame_count += 1
        
        # 2. 人脸检测
        faces = self.model_manager.detect_faces(image)
        
        # 3. 选择目标人脸
        target_bbox = self.face_selector.select_target_face(faces)
        
        # 构建感知结果
        perception = PerceptionResult()
        perception.total_time_ms = (time.time() - frame_start) * 1000
        
        if target_bbox is None:
            # 无脸
            perception.has_face = False
            self.anti_spoofing.update(None)
        else:
            perception.has_face = True
            perception.bbox = target_bbox
            
            # 查找对应的 face 对象
            target_face = None
            for face in faces:
                if np.allclose(face.bbox, target_bbox, atol=1.0):
                    target_face = face
                    break
            
            if target_face is None and faces:
                target_face = faces[0]
            
            if target_face:
                perception.face_confidence = target_face.confidence
                
                # 4. 头部姿态估计
                x1, y1, x2, y2 = map(int, target_bbox[:4])
                face_crop = image[y1:y2, x1:x2]
                
                if face_crop.size > 0:
                    t0 = time.time()
                    head_pose = self.model_manager.estimate_head_pose(face_crop)
                    perception.detection_time_ms += (time.time() - t0) * 1000
                    
                    perception.pitch = head_pose.pitch
                    perception.yaw = head_pose.yaw
                    perception.roll = head_pose.roll
                
                # 5. 106点关键点 + EAR 计算
                t0 = time.time()
                landmarks_106 = self.model_manager.get_landmarks_106(image, target_bbox)
                perception.detection_time_ms += (time.time() - t0) * 1000
                
                eye_data = self.ear_calculator.get_eye_data(landmarks_106)
                perception.ear_left = eye_data.ear_left
                perception.ear_right = eye_data.ear_right
                perception.ear_avg = eye_data.ear_avg
                
                # 6. 身份验证 (定期)
                if self.authenticator.should_verify():
                    t0 = time.time()
                    if target_face:
                        embedding, _ = self.model_manager.extract_face_embedding(image, target_face)
                        perception.embedding = embedding
                        
                        verification = self.authenticator.verify_identity(embedding)
                        perception.identity_verified = verification.is_verified
                        perception.identity_similarity = verification.similarity
                        perception.is_cheating = verification.is_cheating
                        
                        if verification.is_cheating:
                            logger.warning(f"CHEATING DETECTED: similarity={verification.similarity:.4f}")
                            self._emit("cheating_detected", verification.to_dict())
                    else:
                        verification = VerificationResult(
                            is_verified=False,
                            similarity=0.0,
                            threshold=0.6,
                            is_cheating=False,
                            message="No face for verification"
                        )
                
                # 更新防作弊监控
                self.anti_spoofing.update(target_bbox)
        
        perception.total_time_ms = (time.time() - frame_start) * 1000
        
        # ========== 阶段三：状态裁决 ==========
        
        if self.session_manager:
            session_result = self.session_manager.process_frame(
                has_face=perception.has_face,
                pitch=perception.pitch,
                yaw=perception.yaw,
                ear_avg=perception.ear_avg,
                frame_id=self.workflow_state.processed_frames,
                delta_time=delta_time
            )
            
            perception.identity_verified = session_result.get("is_valid", perception.has_face)
        
        # ========== 阶段四：积分结算 ==========
        # 积分已在 session_manager 中自动计算
        
        # 更新工作流状态
        self.workflow_state.processed_frames += 1
        self.workflow_state.last_update = time.time()
        
        # 构建完整结果
        result = {
            "workflow": {
                "phase": self.workflow_state.phase.value,
                "session_id": self.workflow_state.session_id,
                "frame_count": self.workflow_state.frame_count,
                "processed_frames": self.workflow_state.processed_frames,
                "fps": 1.0 / max(delta_time, 0.001)
            },
            "perception": perception.to_dict(),
            "session": self.session_manager.get_summary() if self.session_manager else None
        }
        
        # 触发回调
        self._emit("frame_result", result)
        
        # WebSocket 广播
        if self.ws_server and self.ws_server.is_running:
            msg = WSMessage("frame_result", data=result)
            asyncio_run(self.ws_server.broadcast(msg))
        
        return result
    
    def end_session(self) -> dict:
        """结束会话"""
        if not self.workflow_state.is_active:
            return {"error": "No active session"}
        
        logger.info("Ending session...")
        
        # 获取最终摘要
        summary = self.session_manager.end_session() if self.session_manager else {}
        
        # 解绑用户
        self.authenticator.unbind_user()
        
        # 更新状态
        self.workflow_state.phase = WorkFlowPhase.TERMINATED
        self.workflow_state.is_active = False
        
        # 重置组件
        self.frame_controller.reset()
        self.face_selector.reset()
        self.anti_spoofing.reset()
        
        logger.info(f"Session ended: {summary}")
        
        return summary
    
    def get_current_state(self) -> dict:
        """获取当前状态"""
        return {
            "workflow_phase": self.workflow_state.phase.value,
            "is_active": self.workflow_state.is_active,
            "session_id": self.workflow_state.session_id,
            "user_id": self.workflow_state.user_id,
            "seat_id": self.workflow_state.seat_id,
            "frame_count": self.workflow_state.frame_count,
            "processed_frames": self.workflow_state.processed_frames,
            "user_info": self.authenticator.get_current_user_info(),
            "frame_stats": self.frame_controller.get_stats()
        }
    
    def register_callback(self, event: str, callback: Callable) -> None:
        """注册回调"""
        if event in self._callbacks:
            self._callbacks[event].append(callback)
    
    def _emit(self, event: str, *args, **kwargs) -> None:
        """触发回调"""
        for callback in self._callbacks.get(event, []):
            try:
                callback(*args, **kwargs)
            except Exception as e:
                logger.error(f"Callback error in {event}: {e}")
    
    def visualize_frame(self, image: np.ndarray, result: dict) -> np.ndarray:
        """可视化处理结果"""
        if not self.enable_visualization:
            return image
        
        vis = image.copy()
        h, w = image.shape[:2]
        
        perception = result.get("perception", {})
        session = result.get("session", {})
        workflow = result.get("workflow", {})
        
        # 状态颜色
        state = session.get("current_state", "idle")
        state_colors = {
            "idle": (128, 128, 128),
            "focused": (0, 255, 0),
            "warning": (0, 255, 255),
            "interrupted": (0, 0, 255)
        }
        color = state_colors.get(state, (255, 255, 255))
        
        # 信息面板
        info_y = 25
        line_h = 22
        font = cv2.FONT_HERSHEY_SIMPLEX
        
        # 用户信息
        cv2.putText(vis, f"User: {self.workflow_state.user_id or 'N/A'}", 
                    (10, info_y), font, 0.5, (255, 255, 255), 1)
        info_y += line_h
        
        cv2.putText(vis, f"Seat: {self.workflow_state.seat_id or 'N/A'}", 
                    (10, info_y), font, 0.5, (255, 255, 255), 1)
        info_y += line_h
        
        # 状态
        state_text = f"State: {state.upper()}"
        cv2.putText(vis, state_text, (10, info_y), font, 0.6, color, 2)
        info_y += line_h
        
        # FPS
        fps = workflow.get("fps", 0)
        cv2.putText(vis, f"FPS: {fps:.1f} (target: {self.target_fps})", 
                    (10, info_y), font, 0.4, (200, 200, 200), 1)
        info_y += line_h
        
        # 头部姿态
        hp = perception.get("head_pose", {})
        cv2.putText(vis, f"Pitch: {hp.get('pitch', 0):.1f}  Yaw: {hp.get('yaw', 0):.1f}", 
                    (10, info_y), font, 0.4, (255, 255, 255), 1)
        info_y += line_h
        
        # EAR
        eye = perception.get("eye", {})
        ear = eye.get("ear_avg", 0)
        ear_color = (0, 255, 0) if ear > self.config.ear_threshold else (0, 0, 255)
        cv2.putText(vis, f"EAR: {ear:.4f}", 
                    (10, info_y), font, 0.4, ear_color, 1)
        info_y += line_h
        
        # 身份验证
        identity = perception.get("identity", {})
        if identity.get("similarity", 0) > 0:
            sim = identity.get("similarity", 0)
            sim_color = (0, 255, 0) if sim > 0.6 else (0, 255, 255) if sim > 0.5 else (0, 0, 255)
            cv2.putText(vis, f"Identity: {sim:.4f}", 
                        (10, info_y), font, 0.4, sim_color, 1)
            info_y += line_h
        
        # 积分
        score = session.get("score_summary", {})
        points = score.get("total_points", 0)
        focus_time = score.get("current_streak_min", 0)
        cv2.putText(vis, f"Points: {points}  Focus: {focus_time:.1f}min", 
                    (10, info_y), font, 0.4, (255, 255, 0), 1)
        info_y += line_h
        
        # 宽容时间
        grace = session.get("fsm_stats", {}).get("grace_remaining", 0)
        if grace > 0:
            cv2.putText(vis, f"Grace: {grace:.1f}s", 
                        (10, info_y), font, 0.4, (0, 255, 255), 1)
            info_y += line_h
        
        # 边框
        border_color = color
        if identity.get("is_cheating", False):
            border_color = (0, 0, 255)  # 红色边框表示作弊
        cv2.rectangle(vis, (0, 0), (w - 1, h - 1), border_color, 3)
        
        return vis
    
    def release(self) -> None:
        """释放资源"""
        if self.model_manager:
            self.model_manager.release()
        
        if self.ws_server:
            asyncio_run(self.ws_server.stop())
        
        logger.info("Resources released")


def asyncio_run(coro):
    """运行异步协程"""
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        future = asyncio.ensure_future(coro)
        return future
    except RuntimeError:
        return asyncio.run(coro)
