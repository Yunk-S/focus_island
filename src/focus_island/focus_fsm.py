"""
Focus FSM and Scoring System Module

Implements focus detection state machine logic and points calculation.

State transitions:
IDLE -> FOCUSED: Detected valid face and focus pose
FOCUSED -> WARNING: Abnormal pose or eye state
WARNING -> FOCUSED: Recovery within 5-second grace period
WARNING -> INTERRUPTED: Grace period ended
INTERRUPTED -> FOCUSED: Restart focus
Any -> IDLE: Session reset

Scoring rules:
- Base points: 10 points per minute
- Milestone bonuses: 25min/+50pts, 50min/+150pts
- Points only increase, interruptions reset streak timer only

Author: SSP Team
"""

from __future__ import annotations

import logging
import time
from typing import Optional, Callable, List
from dataclasses import dataclass, field
from datetime import datetime

from .types import (
    FocusState,
    WarningReason,
    FocusRuleResult,
    SessionStats,
    SessionData,
    Milestone,
    PipelineConfig
)


logger = logging.getLogger(__name__)


class FocusRuleChecker:
    """Focus Rule Checker
    
    Checks if head pose and eye state meet focus conditions.
    """
    
    def __init__(self, config: PipelineConfig):
        """
        Initialize rule checker
        
        Args:
            config: Pipeline configuration
        """
        self.config = config
        
        # Main rule thresholds (head pose)
        self.pitch_threshold = config.pitch_threshold  # Default 20 degrees
        self.yaw_threshold = config.yaw_threshold      # Default 25 degrees
        
        # Auxiliary rule thresholds (EAR)
        self.ear_threshold = config.ear_threshold      # Default 0.18
        
        logger.info(
            f"FocusRuleChecker: pitch<{self.pitch_threshold}°, yaw<{self.yaw_threshold}°, "
            f"EAR>{self.ear_threshold}"
        )
    
    def check_pose(self, pitch: float, yaw: float) -> tuple[bool, WarningReason]:
        """
        Check if head pose is valid (main rule)
        
        Conditions: -20° < pitch < +20° and -25° < yaw < +25°
        
        Args:
            pitch: Pitch angle (degrees)
            yaw: Yaw angle (degrees)
            
        Returns:
            (is_valid, warning_reason)
        """
        pitch_ok = -self.pitch_threshold < pitch < self.pitch_threshold
        yaw_ok = -self.yaw_threshold < yaw < self.yaw_threshold
        
        if pitch_ok and yaw_ok:
            return True, WarningReason.NONE
        
        return False, WarningReason.HEAD_AWAY
    
    def check_eyes(self, ear_avg: float) -> tuple[bool, WarningReason]:
        """
        Check if eye state is valid (auxiliary rule)
        
        Condition: EAR > 0.18
        
        Args:
            ear_avg: Average EAR value
            
        Returns:
            (is_valid, warning_reason)
        """
        if ear_avg > self.ear_threshold:
            return True, WarningReason.NONE
        
        return False, WarningReason.EYES_CLOSED
    
    def check_all(
        self,
        has_face: bool,
        pitch: float,
        yaw: float,
        ear_avg: float
    ) -> FocusRuleResult:
        """
        Comprehensive check of all rules
        
        Args:
            has_face: Face detected
            pitch: Pitch angle
            yaw: Yaw angle
            ear_avg: Average EAR value
            
        Returns:
            FocusRuleResult
        """
        # No face case
        if not has_face:
            return FocusRuleResult(
                pose_valid=False,
                eyes_valid=False,
                overall_valid=False,
                warning_reason=WarningReason.NO_FACE,
                details={"reason": "No face detected"}
            )
        
        # Check main rule (pose)
        pose_valid, pose_warning = self.check_pose(pitch, yaw)
        
        # Check auxiliary rule (eyes)
        eyes_valid, eyes_warning = self.check_eyes(ear_avg)
        
        # Combined judgment
        overall_valid = pose_valid and eyes_valid
        
        # Determine warning reason
        if not overall_valid:
            if not pose_valid:
                warning = pose_warning
            elif not eyes_valid:
                warning = eyes_warning
            else:
                warning = WarningReason.NONE
        else:
            warning = WarningReason.NONE
        
        return FocusRuleResult(
            pose_valid=pose_valid,
            eyes_valid=eyes_valid,
            overall_valid=overall_valid,
            warning_reason=warning,
            details={
                "pitch": round(pitch, 2),
                "yaw": round(yaw, 2),
                "ear_avg": round(ear_avg, 4)
            }
        )


