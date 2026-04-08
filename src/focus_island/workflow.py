"""
Complete Workflow Pipeline

Integrates all modules to implement the complete focus detection workflow:

Stage 1: System initialization and user identity binding (Auth)
Stage 2: Real-time perception and data extraction loop (Perception Loop)
Stage 3: Flexible state machine evaluation (State Evaluation)
Stage 4: Points settlement and data persistence (Reward)

Author: SSP Team
"""

from __future__ import annotations

import logging
import time
import os
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
from .auth import IdentityAuthenticator
from .ear import EARCalculator, EYEIndexConfig
from .stream_controller import FrameController, FaceSelector, AntiSpoofingMonitor
from .focus_fsm import SessionManager, FocusRuleChecker
from .websocket_server import WebSocketServer, WSMessage


logger = logging.getLogger(__name__)


# ==================== Internationalization Support ====================

class I18n:
    """Internationalization support class"""
    
    _current_locale = "zh"
    _translations = {
        "zh": {
            # States
            "state_idle": "Idle",
            "state_focused": "Focused",
            "state_warning": "Warning",
            "state_interrupted": "Interrupted",
            "state_paused": "Paused",
            
            # Warning reasons
            "warning_none": "None",
            "warning_head_away": "Head Away",
            "warning_eyes_closed": "Eyes Closed",
            "warning_no_face": "No Face",
            
            # Messages
            "no_face_detected": "No face detected",
            "face_saved": "Face saved",
            "identity_verified": "Identity verified",
            "cheating_detected": "Cheating detected",
            "session_started": "Session started",
            "session_ended": "Session ended",
            "face_not_bound": "Please bind face first",
            "face_bound": "Face bound successfully",
            "verification_failed": "Verification failed",
            "face_mismatch": "Face mismatch",
            "similarity_low": "Similarity too low",
            
            # Buttons and labels
            "btn_start": "Start Focus",
            "btn_stop": "Stop",
            "btn_pause": "Pause",
            "btn_resume": "Resume",
            "btn_bind": "Bind Face",
            "btn_verify": "Verify Face",
            "btn_camera_on": "Start Camera",
            "btn_camera_off": "Stop Camera",
            
            # Stats
            "stats_points": "Points",
            "stats_focus_time": "Focus Time",
            "stats_streak": "Streak",
            
            # Errors
            "error_no_face": "Please face the camera",
            "error_face_not_bound": "Please bind your face first",
            "error_face_detected": "Please click Start first"
        },
        "en": {
            # States
            "state_idle": "Idle",
            "state_focused": "Focused",
            "state_warning": "Warning",
            "state_interrupted": "Interrupted",
            "state_paused": "Paused",
            
            # Warning reasons
            "warning_none": "None",
            "warning_head_away": "Head Away",
            "warning_eyes_closed": "Eyes Closed",
            "warning_no_face": "No Face",
            
            # Messages
            "no_face_detected": "No face detected",
            "face_saved": "Face saved",
            "identity_verified": "Identity verified",
            "cheating_detected": "Cheating detected",
            "session_started": "Session started",
            "session_ended": "Session ended",
            "face_not_bound": "Please bind face first",
            "face_bound": "Face bound successfully",
            "verification_failed": "Verification failed",
            "face_mismatch": "Face mismatch",
            "similarity_low": "Similarity too low",
            
            # Buttons and labels
            "btn_start": "Start Focus",
            "btn_stop": "Stop",
            "btn_pause": "Pause",
            "btn_resume": "Resume",
            "btn_bind": "Bind Face",
            "btn_verify": "Verify Face",
            "btn_camera_on": "Start Camera",
            "btn_camera_off": "Stop Camera",
            
            # Stats
            "stats_points": "Points",
            "stats_focus_time": "Focus Time",
            "stats_streak": "Streak",
            
            # Errors
            "error_no_face": "Please face the camera",
            "error_face_not_bound": "Please bind your face first",
            "error_face_detected": "Please click Start first"
        }
    }
    
    @classmethod
    def set_locale(cls, locale: str) -> None:
        """Set current language"""
        if locale in cls._translations:
            cls._current_locale = locale
            logger.info(f"Locale set to: {locale}")
    
    @classmethod
    def get_locale(cls) -> str:
        """Get current language"""
        return cls._current_locale
    
    @classmethod
    def t(cls, key: str, **kwargs) -> str:
        """Translate text"""
        text = cls._translations.get(cls._current_locale, {}).get(key, key)
        
        # Support formatting
        if kwargs:
            try:
                return text.format(**kwargs)
            except (KeyError, ValueError):
                return text
        
        return text
    
    @classmethod
    def get_state_text(cls, state: str) -> str:
        """Get state text"""
        key_map = {
            "idle": "state_idle",
            "focused": "state_focused",
            "warning": "state_warning",
            "interrupted": "state_interrupted",
            "paused": "state_paused"
        }
        return cls.t(key_map.get(state, "state_idle"))
    
    @classmethod
    def get_warning_text(cls, reason: str) -> str:
        """Get warning reason text"""
        key_map = {
            "none": "warning_none",
            "head_away": "warning_head_away",
            "eyes_closed": "warning_eyes_closed",
            "no_face": "warning_no_face"
        }
        return cls.t(key_map.get(reason, "warning_none"))


