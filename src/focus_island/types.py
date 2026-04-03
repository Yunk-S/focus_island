"""
数据类型定义模块

定义系统中使用的数据结构，包括专注状态、会话数据、帧结果等。

Author: SSP Team
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional
from datetime import datetime
import json


class FocusState(Enum):
    """专注状态枚举"""
    IDLE = "idle"           # 无脸或未开始
    FOCUSED = "focused"     # 专注中
    WARNING = "warning"     # 偏离或闭眼警告中
    INTERRUPTED = "interrupted"  # 中断
    PAUSED = "paused"       # 暂停


class WarningReason(Enum):
    """警告原因枚举"""
    NONE = "none"
    HEAD_AWAY = "head_away"      # 头部偏离
    EYES_CLOSED = "eyes_closed"  # 眼睛闭上
    NO_FACE = "no_face"          # 未检测到人脸


@dataclass
class HeadPoseData:
    """头部姿态数据"""
    pitch: float = 0.0      # 俯仰角 (度)
    yaw: float = 0.0        # 偏航角 (度)
    roll: float = 0.0       # 翻滚角 (度)
    is_valid: bool = False  # 是否在有效范围内

    def to_dict(self) -> dict:
        return {
            "pitch": round(self.pitch, 2),
            "yaw": round(self.yaw, 2),
            "roll": round(self.roll, 2),
            "is_valid": self.is_valid
        }


@dataclass
class EyeData:
    """眼部状态数据"""
    ear_left: float = 0.0       # 左眼 EAR 值
    ear_right: float = 0.0      # 右眼 EAR 值
    ear_avg: float = 0.0        # 平均 EAR 值
    is_open: bool = True        # 是否睁开
    consecutive_closed: int = 0  # 连续闭眼帧数

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
    """单帧处理结果"""
    timestamp: float = 0.0          # 时间戳 (秒)
    frame_id: int = 0               # 帧 ID
    has_face: bool = False           # 是否检测到人脸
    face_confidence: float = 0.0    # 人脸置信度
    
    # 头部姿态
    head_pose: HeadPoseData = field(default_factory=HeadPoseData)
    
    # 眼部状态
    eye_data: EyeData = field(default_factory=EyeData)
    
    # 专注状态
    focus_state: FocusState = FocusState.IDLE
    warning_reason: WarningReason = WarningReason.NONE
    
    # 性能数据
    detection_time_ms: float = 0.0   # 检测耗时 (毫秒)
    total_time_ms: float = 0.0      # 总处理耗时 (毫秒)

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
    """里程碑配置"""
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
    """会话统计数据"""
    # 时间统计
    session_start_time: float = 0.0          # 会话开始时间戳
    total_focus_time: float = 0.0           # 总专注时间 (秒)
    total_warning_time: float = 0.0          # 总警告时间 (秒)
    last_focus_start: float = 0.0            # 最近一次专注开始时间
    is_in_focus: bool = False                # 当前是否在专注状态
    
    # 计数统计
    interruption_count: int = 0              # 中断次数
    warning_count: int = 0                   # 警告次数
    
    # 积分统计
    current_streak_minutes: float = 0.0      # 当前连续专注时长 (分钟)
    total_points: int = 0                    # 总积分
    bonus_points: int = 0                    # 里程碑奖励积分
    milestones: list[Milestone] = field(default_factory=list)
    
    # 实时状态
    current_state: FocusState = FocusState.IDLE
    grace_period_remaining: float = 0.0      # 剩余宽容时间
    
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
    """完整会话数据"""
    session_id: str = ""                      # 会话 ID
    user_id: Optional[str] = None             # 用户 ID
    start_time: datetime = field(default_factory=datetime.now)
    end_time: Optional[datetime] = None
    is_active: bool = True
    
    stats: SessionStats = field(default_factory=SessionStats)
    frame_results: list[FrameResult] = field(default_factory=list)
    
    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "is_active": self.is_active,
            "stats": self.stats.to_dict(),
            "frame_count": len(self.frame_results)
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)


@dataclass
class FocusRuleResult:
    """专注规则检查结果"""
    pose_valid: bool = True           # 姿态是否有效
    eyes_valid: bool = True           # 眼部状态是否有效
    overall_valid: bool = True        # 整体是否有效
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
    """流水线配置"""
    # 头部姿态阈值
    pitch_threshold: float = 20.0
    yaw_threshold: float = 25.0
    roll_threshold: float = 30.0
    
    # EAR 阈值
    ear_threshold: float = 0.18
    consecutive_eye_closed_threshold: int = 2
    
    # 宽容时间
    grace_period_seconds: float = 5.0
    
    # 计分
    points_per_minute: int = 10
    daily_limit: int = 500
    
    # 眼部关键点索引 (106点 landmarks)
    left_eye_indices: list[int] = field(default_factory=lambda: [63, 64, 65, 66, 67, 68])
    right_eye_indices: list[int] = field(default_factory=lambda: [72, 73, 74, 75, 76, 77])
    
    @classmethod
    def from_dict(cls, config: dict) -> "PipelineConfig":
        """从字典创建配置"""
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
    """系统信息"""
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