class FocusFSM:
    """Focus State Machine
    
    Core state transition logic with 5-second grace period.
    """
    
    def __init__(
        self,
        config: PipelineConfig,
        on_state_change: Optional[Callable[[FocusState, FocusState], None]] = None
    ):
        """
        Initialize state machine
        
        Args:
            config: Pipeline configuration
            on_state_change: State change callback
        """
        self.config = config
        self.grace_period = config.grace_period_seconds  # Default 5 seconds
        self.on_state_change = on_state_change
        
        # State
        self._state = FocusState.IDLE
        self._grace_timer = 0.0
        self._warning_start_time = 0.0
        
        # Statistics
        self._total_warning_time = 0.0
        self._interruption_count = 0
        self._state_change_count = 0
        
        # Time
        self._session_start_time = time.time()
        self._last_valid_time = time.time()
        self._last_process_time = time.time()
        
        # Rule checker
        self.rule_checker = FocusRuleChecker(config)
        
        logger.info(f"FocusFSM: grace_period={self.grace_period}s")
    
    @property
    def state(self) -> FocusState:
        """Current state"""
        return self._state
    
    @property
    def grace_remaining(self) -> float:
        """Remaining grace time"""
        return max(0.0, self._grace_timer)
    
    @property
    def is_focused(self) -> bool:
        """Is focused"""
        return self._state == FocusState.FOCUSED
    
    @property
    def is_warning(self) -> bool:
        """Is in warning state"""
        return self._state == FocusState.WARNING
    
    def process_frame(
        self,
        has_face: bool,
        pitch: float,
        yaw: float,
        ear_avg: float,
        delta_time: float = 0.1,
        identity_verified: bool = True
    ) -> tuple[FocusState, WarningReason, bool]:
        """
        Process single frame
        
        State transitions:
        - IDLE: No face or initial
        - FOCUSED: Valid focus
        - WARNING: Deviation/eyes closed, start grace timer
        - INTERRUPTED: Grace timeout
        
        Args:
            has_face: Face detected
            pitch: Pitch angle
            yaw: Yaw angle
            ear_avg: Average EAR value
            delta_time: Frame interval (seconds)
            identity_verified: Identity verified (False forces non-focus state)
            
        Returns:
            (current_state, warning_reason, focus_valid)
        """
        current_time = time.time()
        old_state = self._state
        
        # Check rules
        rule_result = self.rule_checker.check_all(has_face, pitch, yaw, ear_avg)
        
        # When identity not verified, force to non-focus state
        if not identity_verified:
            if self._state == FocusState.FOCUSED:
                self._transition(FocusState.WARNING, current_time)
                self._grace_timer = self.grace_period
                self._warning_start_time = current_time
            elif self._state != FocusState.IDLE:
                self._grace_timer -= delta_time
                if self._grace_timer <= 0:
                    self._transition(FocusState.INTERRUPTED, current_time)
            return self._state, rule_result.warning_reason, False
        
        # State transition logic (original logic)
        if self._state == FocusState.IDLE:
            # IDLE state
            if rule_result.overall_valid:
                self._transition(FocusState.FOCUSED, current_time)
                self._last_valid_time = current_time
                self._grace_timer = 0.0
            elif not has_face:
                pass  # Stay in IDLE
            else:
                self._transition(FocusState.WARNING, current_time)
                self._grace_timer = self.grace_period
                self._warning_start_time = current_time
        
        elif self._state == FocusState.FOCUSED:
            # FOCUSED state - focusing
            self._last_valid_time = current_time
            
            if not has_face:
                self._transition(FocusState.IDLE, current_time)
                self._grace_timer = 0.0
            elif not rule_result.overall_valid:
                self._transition(FocusState.WARNING, current_time)
                self._grace_timer = self.grace_period
                self._warning_start_time = current_time
            else:
                # Keep focus, reset grace timer
                self._grace_timer = 0.0
        
        elif self._state == FocusState.WARNING:
            # WARNING state - grace period
            if not has_face:
                self._transition(FocusState.IDLE, current_time)
                self._total_warning_time += current_time - self._warning_start_time
                self._grace_timer = 0.0
            elif rule_result.overall_valid:
                # Recover to focus
                self._transition(FocusState.FOCUSED, current_time)
                self._total_warning_time += current_time - self._warning_start_time
                self._grace_timer = 0.0
            else:
                # Continue warning, deduct grace time
                self._grace_timer -= delta_time
                if self._grace_timer <= 0:
                    self._transition(FocusState.INTERRUPTED, current_time)
                    self._interruption_count += 1
                    self._total_warning_time += current_time - self._warning_start_time
        
        elif self._state == FocusState.INTERRUPTED:
            # INTERRUPTED state
            if rule_result.overall_valid:
                self._transition(FocusState.FOCUSED, current_time)
                self._last_valid_time = current_time
                self._grace_timer = 0.0
        
        return self._state, rule_result.warning_reason, rule_result.overall_valid
    
    def _transition(self, new_state: FocusState, timestamp: float) -> None:
        """State transition"""
        if self._state != new_state:
            old_state = self._state
            self._state = new_state
            self._state_change_count += 1
            
            if self.on_state_change:
                self.on_state_change(old_state, new_state)
            
            logger.debug(f"FSM: {old_state.value} -> {new_state.value}")
    
    def reset(self) -> None:
        """Reset state machine"""
        self._state = FocusState.IDLE
        self._grace_timer = 0.0
        self._warning_start_time = 0.0
        self._session_start_time = time.time()
        self._last_valid_time = time.time()
        self._total_warning_time = 0.0
        self._interruption_count = 0
        
        logger.info("FocusFSM reset")
    
    def get_stats(self) -> dict:
        """Get statistics"""
        current_time = time.time()
        return {
            "state": self._state.value,
            "grace_remaining": round(self.grace_remaining, 2),
            "total_warning_time": round(self._total_warning_time, 2),
            "interruption_count": self._interruption_count,
            "state_change_count": self._state_change_count,
            "is_focused": self.is_focused,
            "is_warning": self.is_warning
        }


