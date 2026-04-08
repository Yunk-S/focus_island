"""
REST API Interface Module

Provides HTTP REST API for session management and status queries.

Author: SSP Team
"""

from __future__ import annotations

import logging
import time
from typing import Optional, Callable, Any
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

try:
    from fastapi import FastAPI, HTTPException, Request, Response
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, StreamingResponse
    from pydantic import BaseModel, Field
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False
    # Placeholder classes for type hints
    class BaseModel:
        pass
    class Request:
        pass
    class Response:
        pass


logger = logging.getLogger(__name__)


# ============== API Models ==============

class SessionState(str, Enum):
    """Session state enum"""
    IDLE = "idle"
    FOCUSED = "focused"
    WARNING = "warning"
    INTERRUPTED = "interrupted"
    PAUSED = "paused"


class StartSessionRequest(BaseModel if FASTAPI_AVAILABLE else object):
    """Start session request"""
    user_id: Optional[str] = None
    config: Optional[dict] = None


class ProcessFrameRequest(BaseModel if FASTAPI_AVAILABLE else object):
    """Process frame request"""
    image: str  # Base64 encoded image
    timestamp: Optional[float] = None


@dataclass
class FrameResult:
    """Frame processing result"""
    session_id: str
    frame_id: int
    timestamp: float
    state: str
    warning_reason: str
    has_face: bool
    head_pose: dict
    eye_data: dict
    stats: dict


@dataclass
class SessionSummary:
    """Session summary"""
    session_id: str
    user_id: Optional[str]
    start_time: str
    current_state: str
    total_points: int
    focus_time_min: float
    interruption_count: int
    warning_count: int


@dataclass
class SystemStatus:
    """System status"""
    status: str
    uptime_seconds: float
    active_sessions: int
    total_frames_processed: int
    gpu_available: bool
    gpu_name: str
    version: str


# ============== REST API Server ==============

