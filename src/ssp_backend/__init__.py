"""
SSP Backend - Smart Study Spot Backend System
多功能人脸识别专注度检测后端系统

Author: SSP Team
"""

__version__ = "1.0.0"
__author__ = "SSP Team"

from ssp_backend.types import (
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
from ssp_backend.pipeline import FocusPipeline
from ssp_backend.workflow import FocusWorkFlow, WorkFlowPhase, PerceptionResult
from ssp_backend.focus_fsm import FocusFSM, ScoringSystem, SessionManager
from ssp_backend.detector import CoreDetector
from ssp_backend.model_manager import ModelManager
from ssp_backend.auth import IdentityAuthenticator, UserProfile, VerificationResult
from ssp_backend.ear import EARCalculator
from ssp_backend.stream_controller import FrameController, FaceSelector, AntiSpoofingMonitor

__all__ = [
    # Version
    "__version__",
    # Types
    "FocusState",
