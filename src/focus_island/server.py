"""
Focus Island 服务器启动模块

提供完整的 WebSocket + REST API 服务器，支持桌面客户端连接。

Author: SSP Team
"""

import argparse
import asyncio
import logging
import sys
import cv2
import time
import threading
import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class ServerMode:
    """服务器模式"""
    
    def __init__(
        self,
        host: str = "127.0.0.1",
        ws_port: int = 8765,
        api_port: int = 8000,
        camera_id: int = 0,
        use_cuda: bool = True
    ):
        self.host = host
        self.ws_port = ws_port
        self.api_port = api_port
        self.camera_id = camera_id
        self.use_cuda = use_cuda
        
        # 工作流
        self.workflow = None
        
        # 摄像头
        self.camera = None
        self.is_running = False
        
        # MJPEG 流
        self.latest_frame = None
        self.frame_lock = threading.Lock()
        
        # 会话状态
        self.session_active = False
    
    async def initialize(self):
        """初始化系统"""
        logger.info("=" * 60)
        logger.info("Focus Island Server Starting...")
        logger.info("=" * 60)
        
        # 导入工作流
        try:
            from focus_island.workflow import FocusWorkFlow
            from focus_island.types import PipelineConfig
            
            # 创建配置
            config = PipelineConfig()
            
            # 创建工作流
            self.workflow = FocusWorkFlow(
                config=config,
                use_cuda=self.use_cuda,
                target_fps=4.0,
                enable_visualization=False
            )
            
            # 初始化
            system_info = self.workflow.initialize()
            logger.info(f"System initialized | GPU: {system_info.gpu_available}")
            
            # 打开摄像头
            self.camera = cv2.VideoCapture(self.camera_id)
            if not self.camera.isOpened():
                logger.error(f"Cannot open camera {self.camera_id}")
                return False
            
            self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            
            logger.info(f"Camera opened (ID: {self.camera_id})")
            
            # 启动视频捕获线程
            self.is_running = True
            self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
            self.capture_thread.start()
            
            return True
            
        except Exception as e:
            logger.exception(f"Initialization failed: {e}")
            return False
    
    def _capture_loop(self):
        """视频捕获循环"""
        logger.info("Capture thread started")
        
        while self.is_running:
            if self.camera is None:
                break
            
            ret, frame = self.camera.read()
            if not ret:
                logger.warning("Failed to read frame")
                continue
            
            # 镜像翻转
            frame = cv2.flip(frame, 1)
            
            # 更新最新帧
            with self.frame_lock:
                self.latest_frame = frame.copy()
            
            # 如果会话活跃，处理帧
            if self.session_active and self.workflow:
                try:
                    result = self.workflow.process_frame(frame)
                    if result:
                        # 触发 WebSocket 广播 (如果可用)
                        pass
                except Exception as e:
                    logger.error(f"Frame processing error: {e}")
            
            # 控制帧率 ~30fps
            time.sleep(0.033)
        
        logger.info("Capture thread stopped")
    
    def get_latest_frame(self) -> np.ndarray:
        """获取最新帧"""
        with self.frame_lock:
            return self.latest_frame.copy() if self.latest_frame is not None else None
    
    def get_mjpeg_bytes(self) -> bytes:
        """获取 MJPEG 格式的帧"""
        frame = self.get_latest_frame()
        if frame is None:
            return b''
        
        # 编码为 JPEG
        ret, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ret:
            return b''
        
        # 构建 MJPEG 数据
        return b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n'
    
    async def start_websocket_server(self):
        """启动 WebSocket 服务器"""
        try:
            from fastapi import FastAPI
            from fastapi.middleware.cors import CORSMiddleware
            from fastapi.responses import StreamingResponse
            import websockets
            
            # 创建 FastAPI 应用
            app = FastAPI(title="Focus Island Backend")
            
            # CORS
            app.add_middleware(
                CORSMiddleware,
                allow_origins=["*"],
                allow_credentials=True,
                allow_methods=["*"],
                allow_headers=["*"],
            )
            
            # 健康检查
            @app.get("/health")
            async def health():
                return {"status": "healthy", "timestamp": time.time()}
            
            # 系统状态
            @app.get("/api/status")
            async def status():
                if self.workflow:
                    info = self.workflow.model_manager.get_system_info()
                    return {
                        "status": "running",
                        "gpu_available": info.gpu_available,
                        "gpu_name": info.gpu_name,
                        "session_active": self.session_active,
                        "camera_connected": self.camera is not None and self.camera.isOpened()
                    }
                return {"status": "initializing"}
            
            # 视频流
            @app.get("/api/video/stream")
            async def video_stream():
                async def generate():
                    while self.is_running:
                        frame = self.get_latest_frame()
                        if frame is not None:
                            ret, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                            if ret:
                                yield (b'--frame\r\n'
                                       b'Content-Type: image/jpeg\r\n\r\n' + 
                                       jpeg.tobytes() + b'\r\n')
                        await asyncio.sleep(0.033)
                
                return StreamingResponse(
                    generate(),
                    media_type="multipart/x-mixed-replace; boundary=frame"
                )
            
            # 会话控制 - 新流程：先验证/绑定，再开始专注
            
            # 1. 验证人脸（不保存，不开始专注）
            @app.post("/api/face/verify")
            async def verify_face(
                user_id: str = "default_user",
                language: str = "zh"
            ):
                if self.workflow:
                    frame = self.get_latest_frame()
                    if frame is not None:
                        result = self.workflow.verify_face(
                            image=frame,
                            user_id=user_id,
                            language=language
                        )
                        return result
                    return {"success": False, "error": "No frame available"}
                return {"success": False, "error": "Not initialized"}
            
            # 2. 绑定人脸（保存到本地）
            @app.post("/api/face/bind")
            async def bind_face(
                user_id: str = "default_user",
                language: str = "zh"
            ):
                if self.workflow:
                    frame = self.get_latest_frame()
                    if frame is not None:
                        result = self.workflow.bind_face(
                            image=frame,
                            user_id=user_id,
                            language=language
                        )
                        return result
                    return {"success": False, "error": "No frame available"}
                return {"success": False, "error": "Not initialized"}
            
            # 3. 检查用户是否已绑定人脸
            @app.get("/api/face/status/{user_id}")
            async def get_face_status(user_id: str):
                if self.workflow:
                    is_bound = self.workflow.authenticator.has_bound_face(user_id)
                    return {
                        "success": True,
                        "is_bound": is_bound,
                        "user_id": user_id
                    }
                return {"success": False, "error": "Not initialized"}
            
            # 4. 删除已绑定的人脸
            @app.delete("/api/face/{user_id}")
            async def delete_face(user_id: str):
                if self.workflow:
                    result = self.workflow.authenticator.delete_user_face_data(user_id)
                    return result
                return {"success": False, "error": "Not initialized"}
            
            # 5. 开始专注（验证通过后才开始）
            @app.post("/api/session/start")
            async def start_session(
                user_id: str = "default_user",
                seat_id: str = "desktop_client",
                language: str = "zh"
            ):
                if self.workflow:
                    frame = self.get_latest_frame()
                    if frame is not None:
                        result = self.workflow.start_focus(
                            image=frame,
                            user_id=user_id,
                            seat_id=seat_id,
                            language=language
                        )
                        if result.get("success"):
                            self.session_active = True
                        return result
                    return {"success": False, "error": "No frame available"}
                return {"success": False, "error": "Not initialized"}
            
            @app.post("/api/session/stop")
            async def stop_session():
                if self.workflow:
                    summary = self.workflow.end_session()
                    self.session_active = False
                    return {"success": True, "summary": summary}
                return {"success": False}
            
            # 语言设置
            @app.post("/api/session/language")
            async def set_language(language: str = "zh"):
                if self.workflow:
                    from .workflow import I18n
                    I18n.set_locale(language)
                    return {"success": True, "language": language}
                return {"success": False, "error": "Not initialized"}
            
            # 摄像头控制
            @app.post("/api/camera/start")
            async def start_camera():
                """开启摄像头"""
                if self.camera is None or not self.camera.isOpened():
                    self.camera = cv2.VideoCapture(self.camera_id)
                    if not self.camera.isOpened():
                        return {"success": False, "error": "Failed to open camera"}
                    self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                    self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                    self.is_running = True
                    
                    # 重启捕获线程
                    if not hasattr(self, 'capture_thread') or not self.capture_thread.is_alive():
                        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
                        self.capture_thread.start()
                    
                    return {"success": True, "camera_on": True}
                return {"success": True, "camera_on": True, "message": "Camera already on"}
            
            @app.post("/api/camera/stop")
            async def stop_camera():
                """关闭摄像头"""
                self.is_running = False
                if self.camera is not None:
                    self.camera.release()
                    self.camera = None
                return {"success": True, "camera_on": False}
            
            @app.get("/api/camera/status")
            async def camera_status():
                """获取摄像头状态"""
                camera_on = self.camera is not None and self.camera.isOpened()
                return {
                    "success": True,
                    "camera_on": camera_on
                }
            
            @app.get("/api/session/status")
            async def session_status():
                if self.workflow:
                    from .workflow import I18n
                    state = self.workflow.get_current_state()
                    # 添加国际化状态文本
                    current_state = state.get("workflow_phase", "idle")
                    state["i18n"] = {
                        "state_text": I18n.get_state_text(current_state),
                        "language": I18n.get_locale()
                    }
                    
                    # 获取最新帧结果
                    if self.workflow.session_manager:
                        summary = self.workflow.session_manager.get_summary()
                        state["session"] = summary
                        if "fsm_stats" in summary:
                            fsm_state = summary["fsm_stats"].get("state", "idle")
                            state["i18n"]["state_text"] = I18n.get_state_text(fsm_state)
                    
                    return state
                return {"error": "Not initialized"}
            
            # WebSocket 处理
            connected_clients = set()
            
            async def ws_handler(websocket, path):
                client_id = f"client_{id(websocket)}"
                connected_clients.add(websocket)
                logger.info(f"WebSocket client connected: {client_id}")
                
                try:
                    # 发送欢迎消息
                    await websocket.send({
                        "type": "system_info",
                        "data": {
                            "client_id": client_id,
                            "server_time": time.time(),
                            "connected_clients": len(connected_clients)
                        }
                    })
                    
                    # 消息循环
                    async for message in websocket:
                        try:
                            data = message if isinstance(message, dict) else {}
                            msg_type = data.get("type", "")
                            
                            if msg_type == "verify_face":
                                user_id = data.get("data", {}).get("user_id", "default_user")
                                language = data.get("data", {}).get("language", "zh")
                                frame = self.get_latest_frame()
                                if frame and self.workflow:
                                    result = self.workflow.verify_face(
                                        image=frame,
                                        user_id=user_id,
                                        language=language
                                    )
                                    await websocket.send({
                                        "type": "face_verified",
                                        "data": result
                                    })
                            
                            elif msg_type == "bind_face":
                                user_id = data.get("data", {}).get("user_id", "default_user")
                                language = data.get("data", {}).get("language", "zh")
                                frame = self.get_latest_frame()
                                if frame and self.workflow:
                                    result = self.workflow.bind_face(
                                        image=frame,
                                        user_id=user_id,
                                        language=language
                                    )
                                    await websocket.send({
                                        "type": "face_bound",
                                        "data": result
                                    })
                            
                            elif msg_type == "check_face_status":
                                user_id = data.get("data", {}).get("user_id", "default_user")
                                if self.workflow:
                                    is_bound = self.workflow.authenticator.has_bound_face(user_id)
                                    await websocket.send({
                                        "type": "face_status",
                                        "data": {
                                            "is_bound": is_bound,
                                            "user_id": user_id
                                        }
                                    })
                            
                            elif msg_type == "start_session":
                                user_id = data.get("data", {}).get("user_id", "default_user")
                                seat_id = data.get("data", {}).get("seat_id", "desktop_client")
                                language = data.get("data", {}).get("language", "zh")
                                frame = self.get_latest_frame()
                                if frame and self.workflow:
                                    result = self.workflow.start_focus(
                                        image=frame,
                                        user_id=user_id,
                                        seat_id=seat_id,
                                        language=language
                                    )
                                    if result.get("success"):
                                        self.session_active = True
                                    await websocket.send({
                                        "type": "session_started",
                                        "data": result
                                    })
                            
                            elif msg_type == "stop_session":
                                if self.workflow:
                                    summary = self.workflow.end_session()
                                    self.session_active = False
                                    await websocket.send({
                                        "type": "session_ended",
                                        "data": summary
                                    })
                            
                            elif msg_type == "pause_session":
                                # 暂停逻辑
                                await websocket.send({"type": "paused"})
                            
                            elif msg_type == "resume_session":
                                # 恢复逻辑
                                await websocket.send({"type": "resumed"})
                            
                            elif msg_type == "start_camera":
                                if self.camera is None or not self.camera.isOpened():
                                    self.camera = cv2.VideoCapture(self.camera_id)
                                    if self.camera.isOpened():
                                        self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                                        self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                                        self.is_running = True
                                        if not hasattr(self, 'capture_thread') or not self.capture_thread.is_alive():
                                            self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
                                            self.capture_thread.start()
                                        await websocket.send({
                                            "type": "camera_status",
                                            "data": {"camera_on": True}
                                        })
                                    else:
                                        await websocket.send({
                                            "type": "error",
                                            "data": {"message": "Failed to open camera"}
                                        })
                                else:
                                    await websocket.send({
                                        "type": "camera_status",
                                        "data": {"camera_on": True}
                                    })
                            
                            elif msg_type == "stop_camera":
                                self.is_running = False
                                if self.camera is not None:
                                    self.camera.release()
                                    self.camera = None
                                await websocket.send({
                                    "type": "camera_status",
                                    "data": {"camera_on": False}
                                })
                            
                            elif msg_type == "get_camera_status":
                                camera_on = self.camera is not None and self.camera.isOpened()
                                await websocket.send({
                                    "type": "camera_status",
                                    "data": {"camera_on": camera_on}
                                })
                            
                            elif msg_type == "get_system_info":
                                if self.workflow:
                                    info = self.workflow.model_manager.get_system_info()
                                    await websocket.send({
                                        "type": "system_info",
                                        "data": info.to_dict()
                                    })
                            
                            elif msg_type == "ping":
                                await websocket.send({
                                    "type": "pong",
                                    "data": {"server_time": time.time()}
                                })
                                
                        except Exception as e:
                            logger.error(f"WS message error: {e}")
                            
                except websockets.exceptions.ConnectionClosed:
                    pass
                finally:
                    connected_clients.discard(websocket)
                    logger.info(f"WebSocket client disconnected: {client_id}")
            
            # 广播帧结果
            async def broadcast_loop():
                while self.is_running:
                    if connected_clients and self.session_active and self.workflow:
                        frame = self.get_latest_frame()
                        if frame is not None:
                            result = self.workflow.process_frame(frame)
                            if result:
                                msg = {
                                    "type": "frame_result",
                                    "data": result
                                }
                                await asyncio.gather(
                                    *[client.send(msg) for client in connected_clients],
                                    return_exceptions=True
                                )
                    await asyncio.sleep(0.25)  # ~4 FPS 广播
            
            # 启动服务器
            import uvicorn
            
            # 启动 WebSocket 服务器
            ws_server = websockets.serve(ws_handler, self.host, self.ws_port)
            asyncio.ensure_future(ws_server)
            asyncio.ensure_future(broadcast_loop())
            
            # 启动 FastAPI
            config = uvicorn.Config(app, host=self.host, port=self.api_port, log_level="warning")
            server = uvicorn.Server(config)
            
            logger.info(f"WebSocket server: ws://{self.host}:{self.ws_port}")
            logger.info(f"REST API server: http://{self.host}:{self.api_port}")
            logger.info(f"MJPEG stream: http://{self.host}:{self.api_port}/api/video/stream")
            
            await server.serve()
            
        except ImportError as e:
            logger.error(f"Missing dependency: {e}")
            logger.info("Install with: pip install fastapi uvicorn websockets")
            return False
        except Exception as e:
            logger.exception(f"Server error: {e}")
            return False
    
    def cleanup(self):
        """清理资源"""
        logger.info("Cleaning up...")
        self.is_running = False
        
        if self.camera:
            self.camera.release()
            self.camera = None
        
        if self.workflow:
            self.workflow.release()
            self.workflow = None
        
        logger.info("Cleanup complete")


async def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="Focus Island Backend Server")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Server host")
    parser.add_argument("--ws-port", type=int, default=8765, help="WebSocket port")
    parser.add_argument("--api-port", type=int, default=8000, help="REST API port")
    parser.add_argument("--camera", type=int, default=0, help="Camera ID")
    parser.add_argument("--cuda", action="store_true", default=True, help="Use CUDA")
    
    args = parser.parse_args()
    
    server = ServerMode(
        host=args.host,
        ws_port=args.ws_port,
        api_port=args.api_port,
        camera_id=args.camera,
        use_cuda=args.cuda
    )
    
    try:
        # 初始化
        if not await server.initialize():
            logger.error("Failed to initialize server")
            return 1
        
        # 启动服务器
        await server.start_websocket_server()
        
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.exception(f"Server error: {e}")
    finally:
        server.cleanup()
    
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