class RESTAPIServer:
    """REST API Server"""
    
    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8000,
        cors_enabled: bool = True,
        cors_origins: Optional[list[str]] = None
    ):
        """
        Initialize REST API Server
        
        Args:
            host: Listen address
            port: Listen port
            cors_enabled: Enable CORS
            cors_origins: CORS allowed origins
        """
        if not FASTAPI_AVAILABLE:
            raise ImportError("FastAPI is required for REST API. Install with: pip install fastapi uvicorn")
        
        self.host = host
        self.port = port
        self.cors_enabled = cors_enabled
        self.cors_origins = cors_origins or ["*"]
        
        # Create FastAPI app
        self.app = FastAPI(
            title="SSP Backend API",
            description="Smart Study Spot Backend API",
            version="1.0.0"
        )
        
        # Store references
        self._session_manager = None
        self._pipeline = None
        self._system_info = None
        self._start_time = time.time()
        self._total_frames = 0
        
        # Callbacks
        self._handlers: dict[str, Callable] = {}
        
        # Setup middleware and routes
        self._setup_middleware()
        self._setup_routes()
        
        logger.info(f"RESTAPIServer initialized: {host}:{port}")
    
    def _setup_middleware(self) -> None:
        """Setup middleware"""
        if self.cors_enabled:
            self.app.add_middleware(
                CORSMiddleware,
                allow_origins=self.cors_origins,
                allow_credentials=True,
                allow_methods=["*"],
                allow_headers=["*"],
            )
    
    def _setup_routes(self) -> None:
        """Setup routes"""
        # 健康检查
        @self.app.get("/health", tags=["System"])
        async def health_check():
            return {"status": "healthy", "timestamp": datetime.now().isoformat()}
        
        # 系统状态
        @self.app.get("/api/status", response_model=SystemStatus, tags=["System"])
        async def get_system_status():
            return SystemStatus(
                status="running",
                uptime_seconds=time.time() - self._start_time,
                active_sessions=1 if self._session_manager else 0,
                total_frames_processed=self._total_frames,
                gpu_available=self._system_info.gpu_available if self._system_info else False,
                gpu_name=self._system_info.gpu_name if self._system_info else "N/A",
                version="1.0.0"
            )
        
        # 会话管理
        @self.app.post("/api/sessions", tags=["Session"])
        async def start_session(request: StartSessionRequest):
            if not self._session_manager:
                raise HTTPException(status_code=503, detail="Pipeline not initialized")
            
            self._session_manager.reset_session()
            if request.user_id:
                self._session_manager.user_id = request.user_id
            
            return {
                "session_id": self._session_manager.session_id,
                "status": "started"
            }
        
        @self.app.get("/api/sessions/{session_id}", tags=["Session"])
        async def get_session(session_id: str):
            if not self._session_manager:
                raise HTTPException(status_code=503, detail="Pipeline not initialized")
            
            if self._session_manager.session_id != session_id:
                raise HTTPException(status_code=404, detail="Session not found")
            
            return self._session_manager.get_session_summary()
        
        @self.app.delete("/api/sessions/{session_id}", tags=["Session"])
        async def stop_session(session_id: str):
            if not self._session_manager:
                raise HTTPException(status_code=503, detail="Pipeline not initialized")
            
            if self._session_manager.session_id != session_id:
                raise HTTPException(status_code=404, detail="Session not found")
            
            self._session_manager.reset_session()
            
            return {"session_id": session_id, "status": "stopped"}
        
        @self.app.get("/api/sessions/{session_id}/summary", tags=["Session"])
        async def get_session_summary(session_id: str):
            if not self._session_manager:
                raise HTTPException(status_code=503, detail="Pipeline not initialized")
            
            if self._session_manager.session_id != session_id:
                raise HTTPException(status_code=404, detail="Session not found")
            
            return self._session_manager.get_session_summary()
        
        # 帧处理
        @self.app.post("/api/frames", tags=["Processing"])
        async def process_frame(request: ProcessFrameRequest):
            if not self._pipeline:
                raise HTTPException(status_code=503, detail="Pipeline not initialized")
            
            import base64
            import numpy as np
            import cv2
            
            # 解码图像
            try:
                image_data = base64.b64decode(request.image)
                nparr = np.frombuffer(image_data, np.uint8)
                image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                
                if image is None:
                    raise HTTPException(status_code=400, detail="Invalid image data")
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to decode image: {str(e)}")
            
            # 处理帧
            result = self._pipeline.process_frame(image)
            self._total_frames += 1
            
            return result
        
        # 配置
        @self.app.get("/api/config", tags=["Config"])
        async def get_config():
            if not self._pipeline:
                raise HTTPException(status_code=503, detail="Pipeline not initialized")
            
            return self._pipeline.get_config()
        
        @self.app.put("/api/config", tags=["Config"])
        async def update_config(config: dict):
            if not self._pipeline:
                raise HTTPException(status_code=503, detail="Pipeline not initialized")
            
            self._pipeline.update_config(config)
            
            return {"status": "updated"}
        
        # 模型信息
        @self.app.get("/api/models", tags=["Models"])
        async def get_model_info():
            if not self._system_info:
                raise HTTPException(status_code=503, detail="System info not available")
            
            return self._system_info.to_dict()
    
    def set_pipeline(self, pipeline) -> None:
        """Set pipeline reference"""
        self._pipeline = pipeline
        if pipeline:
            self._session_manager = pipeline.session_manager
    
    def set_system_info(self, system_info) -> None:
        """Set system info"""
        self._system_info = system_info
    
    def get_app(self):
        """Get FastAPI app"""
        return self.app


def create_api_server(
    host: str = "0.0.0.0",
    port: int = 8000,
    cors_enabled: bool = True,
    cors_origins: Optional[list[str]] = None
) -> RESTAPIServer:
    """Create API server"""
    return RESTAPIServer(host, port, cors_enabled, cors_origins)
