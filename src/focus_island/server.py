"""
Focus Island Server Startup Module

Provides complete WebSocket + REST API server, supporting desktop client connections.

Author: SSP Team
"""

import argparse
import asyncio
import json
import logging
import os
import socket
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
import cv2
import time
import threading
import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stdout,
    force=True,
)
logger = logging.getLogger(__name__)

_PORTS_FILE = ".focus_island_ports.json"


def _tcp_port_available(host: str, port: int) -> bool:
    """Return True if nothing is listening on host:port (best-effort; TOCTOU possible)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind((host, port))
    except OSError:
        return False
    return True


def resolve_listen_port_pair(
    host: str, ws_port: int, api_port: int, max_offset: int = 64
) -> tuple[int, int]:
    """If default WS/API ports are busy, use the same offset for both so tooling stays paired."""
    for off in range(max_offset):
        w, a = ws_port + off, api_port + off
        if _tcp_port_available(host, w) and _tcp_port_available(host, a):
            return w, a
    return ws_port, api_port


def write_ports_file(ws_port: int, api_port: int, directory: Path | None = None) -> None:
    """Write chosen ports for Vite / other tools (repo root cwd in normal use)."""
    root = directory or Path.cwd()
    path = root / _PORTS_FILE
    try:
        path.write_text(
            json.dumps({"ws_port": ws_port, "api_port": api_port}, indent=2),
            encoding="utf-8",
        )
    except OSError as e:
        logger.debug("Could not write %s: %s", path, e)


def _ws_json(obj: dict) -> str:
    """websockets 12+ requires str/bytes for send(), not dict."""
    return json.dumps(obj, ensure_ascii=False, default=str)


def _open_video_capture(camera_id: int) -> cv2.VideoCapture:
    """Open camera. On Windows, prefer DirectShow to reduce MSMF grab failures."""
    if sys.platform == "win32":
        cap = cv2.VideoCapture(camera_id, cv2.CAP_DSHOW)
        if cap.isOpened():
            return cap
        cap.release()
    return cv2.VideoCapture(camera_id)


class ServerMode:
    """Server mode"""
    
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
        
        # Workflow
        self.workflow = None
        
        # Camera (off by default, started when frontend enters focus mode)
        self.camera = None
        self.capture_running = False
        self.shutdown_requested = False
        
        # MJPEG stream
        self.latest_frame = None
        self.frame_lock = threading.Lock()
        
        # Session state
        self.session_active = False
    
    async def initialize(self):
        """Initialize system"""
        logger.info("=" * 60)
        logger.info("Focus Island Server Starting...")
        logger.info("=" * 60)
        
        # Import workflow
        try:
            from focus_island.workflow import FocusWorkFlow
            from focus_island.types import PipelineConfig
            
            # Create config
            config = PipelineConfig()
            
            # Create workflow
            self.workflow = FocusWorkFlow(
                config=config,
                use_cuda=self.use_cuda,
                target_fps=4.0,
                enable_visualization=False
            )
            
            # 初始化
            system_info = self.workflow.initialize()
            logger.info(f"System initialized | GPU: {system_info.gpu_available}")
            logger.info(
                "Camera idle until a focus mode starts (frontend will send start_camera)."
            )
            
            return True
            
        except Exception as e:
            logger.exception(f"Initialization failed: {e}")
            return False
    
    def _capture_loop(self):
        """Video capture loop"""
        logger.info("Capture thread started")
        fail_streak = 0
        last_fail_log = 0.0

        while self.capture_running:
            if self.camera is None:
                break

            ret, frame = self.camera.read()
            if not ret:
                fail_streak += 1
                now = time.time()
                if now - last_fail_log >= 1.0:
                    logger.warning("Failed to read frame (camera busy, unplugged, or driver issue)")
                    last_fail_log = now
                time.sleep(min(0.05 * fail_streak, 0.5))
                continue
            fail_streak = 0
            
            # Mirror flip
            frame = cv2.flip(frame, 1)
            
            # Update latest frame
            with self.frame_lock:
                self.latest_frame = frame.copy()
            
            # If session is active, process frame
            if self.session_active and self.workflow:
                try:
                    result = self.workflow.process_frame(frame)
                    if result:
                        # Trigger WebSocket broadcast (if available)
                        pass
                except Exception as e:
                    logger.error(f"Frame processing error: {e}")
            
            # Control frame rate ~30fps
            time.sleep(0.033)
        
        logger.info("Capture thread stopped")
    
    def get_latest_frame(self) -> np.ndarray:
        """Get latest frame reference (shared, DO NOT modify). For broadcast & WS handlers."""
        with self.frame_lock:
            return self.latest_frame  # share reference, no copy

    def get_frame_copy(self) -> Optional[np.ndarray]:
        """Get a copy of the latest frame. Use only when you need to modify or retain it."""
        with self.frame_lock:
            return self.latest_frame.copy() if self.latest_frame is not None else None

    def get_mjpeg_bytes(self) -> bytes:
        """Get frame in MJPEG format"""
        frame = self.get_frame_copy()  # copy needed for imencode which modifies buffer
        if frame is None:
            return b''
        
        # Encode to JPEG
        ret, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ret:
            return b''
        
        # Build MJPEG data
        return b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n'
    
    async def start_websocket_server(self):
        """Start WebSocket server"""
        try:
            from fastapi import FastAPI
            from fastapi.middleware.cors import CORSMiddleware
            from fastapi.responses import StreamingResponse
            import websockets

            skip_auto = os.environ.get("FOCUS_ISLAND_SKIP_AUTO_PORT", "").strip() == "1"
            if not skip_auto:
                w, a = resolve_listen_port_pair(self.host, self.ws_port, self.api_port)
                if (w, a) != (self.ws_port, self.api_port):
                    logger.warning(
                        "Ports %s/%s were busy; using %s/%s. "
                        "Close other Focus Island backends or set FOCUS_ISLAND_EXTERNAL_BACKEND=1 "
                        "when using Electron together with start.bat.",
                        self.ws_port,
                        self.api_port,
                        w,
                        a,
                    )
                self.ws_port, self.api_port = w, a
            write_ports_file(self.ws_port, self.api_port)

            @asynccontextmanager
            async def lifespan(app: FastAPI):
                yield
                logger.info("Stopping background capture...")
                self.shutdown_requested = True
                self.capture_running = False
                ct = getattr(self, "capture_thread", None)
                if ct is not None and ct.is_alive():
                    ct.join(timeout=3.0)
                if self.camera is not None:
                    try:
                        self.camera.release()
                    except Exception:
                        pass
                    self.camera = None

            # 创建 FastAPI 应用
            app = FastAPI(title="Focus Island Backend", lifespan=lifespan)
            
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
                    while not self.shutdown_requested:
                        frame = self.get_frame_copy()  # copy for imencode (modifies buffer)
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
            
            # Session control - new flow: verify/bind face first, then start focus
            
            # 1. Verify face (don't save, don't start focus)
            # 必须严格验证指定用户的人脸，确保账号个人独有机制
            @app.post("/api/face/verify")
            async def verify_face(
                user_id: str = "default_user",
                language: str = "zh"
            ):
                if self.workflow:
                    frame = self.get_frame_copy()  # copy: workflow may process this image
                    if frame is not None:
                        result = self.workflow.verify_face(
                            image=frame,
                            user_id=user_id,
                            language=language
                        )
                        # 严格验证：必须传入 user_id 并匹配成功才算验证通过
                        # 如果未绑定或未传入 user_id，返回未验证
                        is_bound = self.workflow.authenticator.has_bound_face(user_id)
                        if not is_bound:
                            return {
                                "success": False,
                                "is_verified": False,
                                "is_bound": False,
                                "similarity": 0.0,
                                "error": "该账号未绑定人脸",
                                "error_code": "NOT_BOUND"
                            }
                        # 只有指定用户的特征匹配成功才算验证通过
                        return result
                    return {"success": False, "error": "No frame available"}
                return {"success": False, "error": "Not initialized"}
            
            # 2. Bind face (save to local) - 防止重复绑定
            @app.post("/api/face/bind")
            async def bind_face(
                user_id: str = "default_user",
                language: str = "zh"
            ):
                if self.workflow:
                    # 先检查是否已绑定
                    is_already_bound = self.workflow.authenticator.has_bound_face(user_id)
                    if is_already_bound:
                        return {
                            "success": False,
                            "is_bound": True,
                            "error": "该账号已绑定过人脸，无法重复绑定",
                            "error_code": "ALREADY_BOUND"
                        }

                    frame = self.get_frame_copy()
                    if frame is not None:
                        result = self.workflow.bind_face(
                            image=frame,
                            user_id=user_id,
                            language=language
                        )
                        return result
                    return {"success": False, "error": "No frame available"}
                return {"success": False, "error": "Not initialized"}
            
            # 3. Check if user has bound face
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
            
            # 4. Delete bound face
            @app.delete("/api/face/{user_id}")
            async def delete_face(user_id: str):
                if self.workflow:
                    result = self.workflow.authenticator.delete_user_face_data(user_id)
                    return result
                return {"success": False, "error": "Not initialized"}
            
            # 5. Start focus (only after verification passes)
            @app.post("/api/session/start")
            async def start_session(
                user_id: str = "default_user",
                seat_id: str = "desktop_client",
                language: str = "zh"
            ):
                if self.workflow:
                    frame = self.get_frame_copy()  # copy for workflow.start_focus
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
            
            # Camera control
            @app.post("/api/camera/start")
            async def start_camera():
                """Start camera"""
                if self.camera is None or not self.camera.isOpened():
                    self.camera = _open_video_capture(self.camera_id)
                    if not self.camera.isOpened():
                        return {"success": False, "error": "Failed to open camera"}
                    self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                    self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                    self.capture_running = True
                    
                    # Restart capture thread
                    if not hasattr(self, 'capture_thread') or not self.capture_thread.is_alive():
                        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
                        self.capture_thread.start()
                    
                    return {"success": True, "camera_on": True}
                self.capture_running = True
                if not hasattr(self, 'capture_thread') or not self.capture_thread.is_alive():
                    self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
                    self.capture_thread.start()
                return {"success": True, "camera_on": True, "message": "Camera already on"}
            
            @app.post("/api/camera/stop")
            async def stop_camera():
                """Stop camera"""
                self.capture_running = False
                ct = getattr(self, "capture_thread", None)
                if ct is not None and ct.is_alive():
                    ct.join(timeout=2.0)
                if self.camera is not None:
                    self.camera.release()
                    self.camera = None
                return {"success": True, "camera_on": False}
            
            @app.get("/api/camera/status")
            async def camera_status():
                """Get camera status"""
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
            
            async def ws_handler(websocket, path=None):
                client_id = f"client_{id(websocket)}"
                connected_clients.add(websocket)
                logger.info(f"WebSocket client connected: {client_id}")
                
                try:
                    # 发送欢迎消息
                    await websocket.send(_ws_json({
                        "type": "system_info",
                        "data": {
                            "client_id": client_id,
                            "server_time": time.time(),
                            "connected_clients": len(connected_clients)
                        }
                    }))
                    
                    # 消息循环
                    async for message in websocket:
                        try:
                            if isinstance(message, (bytes, bytearray)):
                                message = message.decode("utf-8")
                            if isinstance(message, str):
                                try:
                                    data = json.loads(message)
                                except json.JSONDecodeError:
                                    logger.warning("WS ignored non-JSON message")
                                    continue
                            elif isinstance(message, dict):
                                data = message
                            else:
                                data = {}
                            msg_type = data.get("type", "")

                            if msg_type == "verify_face":
                                user_id = data.get("data", {}).get("user_id", "default_user")
                                language = data.get("data", {}).get("language", "zh")
                                frame = self.get_frame_copy()  # copy for workflow verification
                                if frame and self.workflow:
                                    is_bound = self.workflow.authenticator.has_bound_face(user_id)
                                    if not is_bound:
                                        result = {
                                            "success": False,
                                            "is_verified": False,
                                            "is_bound": False,
                                            "similarity": 0.0,
                                            "error": "该账号未绑定人脸",
                                            "error_code": "NOT_BOUND"
                                        }
                                    else:
                                        result = self.workflow.verify_face(
                                            image=frame,
                                            user_id=user_id,
                                            language=language
                                        )
                                    await websocket.send(_ws_json({
                                        "type": "face_verified",
                                        "data": result
                                    }))

                            elif msg_type == "bind_face":
                                user_id = data.get("data", {}).get("user_id", "default_user")
                                language = data.get("data", {}).get("language", "zh")
                                frame = self.get_frame_copy()  # copy for workflow bind
                                if frame and self.workflow:
                                    is_already_bound = self.workflow.authenticator.has_bound_face(user_id)
                                    if is_already_bound:
                                        result = {
                                            "success": False,
                                            "is_bound": True,
                                            "error": "该账号已绑定过人脸，无法重复绑定",
                                            "error_code": "ALREADY_BOUND"
                                        }
                                    else:
                                        result = self.workflow.bind_face(
                                            image=frame,
                                            user_id=user_id,
                                            language=language
                                        )
                                    await websocket.send(_ws_json({
                                        "type": "face_bound",
                                        "data": result
                                    }))

                            elif msg_type == "check_face_status":
                                user_id = data.get("data", {}).get("user_id", "default_user")
                                if self.workflow:
                                    is_bound = self.workflow.authenticator.has_bound_face(user_id)
                                    await websocket.send(_ws_json({
                                        "type": "face_status",
                                        "data": {
                                            "is_bound": is_bound,
                                            "user_id": user_id
                                        }
                                    }))

                            elif msg_type == "start_session":
                                user_id = data.get("data", {}).get("user_id", "default_user")
                                seat_id = data.get("data", {}).get("seat_id", "desktop_client")
                                language = data.get("data", {}).get("language", "zh")
                                frame = self.get_frame_copy()  # copy for workflow.start_focus
                                if frame and self.workflow:
                                    result = self.workflow.start_focus(
                                        image=frame,
                                        user_id=user_id,
                                        seat_id=seat_id,
                                        language=language
                                    )
                                    if result.get("success"):
                                        self.session_active = True
                                    await websocket.send(_ws_json({
                                        "type": "session_started",
                                        "data": result
                                    }))
                            
                            elif msg_type == "stop_session":
                                if self.workflow:
                                    summary = self.workflow.end_session()
                                    self.session_active = False
                                    await websocket.send(_ws_json({
                                        "type": "session_ended",
                                        "data": summary
                                    }))
                            
                            elif msg_type == "pause_session":
                                # Pause logic
                                await websocket.send(_ws_json({"type": "paused"}))
                            
                            elif msg_type == "resume_session":
                                # Resume logic
                                await websocket.send(_ws_json({"type": "resumed"}))
                            
                            elif msg_type == "start_camera":
                                if self.camera is None or not self.camera.isOpened():
                                    self.camera = _open_video_capture(self.camera_id)
                                    if self.camera.isOpened():
                                        self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                                        self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                                        self.capture_running = True
                                        if not hasattr(self, 'capture_thread') or not self.capture_thread.is_alive():
                                            self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
                                            self.capture_thread.start()
                                        await websocket.send(_ws_json({
                                            "type": "camera_status",
                                            "data": {"camera_on": True}
                                        }))
                                    else:
                                        await websocket.send(_ws_json({
                                            "type": "error",
                                            "data": {"message": "Failed to open camera"}
                                        }))
                                else:
                                    self.capture_running = True
                                    if not hasattr(self, 'capture_thread') or not self.capture_thread.is_alive():
                                        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
                                        self.capture_thread.start()
                                    await websocket.send(_ws_json({
                                        "type": "camera_status",
                                        "data": {"camera_on": True}
                                    }))
                            
                            elif msg_type == "stop_camera":
                                self.capture_running = False
                                ct = getattr(self, "capture_thread", None)
                                if ct is not None and ct.is_alive():
                                    ct.join(timeout=2.0)
                                if self.camera is not None:
                                    self.camera.release()
                                    self.camera = None
                                await websocket.send(_ws_json({
                                    "type": "camera_status",
                                    "data": {"camera_on": False}
                                }))
                            
                            elif msg_type == "get_camera_status":
                                camera_on = self.camera is not None and self.camera.isOpened()
                                await websocket.send(_ws_json({
                                    "type": "camera_status",
                                    "data": {"camera_on": camera_on}
                                }))
                            
                            elif msg_type == "get_system_info":
                                if self.workflow:
                                    info = self.workflow.model_manager.get_system_info()
                                    await websocket.send(_ws_json({
                                        "type": "system_info",
                                        "data": info.to_dict()
                                    }))
                            
                            elif msg_type == "ping":
                                await websocket.send(_ws_json({
                                    "type": "pong",
                                    "data": {"server_time": time.time()}
                                }))
                                
                        except Exception as e:
                            logger.error(f"WS message error: {e}")
                            
                except websockets.exceptions.ConnectionClosed:
                    pass
                finally:
                    connected_clients.discard(websocket)
                    logger.info(f"WebSocket client disconnected: {client_id}")
            
            # 广播帧结果
            async def broadcast_loop():
                while not self.shutdown_requested:
                    if connected_clients and self.workflow and self.capture_running:
                        frame = self.get_latest_frame()
                        if frame is not None:
                            if self.session_active and self.workflow.workflow_state.is_active:
                                result = self.workflow.process_frame(frame)
                            else:
                                result = self.workflow.process_preview_frame(frame)
                            if result:
                                msg = _ws_json({
                                    "type": "frame_result",
                                    "data": result
                                })
                                await asyncio.gather(
                                    *[client.send(msg) for client in connected_clients],
                                    return_exceptions=True
                                )
                    await asyncio.sleep(0.25)  # ~4 FPS 广播
            
            # 启动服务器
            import uvicorn

            # websockets 12+：serve() 返回异步上下文管理器，需 async with，不能 create_task
            broadcast_task = asyncio.create_task(broadcast_loop())
            try:
                async with websockets.serve(ws_handler, self.host, self.ws_port):
                    config = uvicorn.Config(
                        app, host=self.host, port=self.api_port, log_level="warning"
                    )
                    server = uvicorn.Server(config)

                    logger.info(f"WebSocket server: ws://{self.host}:{self.ws_port}")
                    logger.info(f"REST API server: http://{self.host}:{self.api_port}")
                    logger.info(
                        f"MJPEG stream: http://{self.host}:{self.api_port}/api/video/stream"
                    )

                    await server.serve()
            finally:
                broadcast_task.cancel()
                try:
                    await broadcast_task
                except asyncio.CancelledError:
                    pass
            
        except ImportError as e:
            logger.error(f"Missing dependency: {e}")
            logger.info("Install with: pip install fastapi uvicorn websockets")
            return False
        except Exception as e:
            if isinstance(e, OSError) and getattr(e, "winerror", None) == 10048:
                logger.error(
                    "端口已被占用（常见为 8765 / 8000）。请关闭其它 FocusIsland-Backend 进程，"
                    "并避免同时使用 start.bat 与 Electron（electron/main.js 也会启动一套后端）。"
                )
            logger.exception(f"Server error: {e}")
            return False
    
    def cleanup(self):
        """Cleanup resources"""
        logger.info("Cleaning up...")
        self.shutdown_requested = True
        self.capture_running = False
        
        if self.camera:
            self.camera.release()
            self.camera = None
        
        if self.workflow:
            self.workflow.release()
            self.workflow = None
        
        logger.info("Cleanup complete")


async def main():
    """Main function"""
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
        # Initialize
        if not await server.initialize():
            logger.error("Failed to initialize server")
            return 1
        
        # Start server
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
