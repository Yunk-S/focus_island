"""
Data Type Definition Module

Defines data structures used in the system, including focus states, session data, frame results, etc.

Author: SSP Team
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional
from datetime import datetime
import json


class FocusState(Enum):
    """Focus state enum"""
    IDLE = "idle"           # No face or not started
    FOCUSED = "focused"     # Focusing
    WARNING = "warning"     # Deviation or eye closed warning
    INTERRUPTED = "interrupted"  # Interrupted
    PAUSED = "paused"       # Paused


class WarningReason(Enum):
    """Warning reason enum"""
    NONE = "none"
    HEAD_AWAY = "head_away"      # Head away
    EYES_CLOSED = "eyes_closed"  # Eyes closed
    NO_FACE = "no_face"          # No face detected


@dataclass
class HeadPoseData:
    """Head pose data"""
    pitch: float = 0.0      # Pitch angle (degrees)
    yaw: float = 0.0        # Yaw angle (degrees)
    roll: float = 0.0       # Roll angle (degrees)
    is_valid: bool = False  # Is within valid range

    def to_dict(self) -> dict:
        return {
            "pitch": round(self.pitch, 2),
            "yaw": round(self.yaw, 2),
            "roll": round(self.roll, 2),
            "is_valid": self.is_valid
        }


@dataclass
class EyeData:
    """Eye state data"""
    ear_left: float = 0.0       # Left eye EAR value
    ear_right: float = 0.0      # Right eye EAR value
    ear_avg: float = 0.0        # Average EAR value
    is_open: bool = True        # Is open
    consecutive_closed: int = 0  # Consecutive closed frames

    def to_dict(self) -> dict:
        return {
            "ear_left": round(self.ear_left, 4),
            "ear_right": round(self.ear_right, 4),
            "ear_avg": round(self.ear_avg, 4),
            "is_open": self.is_open,
            "consecutive_closed": self.consecutive_closed
        }


@dataclass
class FrameResult:
    """Single frame processing result"""
    timestamp: float = 0.0          # Timestamp (seconds)
    frame_id: int = 0               # Frame ID
    has_face: bool = False           # Face detected
    face_confidence: float = 0.0    # Face confidence
    
    # Head pose
    head_pose: HeadPoseData = field(default_factory=HeadPoseData)
    
    # Eye state
    eye_data: EyeData = field(default_factory=EyeData)
    
    # Focus state
    focus_state: FocusState = FocusState.IDLE
    warning_reason: WarningReason = WarningReason.NONE
    
    # Performance data
    detection_time_ms: float = 0.0   # Detection time (ms)
    total_time_ms: float = 0.0      # Total processing time (ms)

    def to_dict(self) -> dict:
        return {
            "timestamp": round(self.timestamp, 3),
            "frame_id": self.frame_id,
            "has_face": self.has_face,
            "face_confidence": round(self.face_confidence, 3),
            "head_pose": self.head_pose.to_dict(),
            "eye_data": self.eye_data.to_dict(),
            "focus_state": self.focus_state.value,
            "warning_reason": self.warning_reason.value,
            "detection_time_ms": round(self.detection_time_ms, 2),
            "total_time_ms": round(self.total_time_ms, 2)
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict())


@dataclass
class Milestone:
    """Milestone configuration"""
    duration_minutes: int
    bonus_points: int
    reached: bool = False
    reached_at: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "duration_minutes": self.duration_minutes,
            "bonus_points": self.bonus_points,
            "reached": self.reached,
            "reached_at": self.reached_at
        }


@dataclass
class SessionStats:
    """Session statistics"""
    # Time statistics
    session_start_time: float = 0.0          # Session start timestamp
    total_focus_time: float = 0.0           # Total focus time (seconds)
    total_warning_time: float = 0.0          # Total warning time (seconds)
    last_focus_start: float = 0.0            # Last focus start time
    is_in_focus: bool = False                # Currently in focus state
    
    # Count statistics
    interruption_count: int = 0              # Interruption count
    warning_count: int = 0                   # Warning count
    
    # Points statistics
    current_streak_minutes: float = 0.0      # Current consecutive focus duration (minutes)
    total_points: int = 0                    # Total points
    bonus_points: int = 0                    # Milestone bonus points
    milestones: list[Milestone] = field(default_factory=list)
    
    # Real-time state
    current_state: FocusState = FocusState.IDLE
    grace_period_remaining: float = 0.0      # Remaining grace time
    
    def to_dict(self) -> dict:
        return {
            "session_start_time": self.session_start_time,
            "total_focus_time": round(self.total_focus_time, 2),
            "total_warning_time": round(self.total_warning_time, 2),
            "current_streak_minutes": round(self.current_streak_minutes, 2),
            "interruption_count": self.interruption_count,
            "warning_count": self.warning_count,
            "total_points": self.total_points,
            "bonus_points": self.bonus_points,
            "current_state": self.current_state.value,
            "milestones": [m.to_dict() for m in self.milestones]
        }


@dataclass
class SessionData:
    """Complete session data"""
    session_id: str = ""                      # Session ID
    user_id: Optional[str] = None             # User ID
    start_time: datetime = field(default_factory=datetime.now)
    end_time: Optional[datetime] = None
    is_active: bool = True

    stats: SessionStats = field(default_factory=SessionStats)
    # Ring buffer: keep only the last MAX_FRAME_RESULTS entries to avoid memory growth
    _frame_results: list = field(default_factory=list)
    _MAX_FRAME_RESULTS: int = field(default=100, repr=False)

    @property
    def frame_results(self) -> list:
        return self._frame_results

    def add_frame_result(self, result: FrameResult) -> None:
        """Add a frame result with automatic culling of old entries."""
        self._frame_results.append(result)
        if len(self._frame_results) > self._MAX_FRAME_RESULTS:
            self._frame_results[:] = self._frame_results[-self._MAX_FRAME_RESULTS:]

    def clear_frame_results(self) -> None:
        """Free all frame results and release memory."""
        self._frame_results.clear()

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "is_active": self.is_active,
            "stats": self.stats.to_dict(),
            "frame_count": len(self._frame_results)
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)


@dataclass
class FocusRuleResult:
    """Focus rule check result"""
    pose_valid: bool = True           # Pose valid
    eyes_valid: bool = True           # Eye state valid
    overall_valid: bool = True        # Overall valid
    warning_reason: WarningReason = WarningReason.NONE
    details: dict = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return {
            "pose_valid": self.pose_valid,
            "eyes_valid": self.eyes_valid,
            "overall_valid": self.overall_valid,
            "warning_reason": self.warning_reason.value,
            "details": self.details
        }


@dataclass
class PipelineConfig:
    """Pipeline configuration"""
    # Head pose thresholds
    pitch_threshold: float = 20.0
    yaw_threshold: float = 25.0
    roll_threshold: float = 30.0
    
    # EAR thresholds
    ear_threshold: float = 0.18
    consecutive_eye_closed_threshold: int = 2
    
    # Grace period
    grace_period_seconds: float = 5.0
    
    # Scoring
    points_per_minute: int = 10
    daily_limit: int = 500
    
    # Eye landmark indices (106-point landmarks)
    left_eye_indices: list[int] = field(default_factory=lambda: [63, 64, 65, 66, 67, 68])
    right_eye_indices: list[int] = field(default_factory=lambda: [72, 73, 74, 75, 76, 77])
    
    @classmethod
    def from_dict(cls, config: dict) -> "PipelineConfig":
        """Create config from dict"""
        hp = config.get("headpose", {})
        ear = config.get("ear", {})
        fsm = config.get("focus_fsm", {})
        scoring = config.get("scoring", {})
        
        milestones = []
        for m in scoring.get("milestones", []):
            milestones.append(Milestone(
                duration_minutes=m.get("duration_minutes", 25),
                bonus_points=m.get("bonus_points", 50)
            ))
        
        cfg = cls(
            pitch_threshold=hp.get("pitch_threshold", 20.0),
            yaw_threshold=hp.get("yaw_threshold", 25.0),
            roll_threshold=hp.get("roll_threshold", 30.0),
            ear_threshold=ear.get("threshold", 0.18),
            consecutive_eye_closed_threshold=ear.get("consecutive_frames_threshold", 2),
            grace_period_seconds=fsm.get("grace_period_seconds", 5.0),
            points_per_minute=scoring.get("points_per_minute", 10),
            daily_limit=scoring.get("daily_limit", 500),
            left_eye_indices=ear.get("left_eye_indices", [63, 64, 65, 66, 67, 68]),
            right_eye_indices=ear.get("right_eye_indices", [72, 73, 74, 75, 76, 77])
        )
        return cfg


@dataclass
class SystemInfo:
    """System info"""
    gpu_available: bool = False
    gpu_name: str = ""
    onnx_providers: list[str] = field(default_factory=list)
    model_loaded: bool = False
    
    def to_dict(self) -> dict:
        return {
            "gpu_available": self.gpu_available,
            "gpu_name": self.gpu_name,
            "onnx_providers": self.onnx_providers,
            "model_loaded": self.model_loaded
        }