class ScoringSystem:
    """Scoring System
    
    Scoring rules:
    - Base: 10 points per minute
    - Milestones: 25min/+50pts, 50min/+150pts, 90min/+300pts
    - Points only increase
    """
    
    def __init__(
        self,
        config: PipelineConfig,
        daily_limit: Optional[int] = None
    ):
        """
        Initialize scoring system
        
        Args:
            config: Pipeline configuration
            daily_limit: Daily points limit
        """
        self.config = config
        self.points_per_minute = config.points_per_minute  # Default 10
        self.daily_limit = daily_limit or config.daily_limit
        
        # Milestones
        self.milestones = [
            Milestone(duration_minutes=25, bonus_points=50),
            Milestone(duration_minutes=50, bonus_points=150),
            Milestone(duration_minutes=90, bonus_points=300),
        ]
        
        # Points statistics
        self._total_points = 0
        self._bonus_points = 0
        self._base_points = 0
        self._total_focus_time = 0.0
        self._current_streak_time = 0.0
        self._session_start = time.time()
        self._reached_milestones = set()
        
        # Last check time
        self._last_minute_check = 0.0
        
        logger.info(
            f"ScoringSystem: {self.points_per_minute} pts/min, "
            f"daily_limit={self.daily_limit}"
        )
    
    @property
    def total_points(self) -> int:
        """Total points"""
        return self._total_points
    
    @property
    def current_streak_minutes(self) -> float:
        """Current consecutive focus duration (minutes)"""
        return self._current_streak_time / 60.0
    
    def add_focus_time(self, seconds: float) -> dict:
        """
        Add focus time
        
        Args:
            seconds: Focus seconds
            
        Returns:
            Update info
        """
        self._total_focus_time += seconds
        self._current_streak_time += seconds
        
        # Calculate base points
        minutes_elapsed = int(self._total_focus_time / 60.0)
        self._base_points = minutes_elapsed * self.points_per_minute
        
        # Calculate milestone bonuses
        milestones_reached = self._check_milestones()
        
        # Total points
        self._total_points = min(
            self._base_points + self._bonus_points,
            self.daily_limit
        )
        
        return {
            "total_points": self._total_points,
            "base_points": self._base_points,
            "bonus_points": self._bonus_points,
            "total_focus_time_min": round(self._total_focus_time / 60.0, 2),
            "current_streak_min": round(self.current_streak_minutes, 2),
            "milestones_reached": milestones_reached
        }
    
    def _check_milestones(self) -> List[dict]:
        """Check milestones"""
        reached = []
        streak_min = self.current_streak_minutes
        
        for m in self.milestones:
            if m.duration_minutes not in self._reached_milestones:
                if streak_min >= m.duration_minutes:
                    self._reached_milestones.add(m.duration_minutes)
                    self._bonus_points += m.bonus_points
                    m.reached = True
                    m.reached_at = time.time()
                    
                    reached.append({
                        "duration": m.duration_minutes,
                        "bonus": m.bonus_points
                    })
                    
                    logger.info(
                        f"Milestone: {m.duration_minutes}min reached! "
                        f"+{m.bonus_points} pts"
                    )
        
        return reached
    
    def on_interruption(self) -> None:
        """Interruption callback - reset streak timer, keep earned points"""
        self._current_streak_time = 0.0
        
        # Reset milestone progress
        for m in self.milestones:
            if m.reached:
                self._reached_milestones.discard(m.duration_minutes)
                m.reached = False
                m.reached_at = None
                self._bonus_points -= m.bonus_points
        
        logger.debug("Scoring: interruption - streak reset")
    
    def reset(self) -> None:
        """Reset scoring"""
        self._total_points = 0
        self._bonus_points = 0
        self._base_points = 0
        self._total_focus_time = 0.0
        self._current_streak_time = 0.0
        self._session_start = time.time()
        self._reached_milestones.clear()
        
        for m in self.milestones:
            m.reached = False
            m.reached_at = None
        
        logger.info("ScoringSystem reset")
    
    def get_summary(self) -> dict:
        """Get points summary"""
        return {
            "total_points": self._total_points,
            "base_points": self._base_points,
            "bonus_points": self._bonus_points,
            "total_focus_time_min": round(self._total_focus_time / 60.0, 2),
            "current_streak_min": round(self.current_streak_minutes, 2),
            "milestones": [m.to_dict() for m in self.milestones],
            "daily_limit": self.daily_limit,
            "remaining_daily": max(0, self.daily_limit - self._total_points)
        }