class WorkFlowPhase(Enum):
    """Workflow phase"""
    IDLE = "idle"                    # Idle/not initialized
    AUTH = "auth"                   # Stage 1: Identity binding
    PERCEPTION = "perception"       # Stage 2: Real-time perception
    EVALUATION = "evaluation"       # Stage 3: State evaluation
    REWARD = "reward"              # Stage 4: Points settlement
    TERMINATED = "terminated"      # Session terminated


@dataclass
class WorkFlowState:
    """Workflow state"""
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
    """Perception result"""
    has_face: bool = False
    bbox: Optional[np.ndarray] = None
    face_confidence: float = 0.0
    
    # Head pose
    pitch: float = 0.0
    yaw: float = 0.0
    roll: float = 0.0
    
    # Eye state
    ear_left: float = 0.0
    ear_right: float = 0.0
    ear_avg: float = 0.0
    
    # Identity authentication
    embedding: Optional[np.ndarray] = None
    identity_verified: bool = False
    identity_similarity: float = 0.0
    is_cheating: bool = False
    
    # Performance
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
    """Complete focus detection workflow
    
    Four-stage workflow:
    1. AUTH: Initialize models, bind user identity
    2. PERCEPTION: Sample frames, extract data
    3. EVALUATION: State machine decision
    4. REWARD: Points settlement
    """
    
    def __init__(
        self,
        config: Optional[PipelineConfig] = None,
        use_cuda: bool = True,
        target_fps: float = 4.0,
        enable_visualization: bool = True
    ):
        """
        Initialize workflow
        
        Args:
            config: Pipeline configuration
            use_cuda: Enable CUDA
            target_fps: Target processing frame rate (default 4 FPS, power saving)
            enable_visualization: Enable visualization
        """
        self.config = config or PipelineConfig()
        self.use_cuda = use_cuda
        self.target_fps = target_fps
        self.enable_visualization = enable_visualization
        
        # Workflow state
        self.workflow_state = WorkFlowState()
        
        # Model manager
        self.model_manager: Optional[ModelManager] = None
        
        # Identity authenticator
        self.authenticator = IdentityAuthenticator(
            similarity_threshold=0.6,
            cheating_threshold=0.5,
            verification_interval=60.0  # Verify every 60 seconds
        )
        
        # EAR calculator
        self.ear_calculator = EARCalculator(self.config)
        
        # Frame controller (frame sampling)
        self.frame_controller = FrameController(target_fps=target_fps)
        
        # Face selector
        self.face_selector = FaceSelector()
        
        # Anti-spoofing monitor
        self.anti_spoofing = AntiSpoofingMonitor()
        
        # Session manager
        self.session_manager: Optional[SessionManager] = None
        
        # WebSocket
        self.ws_server: Optional[WebSocketServer] = None
        
        # Callbacks
        self._callbacks = {
            "phase_change": [],
            "state_change": [],
            "milestone": [],
            "interruption": [],
            "cheating_detected": [],
            "frame_result": []
        }
        
        # Last frame time
        self._last_frame_time = time.time()
        self._last_verification_time = time.time()
        # When not in focus: use rule checker to derive "preview" state (aligned with FSM focused/warning/idle)
        self._preview_rule_checker = FocusRuleChecker(self.config)
        self._last_preview_emit_ts = 0.0
        
        logger.info(f"FocusWorkFlow initialized: CUDA={use_cuda}, target_fps={target_fps}")
    
    def initialize(self) -> SystemInfo:
        """
        Stage 1: Initialize system, load models
        
        Loads:
        - RetinaFace (face detection)
        - ArcFace (512-dim feature vector)
        - Landmark106 (106-point landmarks)
        - HeadPose (3D head pose)
        """
        self.workflow_state.phase = WorkFlowPhase.AUTH
        
        logger.info("=" * 60)
        logger.info("PHASE 1: AUTH - Initializing System")
        logger.info("=" * 60)
        
        # Initialize model manager
        self.model_manager = ModelManager(
            use_cuda=self.use_cuda,
            detector_type="retinaface",
            recognition_model="arcface"
        )
        
        # Load all models
        logger.info("Loading models...")
        self.model_manager.load_all_models()
        
        # Warmup
        logger.info("Warming up models...")
        self.model_manager.warmup(iterations=3)
        
        # Get system info
        system_info = self.model_manager.get_system_info()
        logger.info(f"System info: GPU={system_info.gpu_available}")
        
        self._emit("phase_change", WorkFlowPhase.AUTH, "Models loaded")
        
        return system_info
    
    def verify_face(
        self,
        image: np.ndarray,
        user_id: str,
        language: str = "zh"
    ) -> dict:
        """
        Verify face (don't save, don't start focus)
        
        Flow:
        1. Detect face
        2. Extract feature vector
        3. Compare with locally saved face
        4. Return verification result
        
        Args:
            image: Current frame image
            user_id: User ID (email prefix)
            language: Language setting
            
        Returns:
            Verification result:
            - is_verified: Verification passed
            - is_bound: User has bound face
            - similarity: Similarity score
            - message: Message
        """
        I18n.set_locale(language)
        
        logger.info(f"Verifying face: user_id={user_id}")
        
        # Detect face
        faces = self.model_manager.detect_faces(image)
        
        if not faces:
            return {
                "success": False,
                "is_verified": False,
                "is_bound": self.authenticator.has_bound_face(user_id),
                "similarity": 0.0,
                "error": I18n.t("no_face_detected"),
                "error_code": "NO_FACE"
            }
        
        # Select largest/most centered face
        self.face_selector.update_image_params(image.shape[1], image.shape[0])
        bbox = self.face_selector.select_target_face(faces)
        
        if bbox is None:
            return {
                "success": False,
                "is_verified": False,
                "is_bound": self.authenticator.has_bound_face(user_id),
                "similarity": 0.0,
                "error": I18n.t("error_no_face"),
                "error_code": "SELECT_FAILED"
            }
        
        # Extract feature vector
        embedding = None
        for face in faces:
            if np.allclose(face.bbox, bbox, atol=1.0):
                embedding, _ = self.model_manager.extract_face_embedding(image, face)
                break
        
        if embedding is None:
            return {
                "success": False,
                "is_verified": False,
                "is_bound": self.authenticator.has_bound_face(user_id),
                "similarity": 0.0,
                "error": I18n.t("error_no_face"),
                "error_code": "NO_EMBEDDING"
            }
        
        # Compare with locally saved face
        verification_result = self.authenticator.verify_face(
            current_embedding=embedding,
            user_id=user_id
        )
        
        logger.info(f"Verification result: {verification_result}")
        
        return {
            "success": True,
            "is_verified": verification_result.get("is_verified", False),
            "is_bound": verification_result.get("is_bound", False),
            "similarity": verification_result.get("similarity", 0.0),
            "matched_user": verification_result.get("matched_user"),
            "message": verification_result.get("message", "")
        }
    
    def bind_face(
        self,
        image: np.ndarray,
        user_id: str,
        language: str = "zh"
    ) -> dict:
        """
        Bind face (save to local)
        
        Flow:
        1. Detect face
        2. Extract feature vector
        3. Save to local folder
        4. Return binding result
        
        Note: One account can only bind one face, re-binding will overwrite
        
        Args:
            image: Current frame image
            user_id: User ID (email prefix)
            language: Language setting
            
        Returns:
            Binding result:
            - success: Success
            - is_bound: Is bound
            - folder: Saved folder path
        """
        I18n.set_locale(language)
        
        logger.info(f"Binding face: user_id={user_id}")
        
        # Detect face
        faces = self.model_manager.detect_faces(image)
        
        if not faces:
            return {
                "success": False,
                "is_bound": False,
                "error": I18n.t("no_face_detected"),
                "error_code": "NO_FACE"
            }
        
        # Select largest/most centered face
        self.face_selector.update_image_params(image.shape[1], image.shape[0])
        bbox = self.face_selector.select_target_face(faces)
        
        if bbox is None:
            return {
                "success": False,
                "is_bound": self.authenticator.has_bound_face(user_id),
                "error": I18n.t("error_no_face"),
                "error_code": "SELECT_FAILED"
            }
        
        # Extract feature vector and align face
        embedding = None
        aligned_face = None
        for face in faces:
            if np.allclose(face.bbox, bbox, atol=1.0):
                embedding, aligned_face = self.model_manager.extract_face_embedding(image, face)
                break
        
        if embedding is None:
            return {
                "success": False,
                "is_bound": self.authenticator.has_bound_face(user_id),
                "error": I18n.t("error_no_face"),
                "error_code": "NO_EMBEDDING"
            }
        
        # Check if already bound
        was_bound = self.authenticator.has_bound_face(user_id)
        
        # Save face data to local folder
        save_result = self.authenticator.save_user_face_data(
            user_id=user_id,
            face_image=aligned_face,
            embedding=embedding,
            metadata={
                "bound_at": datetime.now().isoformat(),
                "was_bound": was_bound
            }
        )
        
        logger.info(f"Face bound: {save_result}")
        
        return {
            "success": save_result.get("success", False),
            "is_bound": True,
            "was_bound": was_bound,
            "folder": save_result.get("folder", ""),
            "safe_name": save_result.get("safe_name", ""),
            "message": I18n.t("face_saved") if save_result.get("success") else save_result.get("error", "Save failed")
        }
    
    def start_focus(
        self,
        image: np.ndarray,
        user_id: str,
        seat_id: str = "default",
        language: str = "zh"
    ) -> dict:
        """
        Start focus detection
        
        Prerequisites:
        1. User must have bound face
        2. Current face must pass verification
        
        Flow:
        1. Verify face
        2. Initialize session manager
        3. Update workflow state
        
        Args:
            image: Current frame image
            user_id: User ID (email prefix)
            seat_id: Seat ID
            language: Language setting
            
        Returns:
            Start result:
            - success: Success
            - is_verified: Verification passed
            - is_bound: Is bound
            - session_id: Session ID
        """
        I18n.set_locale(language)
        
        logger.info(f"Starting focus: user_id={user_id}, seat_id={seat_id}")
        
        # 先验证人脸
        faces = self.model_manager.detect_faces(image)
        
        if not faces:
            return {
                "success": False,
                "is_verified": False,
                "is_bound": self.authenticator.has_bound_face(user_id),
                "error": I18n.t("no_face_detected"),
                "error_code": "NO_FACE"
            }
        
        # 选择目标人脸
        self.face_selector.update_image_params(image.shape[1], image.shape[0])
        bbox = self.face_selector.select_target_face(faces)
        
        if bbox is None:
            return {
                "success": False,
                "is_verified": False,
                "is_bound": self.authenticator.has_bound_face(user_id),
                "error": I18n.t("error_no_face"),
                "error_code": "SELECT_FAILED"
            }
        
        # 提取特征向量
        embedding = None
        for face in faces:
            if np.allclose(face.bbox, bbox, atol=1.0):
                embedding, _ = self.model_manager.extract_face_embedding(image, face)
                break
        
        if embedding is None:
            return {
                "success": False,
                "is_verified": False,
                "is_bound": self.authenticator.has_bound_face(user_id),
                "error": I18n.t("error_no_face"),
                "error_code": "NO_EMBEDDING"
            }
        
        # 验证人脸
        verification_result = self.authenticator.verify_face(
            current_embedding=embedding,
            user_id=user_id
        )
        
        if not verification_result.get("is_verified", False):
            return {
                "success": False,
                "is_verified": False,
                "is_bound": verification_result.get("is_bound", False),
                "similarity": verification_result.get("similarity", 0.0),
                "error": verification_result.get("message", "Verification failed"),
                "error_code": "VERIFICATION_FAILED"
            }
        
        # 检查是否已绑定
        if not self.authenticator.has_bound_face(user_id):
            return {
                "success": False,
                "is_verified": True,
                "is_bound": False,
                "error": I18n.t("error_face_not_bound"),
                "error_code": "NOT_BOUND"
            }
        
        # Bind user identity (for subsequent anti-cheating verification)
        user_data = self.authenticator.load_user_face_data(user_id)
        if user_data:
            self.authenticator.bind_user(
                user_id=user_id,
                seat_id=seat_id,
                embedding=user_data["embedding"]
            )
        
        # Initialize session manager
        self.session_manager = SessionManager(
            config=self.config,
            user_id=user_id,
            seat_id=seat_id
        )
        self.session_manager.start_session()
        
        # Update workflow state
        self.workflow_state.phase = WorkFlowPhase.PERCEPTION
        self.workflow_state.is_active = True
        self.workflow_state.start_time = time.time()
        self.workflow_state.user_id = user_id
        self.workflow_state.seat_id = seat_id
        self.workflow_state.session_id = self.session_manager.session_id
        
        # Reset frame counter
        self.frame_controller.reset()
        self.anti_spoofing.reset()
        
        logger.info("=" * 60)
        logger.info(f"FOCUS STARTED: user={user_id}, session={self.session_manager.session_id}")
        logger.info("=" * 60)
        
        return {
            "success": True,
            "is_verified": True,
            "is_bound": True,
            "session_id": self.session_manager.session_id,
            "user_id": user_id,
            "seat_id": seat_id,
            "message": I18n.t("session_started")
        }
    
    def _analyze_perception(
        self,
        image: np.ndarray,
        *,
        run_periodic_identity: bool,
    ) -> PerceptionResult:
        """人脸检测（RetinaFace）+ 姿态 + EAR；可选周期性身份验证。"""
        faces = self.model_manager.detect_faces(image)
        target_bbox = self.face_selector.select_target_face(faces)
        perception = PerceptionResult()
        
        if target_bbox is None:
            perception.has_face = False
            self.anti_spoofing.update(None)
            return perception
        
        perception.has_face = True
        perception.bbox = target_bbox
        
        target_face = None
        for face in faces:
            if np.allclose(face.bbox, target_bbox, atol=1.0):
                target_face = face
                break
        
        if target_face is None and faces:
            target_face = faces[0]
        
        if not target_face:
            self.anti_spoofing.update(None)
            return perception
        
        perception.face_confidence = target_face.confidence
        
        x1, y1, x2, y2 = map(int, target_bbox[:4])
        face_crop = image[y1:y2, x1:x2]
        
        if face_crop.size > 0:
            t0 = time.time()
            head_pose = self.model_manager.estimate_head_pose(face_crop)
            perception.detection_time_ms += (time.time() - t0) * 1000
            perception.pitch = head_pose.pitch
            perception.yaw = head_pose.yaw
            perception.roll = head_pose.roll
        
        t0 = time.time()
        landmarks_106 = self.model_manager.get_landmarks_106(image, target_bbox)
        perception.detection_time_ms += (time.time() - t0) * 1000
        
        eye_data = self.ear_calculator.get_eye_data(landmarks_106)
        perception.ear_left = eye_data.ear_left
        perception.ear_right = eye_data.ear_right
        perception.ear_avg = eye_data.ear_avg
        
        if run_periodic_identity and self.authenticator.should_verify():
            t0 = time.time()
            embedding, _ = self.model_manager.extract_face_embedding(image, target_face)
            perception.embedding = embedding
            perception.detection_time_ms += (time.time() - t0) * 1000
            
            verification = self.authenticator.verify_identity(embedding)
            perception.identity_verified = verification.is_verified
            perception.identity_similarity = verification.similarity
            perception.is_cheating = verification.is_cheating
            
            if verification.is_cheating:
                logger.warning(
                    "CHEATING DETECTED: similarity=%.4f", verification.similarity
                )
                self._emit("cheating_detected", verification.to_dict())
        
        self.anti_spoofing.update(target_bbox)
        return perception
    
    def process_preview_frame(self, image: np.ndarray) -> Optional[dict]:
        """
        未进入专注会话时，基于当前帧推导预览状态（idle / focused / warning），
        便于前端在未 start_session 时仍能看到人脸与姿态检测是否工作。
        """
        if not self.model_manager:
            return None
        if self.workflow_state.is_active:
            return None
        
        now = time.time()
        if now - self._last_preview_emit_ts < 0.22:
            return None
        self._last_preview_emit_ts = now
        
        delta_time = max(now - self._last_frame_time, 0.001)
        self.face_selector.update_image_params(image.shape[1], image.shape[0])
        
        frame_start = time.time()
        perception = self._analyze_perception(
            image, run_periodic_identity=False
        )
        perception.total_time_ms = (time.time() - frame_start) * 1000
        
        rules = self._preview_rule_checker.check_all(
            perception.has_face,
            perception.pitch,
            perception.yaw,
            perception.ear_avg,
        )
        if not perception.has_face:
            preview_state = FocusState.IDLE.value
            wr = WarningReason.NO_FACE.value
        elif rules.overall_valid:
            preview_state = FocusState.FOCUSED.value
            wr = WarningReason.NONE.value
        else:
            preview_state = FocusState.WARNING.value
            wr = rules.warning_reason.value
        
        pd = perception.to_dict()
        return {
            "workflow": {
                "phase": WorkFlowPhase.IDLE.value,
                "session_id": None,
                "frame_count": self.workflow_state.frame_count,
                "processed_frames": 0,
                "fps": 1.0 / delta_time,
                "preview": True,
                "session_active": False,
            },
            "perception": pd,
            "session": {
                "session_id": None,
                "frame_id": -1,
                "state": preview_state,
                "warning_reason": wr,
                "is_valid": rules.overall_valid,
                "head_pose": pd["head_pose"],
                "eye": pd["eye"],
                "stats": {
                    "total_points": 0,
                    "focus_time_min": 0.0,
                    "current_streak_min": 0.0,
                },
                "identity_verified": False,
                "preview": True,
            },
            "i18n": {
                "state_text": I18n.get_state_text(preview_state),
                "warning_text": I18n.get_warning_text(wr),
                "language": I18n.get_locale(),
            },
        }
    
    def process_frame(self, image: np.ndarray) -> Optional[dict]:
        """
        Process single frame (Stage 2+3+4)
        
        Includes:
        - Frame sampling control
        - Face detection and selection
        - EAR calculation
        - Head pose estimation
        - Identity verification (periodic)
        - State machine processing
        - Points calculation
        
        Args:
            image: Input image
            
        Returns:
            Processing result or None (if skip this frame)
        """
        if not self.workflow_state.is_active:
            return None
        
        current_time = time.time()
        delta_time = current_time - self._last_frame_time
        self._last_frame_time = current_time
        
        # Update image params
        self.face_selector.update_image_params(image.shape[1], image.shape[0])
        
        # ========== Stage 2: Perception ==========
        
        # 1. Frame sampling control
        if not self.frame_controller.should_process_frame():
            return None  # Skip this frame
        
        frame_start = time.time()
        self.workflow_state.frame_count += 1
        
        perception = self._analyze_perception(
            image, run_periodic_identity=True
        )
        perception.total_time_ms = (time.time() - frame_start) * 1000
        
        # ========== Stage 3: State Evaluation ==========
        
        # Check if current frame passes identity verification
        # - If user hasn't bound (start_focus failed) -> Not verified
        # - If user has bound and within verification interval (just bound) -> Verified
        # - If user has bound and needs verification -> Check latest verification result
        authenticator = self.authenticator
        if authenticator.current_user is None:
            is_verified = False
        elif not authenticator.should_verify():
            # Just bound or within verification interval, no need to re-verify, considered verified
            is_verified = True
        else:
            # Need verification, use latest verification result
            is_verified = getattr(perception, 'identity_verified', False)
        
        session_result = None
        if self.session_manager:
            session_result = self.session_manager.process_frame(
                has_face=perception.has_face,
                pitch=perception.pitch,
                yaw=perception.yaw,
                ear_avg=perception.ear_avg,
                frame_id=self.workflow_state.processed_frames,
                delta_time=delta_time,
                identity_verified=is_verified
            )
            
            # Sync perception.identity_verified with actual verification result
            perception.identity_verified = is_verified
        
        # ========== Stage 4: Points Settlement ==========
        # Points are automatically calculated in session_manager
        
        # Update workflow state
        self.workflow_state.processed_frames += 1
        self.workflow_state.last_update = time.time()
        
        # Build complete result
        result = {
            "workflow": {
                "phase": self.workflow_state.phase.value,
                "session_id": self.workflow_state.session_id,
                "frame_count": self.workflow_state.frame_count,
                "processed_frames": self.workflow_state.processed_frames,
                "fps": 1.0 / max(delta_time, 0.001),
                "session_active": True,
                "preview": False,
            },
            "perception": perception.to_dict(),
            "session": session_result if session_result else None,
            # Internationalized state text
            "i18n": {
                "state_text": I18n.get_state_text(session_result.get("state", "idle") if session_result else "idle"),
                "warning_text": I18n.get_warning_text(session_result.get("warning_reason", "none") if session_result else "none"),
                "language": I18n.get_locale()
            }
        }
        
        # 如果有统计信息，添加国际化文本
        if session_result and "stats" in session_result:
            stats = session_result["stats"]
            stats["i18n"] = {
                "points_label": I18n.t("stats_points"),
                "focus_time_label": I18n.t("stats_focus_time"),
                "streak_label": I18n.t("stats_streak")
            }
        
        # 触发回调
        self._emit("frame_result", result)
        
        # WebSocket 广播
        if self.ws_server and self.ws_server.is_running:
            msg = WSMessage("frame_result", data=result)
            asyncio_run(self.ws_server.broadcast(msg))
        
        return result
    
    def end_session(self) -> dict:
        """End session"""
        if not self.workflow_state.is_active:
            return {"error": "No active session"}
        
        logger.info("Ending session...")
        
        # Get final summary
        summary = self.session_manager.end_session() if self.session_manager else {}
        
        # Unbind user
        self.authenticator.unbind_user()
        
        # Update state
        self.workflow_state.phase = WorkFlowPhase.TERMINATED
        self.workflow_state.is_active = False
        
        # Reset components
        self.frame_controller.reset()
        self.face_selector.reset()
        self.anti_spoofing.reset()
        
        logger.info(f"Session ended: {summary}")
        
        return summary
    
    def get_current_state(self) -> dict:
        """Get current state"""
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
        """Register callback"""
        if event in self._callbacks:
            self._callbacks[event].append(callback)
    
    def _emit(self, event: str, *args, **kwargs) -> None:
        """Emit callback"""
        for callback in self._callbacks.get(event, []):
            try:
                callback(*args, **kwargs)
            except Exception as e:
                logger.error(f"Callback error in {event}: {e}")
    
    def visualize_frame(self, image: np.ndarray, result: dict) -> np.ndarray:
        """Visualize processing result"""
        if not self.enable_visualization:
            return image
        
        vis = image.copy()
        h, w = image.shape[:2]
        
        perception = result.get("perception", {})
        session = result.get("session", {})
        workflow = result.get("workflow", {})
        
        # State colors
        state = session.get("current_state", "idle")
        state_colors = {
            "idle": (128, 128, 128),
            "focused": (0, 255, 0),
            "warning": (0, 255, 255),
            "interrupted": (0, 0, 255)
        }
        color = state_colors.get(state, (255, 255, 255))
        
        # Info panel
        info_y = 25
        line_h = 22
        font = cv2.FONT_HERSHEY_SIMPLEX
        
        # User info
        cv2.putText(vis, f"User: {self.workflow_state.user_id or 'N/A'}", 
                    (10, info_y), font, 0.5, (255, 255, 255), 1)
        info_y += line_h
        
        cv2.putText(vis, f"Seat: {self.workflow_state.seat_id or 'N/A'}", 
                    (10, info_y), font, 0.5, (255, 255, 255), 1)
        info_y += line_h
        
        # State
        state_text = f"State: {state.upper()}"
        cv2.putText(vis, state_text, (10, info_y), font, 0.6, color, 2)
        info_y += line_h
        
        # FPS
        fps = workflow.get("fps", 0)
        cv2.putText(vis, f"FPS: {fps:.1f} (target: {self.target_fps})", 
                    (10, info_y), font, 0.4, (200, 200, 200), 1)
        info_y += line_h
        
        # Head pose
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
        
        # Identity verification
        identity = perception.get("identity", {})
        if identity.get("similarity", 0) > 0:
            sim = identity.get("similarity", 0)
            sim_color = (0, 255, 0) if sim > 0.6 else (0, 255, 255) if sim > 0.5 else (0, 0, 255)
            cv2.putText(vis, f"Identity: {sim:.4f}", 
                        (10, info_y), font, 0.4, sim_color, 1)
            info_y += line_h
        
        # Points
        score = session.get("score_summary", {})
        points = score.get("total_points", 0)
        focus_time = score.get("current_streak_min", 0)
        cv2.putText(vis, f"Points: {points}  Focus: {focus_time:.1f}min", 
                    (10, info_y), font, 0.4, (255, 255, 0), 1)
        info_y += line_h
        
        # Grace time
        grace = session.get("fsm_stats", {}).get("grace_remaining", 0)
        if grace > 0:
            cv2.putText(vis, f"Grace: {grace:.1f}s", 
                        (10, info_y), font, 0.4, (0, 255, 255), 1)
            info_y += line_h
        
        # Border
        border_color = color
        if identity.get("is_cheating", False):
            border_color = (0, 0, 255)  # Red border indicates cheating
        cv2.rectangle(vis, (0, 0), (w - 1, h - 1), border_color, 3)
        
        return vis
    
    def release(self) -> None:
        """Release resources"""
        if self.model_manager:
            self.model_manager.release()
        
        if self.ws_server:
            asyncio_run(self.ws_server.stop())
        
        logger.info("Resources released")


def asyncio_run(coro):
    """Run async coroutine"""
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        future = asyncio.ensure_future(coro)
        return future
    except RuntimeError:
        return asyncio.run(coro)
