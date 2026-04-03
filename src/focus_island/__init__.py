"""
Focus Island - 专注岛屿后端系统
多功能人脸识别专注度检测后端系统

Author: SSP Team
"""

__version__ = "1.0.0"
__author__ = "SSP Team"

from focus_island.types import (
    FocusState,
    WarningReason,
    FrameResult,
    HeadPoseData,
    EyeData,
    SessionData,
    SessionStats,
    PipelineConfig,
    SystemInfo,
)
from focus_island.pipeline import FocusPipeline
from focus_island.workflow import FocusWorkFlow, WorkFlowPhase, PerceptionResult
from focus_island.focus_fsm import FocusFSM, ScoringSystem, SessionManager
from focus_island.detector import CoreDetector
from focus_island.model_manager import ModelManager
from focus_island.auth import IdentityAuthenticator, UserProfile, VerificationResult
from focus_island.ear import EARCalculator
from focus_island.stream_controller import FrameController, FaceSelector, AntiSpoofingMonitor

__all__ = [
    # Version
    "__version__",
    # Types
    "FocusState",
    "WarningReason",
    "FrameResult",
    "HeadPoseData",
    "EyeData",
    "SessionData",
    "SessionStats",
    "PipelineConfig",
    "SystemInfo",
    # Workflow
    "FocusWorkFlow",
    "WorkFlowPhase",
    "PerceptionResult",
    # Core classes
    "FocusPipeline",
    "FocusFSM",
    "ScoringSystem",
    "SessionManager",
    "CoreDetector",
    "ModelManager",
    "IdentityAuthenticator",
    "UserProfile",
    "VerificationResult",
    "EARCalculator",
    "FrameController",
    "FaceSelector",
    "AntiSpoofingMonitor",
]