class SessionManager:
    """Session Manager
    
    Manages the lifecycle of the entire focus session.
    """
    
    def __init__(
        self,
        config: PipelineConfig,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        seat_id: Optional[str] = None
    ):
        """
        Initialize session manager
        
        Args:
            config: Pipeline configuration
            session_id: Session ID
            user_id: User ID
            seat_id: Seat ID
        """
        import uuid
        
        self.config = config
        self.session_id = session_id or str(uuid.uuid4())[:8]
        self.user_id = user_id
        self.seat_id = seat_id
        
        # Initialize components
        self.fsm = FocusFSM(config)
        self.scoring = ScoringSystem(config)
        
        # Session data
        self.session_data = SessionData(
            session_id=self.session_id,
            user_id=user_id
        )
        self.session_data.stats.session_start_time = time.time()
        
        # Callbacks
        self._callbacks = {
            "state_change": [],
            "milestone": [],
            "interruption": [],
            "cheating_detected": []
        }
        
        logger.info(f"SessionManager: {self.session_id}")
    
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
    
    def start_session(self) -> None:
        """Start session"""
        self.session_data.stats.session_start_time = time.time()
        self.session_data.is_active = True
        logger.info(f"Session started: {self.session_id}")
    
    def process_frame(
        self,
        has_face: bool,
        pitch: float,
        yaw: float,
        ear_avg: float,
        frame_id: int = 0,
        delta_time: float = 0.1,
        identity_verified: bool = True
    ) -> dict:
        """
        Process single frame
        
        Args:
            has_face: Face detected
            pitch: Pitch angle
            yaw: Yaw angle
            ear_avg: Average EAR value
            frame_id: Frame ID
            delta_time: Frame interval
            identity_verified: Identity verified
            
        Returns:
            Processing result
        """
        old_state = self.fsm.state
        
        # Process frame (pass identity verification state)
        new_state, warning_reason, is_valid = self.fsm.process_frame(
            has_face, pitch, yaw, ear_avg, delta_time,
            identity_verified=identity_verified
        )
        
        # State change
        if old_state != new_state:
            self._emit("state_change", old_state, new_state)
            
            # On interruption
            if new_state == FocusState.INTERRUPTED:
                self.scoring.on_interruption()
                self.session_data.stats.interruption_count += 1
                self._emit("interruption", self.session_data.stats.interruption_count)
        
        # Accumulate time when focused
        if self.fsm.is_focused and is_valid:
            self.session_data.stats.total_focus_time += delta_time
            score_update = self.scoring.add_focus_time(delta_time)
            
            # Milestone notification
            for m in score_update.get("milestones_reached", []):
                self._emit("milestone", m)
        
        # Accumulate warning time when warning
        if self.fsm.is_warning:
            self.session_data.stats.total_warning_time += delta_time
            self.session_data.stats.warning_count += 1
        
        # Update state
        self.session_data.stats.current_state = self.fsm.state
        self.session_data.stats.grace_period_remaining = self.fsm.grace_remaining
        self.session_data.stats.current_streak_minutes = self.scoring.current_streak_minutes
        self.session_data.stats.total_points = self.scoring.total_points
        self.session_data.stats.interruption_count = self.fsm._interruption_count
        self.session_data.stats.warning_count = self.fsm.get_stats()["state_change_count"]
        
        # Return result
        return {
            "session_id": self.session_id,
            "frame_id": frame_id,
            "state": new_state.value,
            "warning_reason": warning_reason.value,
            "is_valid": is_valid,
            "head_pose": {
                "pitch": round(pitch, 2),
                "yaw": round(yaw, 2)
            },
            "eye": {
                "ear_avg": round(ear_avg, 4)
            },
            "stats": {
                "total_points": self.scoring.total_points,
                "focus_time_min": round(self.session_data.stats.total_focus_time / 60.0, 2),
                "current_streak_min": round(self.scoring.current_streak_minutes, 2)
            },
            "identity_verified": identity_verified,
            "fsm": {
                "grace_remaining": round(self.fsm.grace_remaining, 2),
                "interruption_count": self.fsm._interruption_count
            }
        }
    
    def end_session(self) -> dict:
        """End session"""
        self.session_data.is_active = False
        self.session_data.end_time = datetime.now()
        
        summary = self.get_summary()
        logger.info(f"Session ended: {self.session_id}, points={summary['score_summary']['total_points']}")
        
        return summary
    
    def get_summary(self) -> dict:
        """Get session summary"""
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "seat_id": self.seat_id,
            "start_time": self.session_data.start_time.isoformat(),
            "end_time": datetime.now().isoformat(),
            "current_state": self.fsm.state.value,
            "fsm_stats": self.fsm.get_stats(),
            "score_summary": self.scoring.get_summary()
        }
    
    def reset_session(self) -> None:
        """Reset session"""
        import uuid
        self.session_id = str(uuid.uuid4())[:8]
        self.session_data = SessionData(
            session_id=self.session_id,
            user_id=self.user_id
        )
        self.session_data.stats.session_start_time = time.time()
        self.fsm.reset()
        self.scoring.reset()
        
        logger.info(f"Session reset: {self.session_id}")
