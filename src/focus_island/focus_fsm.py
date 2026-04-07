"""
专注状态机与计分系统模块

实现专注检测的状态机逻辑和积分计算。

状态流转:
IDLE -> FOCUSED: 检测到有效人脸和专注姿态
FOCUSED -> WARNING: 姿态或眼部状态异常
WARNING -> FOCUSED: 在5秒宽容时间内恢复
WARNING -> INTERRUPTED: 宽容时间结束
INTERRUPTED -> FOCUSED: 重新开始专注
任意 -> IDLE: 会话重置

计分规则:
- 每分钟基础积分: 10分
- 里程碑奖励: 25分钟/+50分, 50分钟/+150分
- 只加不减, 中断只重置连续计时

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
    """专注规则检查器
    
    检查头部姿态和眼部状态是否满足专注条件。
    """
    
    def __init__(self, config: PipelineConfig):
        """
        初始化规则检查器
        
        Args:
            config: 流水线配置
        """
        self.config = config
        
        # 主规则阈值 (头部姿态)
        self.pitch_threshold = config.pitch_threshold  # 默认 20度
        self.yaw_threshold = config.yaw_threshold      # 默认 25度
        
        # 辅助规则阈值 (EAR)
        self.ear_threshold = config.ear_threshold      # 默认 0.18
        
        logger.info(
            f"FocusRuleChecker: pitch<{self.pitch_threshold}°, yaw<{self.yaw_threshold}°, "
            f"EAR>{self.ear_threshold}"
        )
    
    def check_pose(self, pitch: float, yaw: float) -> tuple[bool, WarningReason]:
        """
        检查头部姿态是否有效 (主规则)
        
        条件: -20° < pitch < +20° 且 -25° < yaw < +25°
        
        Args:
            pitch: 俯仰角 (度)
            yaw: 偏航角 (度)
            
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
        检查眼部状态是否有效 (辅助规则)
        
        条件: EAR > 0.18
        
        Args:
            ear_avg: 平均 EAR 值
            
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
        综合检查所有规则
        
        Args:
            has_face: 是否检测到人脸
            pitch: 俯仰角
            yaw: 偏航角
            ear_avg: 平均 EAR 值
            
        Returns:
            FocusRuleResult
        """
        # 无脸情况
        if not has_face:
            return FocusRuleResult(
                pose_valid=False,
                eyes_valid=False,
                overall_valid=False,
                warning_reason=WarningReason.NO_FACE,
                details={"reason": "No face detected"}
            )
        
        # 检查主规则 (姿态)
        pose_valid, pose_warning = self.check_pose(pitch, yaw)
        
        # 检查辅助规则 (眼睛)
        eyes_valid, eyes_warning = self.check_eyes(ear_avg)
        
        # 组合判断
        overall_valid = pose_valid and eyes_valid
        
        # 确定警告原因
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
    """专注状态机
    
    核心状态流转逻辑，包含 5 秒宽容期。
    """
    
    def __init__(
        self,
        config: PipelineConfig,
        on_state_change: Optional[Callable[[FocusState, FocusState], None]] = None
    ):
        """
        初始化状态机
        
        Args:
            config: 流水线配置
            on_state_change: 状态变化回调
        """
        self.config = config
        self.grace_period = config.grace_period_seconds  # 默认 5 秒
        self.on_state_change = on_state_change
        
        # 状态
        self._state = FocusState.IDLE
        self._grace_timer = 0.0
        self._warning_start_time = 0.0
        
        # 统计
        self._total_warning_time = 0.0
        self._interruption_count = 0
        self._state_change_count = 0
        
        # 时间
        self._session_start_time = time.time()
        self._last_valid_time = time.time()
        self._last_process_time = time.time()
        
        # 规则检查器
        self.rule_checker = FocusRuleChecker(config)
        
        logger.info(f"FocusFSM: grace_period={self.grace_period}s")
    
    @property
    def state(self) -> FocusState:
        """当前状态"""
        return self._state
    
    @property
    def grace_remaining(self) -> float:
        """剩余宽容时间"""
        return max(0.0, self._grace_timer)
    
    @property
    def is_focused(self) -> bool:
        """是否专注"""
        return self._state == FocusState.FOCUSED
    
    @property
    def is_warning(self) -> bool:
        """是否警告中"""
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
        处理单帧
        
        状态流转:
        - IDLE: 无脸或初始
        - FOCUSED: 有效专注
        - WARNING: 偏离/闭眼，开始宽容计时
        - INTERRUPTED: 宽容超时
        
        Args:
            has_face: 是否检测到人脸
            pitch: 俯仰角
            yaw: 偏航角
            ear_avg: 平均 EAR 值
            delta_time: 帧间隔 (秒)
            identity_verified: 身份是否通过验证（False 时强制留在 WARNING/IDLE）
            
        Returns:
            (current_state, warning_reason, focus_valid)
        """
        current_time = time.time()
        old_state = self._state
        
        # 检查规则
        rule_result = self.rule_checker.check_all(has_face, pitch, yaw, ear_avg)
        
        # 身份未验证时，强制留在非专注状态
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
        
        # 状态转换逻辑（原有逻辑）
        if self._state == FocusState.IDLE:
            # IDLE 状态
            if rule_result.overall_valid:
                self._transition(FocusState.FOCUSED, current_time)
                self._last_valid_time = current_time
                self._grace_timer = 0.0
            elif not has_face:
                pass  # 保持 IDLE
            else:
                self._transition(FocusState.WARNING, current_time)
                self._grace_timer = self.grace_period
                self._warning_start_time = current_time
        
        elif self._state == FocusState.FOCUSED:
            # FOCUSED 状态 - 专注中
            self._last_valid_time = current_time
            
            if not has_face:
                self._transition(FocusState.IDLE, current_time)
                self._grace_timer = 0.0
            elif not rule_result.overall_valid:
                self._transition(FocusState.WARNING, current_time)
                self._grace_timer = self.grace_period
                self._warning_start_time = current_time
            else:
                # 保持专注，清零宽容计时
                self._grace_timer = 0.0
        
        elif self._state == FocusState.WARNING:
            # WARNING 状态 - 宽容期
            if not has_face:
                self._transition(FocusState.IDLE, current_time)
                self._total_warning_time += current_time - self._warning_start_time
                self._grace_timer = 0.0
            elif rule_result.overall_valid:
                # 恢复到专注
                self._transition(FocusState.FOCUSED, current_time)
                self._total_warning_time += current_time - self._warning_start_time
                self._grace_timer = 0.0
            else:
                # 继续警告，扣减宽容时间
                self._grace_timer -= delta_time
                if self._grace_timer <= 0:
                    self._transition(FocusState.INTERRUPTED, current_time)
                    self._interruption_count += 1
                    self._total_warning_time += current_time - self._warning_start_time
        
        elif self._state == FocusState.INTERRUPTED:
            # INTERRUPTED 状态 - 中断
            if rule_result.overall_valid:
                self._transition(FocusState.FOCUSED, current_time)
                self._last_valid_time = current_time
                self._grace_timer = 0.0
        
        return self._state, rule_result.warning_reason, rule_result.overall_valid
    
    def _transition(self, new_state: FocusState, timestamp: float) -> None:
        """状态转换"""
        if self._state != new_state:
            old_state = self._state
            self._state = new_state
            self._state_change_count += 1
            
            if self.on_state_change:
                self.on_state_change(old_state, new_state)
            
            logger.debug(f"FSM: {old_state.value} -> {new_state.value}")
    
    def reset(self) -> None:
        """重置状态机"""
        self._state = FocusState.IDLE
        self._grace_timer = 0.0
        self._warning_start_time = 0.0
        self._session_start_time = time.time()
        self._last_valid_time = time.time()
        self._total_warning_time = 0.0
        self._interruption_count = 0
        
        logger.info("FocusFSM reset")
    
    def get_stats(self) -> dict:
        """获取统计"""
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
    """计分系统
    
    积分规则:
    - 基础分: 每分钟 10 分
    - 里程碑: 25分钟/+50分, 50分钟/+150分, 90分钟/+300分
    - 只加不减
    """
    
    def __init__(
        self,
        config: PipelineConfig,
        daily_limit: Optional[int] = None
    ):
        """
        初始化计分系统
        
        Args:
            config: 流水线配置
            daily_limit: 每日积分上限
        """
        self.config = config
        self.points_per_minute = config.points_per_minute  # 默认 10
        self.daily_limit = daily_limit or config.daily_limit
        
        # 里程碑
        self.milestones = [
            Milestone(duration_minutes=25, bonus_points=50),
            Milestone(duration_minutes=50, bonus_points=150),
            Milestone(duration_minutes=90, bonus_points=300),
        ]
        
        # 积分统计
        self._total_points = 0
        self._bonus_points = 0
        self._base_points = 0
        self._total_focus_time = 0.0
        self._current_streak_time = 0.0
        self._session_start = time.time()
        self._reached_milestones = set()
        
        # 最后检查时间
        self._last_minute_check = 0.0
        
        logger.info(
            f"ScoringSystem: {self.points_per_minute} pts/min, "
            f"daily_limit={self.daily_limit}"
        )
    
    @property
    def total_points(self) -> int:
        """总积分"""
        return self._total_points
    
    @property
    def current_streak_minutes(self) -> float:
        """当前连续专注时长 (分钟)"""
        return self._current_streak_time / 60.0
    
    def add_focus_time(self, seconds: float) -> dict:
        """
        添加专注时间
        
        Args:
            seconds: 专注秒数
            
        Returns:
            更新信息
        """
        self._total_focus_time += seconds
        self._current_streak_time += seconds
        
        # 计算基础积分
        minutes_elapsed = int(self._total_focus_time / 60.0)
        self._base_points = minutes_elapsed * self.points_per_minute
        
        # 计算里程碑奖励
        milestones_reached = self._check_milestones()
        
        # 总积分
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
        """检查里程碑"""
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
        """中断回调 - 重置连续计时，保留已得积分"""
        self._current_streak_time = 0.0
        
        # 重置里程碑进度
        for m in self.milestones:
            if m.reached:
                self._reached_milestones.discard(m.duration_minutes)
                m.reached = False
                m.reached_at = None
                self._bonus_points -= m.bonus_points
        
        logger.debug("Scoring: interruption - streak reset")
    
    def reset(self) -> None:
        """重置计分"""
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
        """获取积分摘要"""
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
    """会话管理器
    
    管理整个专注会话的生命周期。
    """
    
    def __init__(
        self,
        config: PipelineConfig,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        seat_id: Optional[str] = None
    ):
        """
        初始化会话管理器
        
        Args:
            config: 流水线配置
            session_id: 会话 ID
            user_id: 用户 ID
            seat_id: 座位 ID
        """
        import uuid
        
        self.config = config
        self.session_id = session_id or str(uuid.uuid4())[:8]
        self.user_id = user_id
        self.seat_id = seat_id
        
        # 初始化组件
        self.fsm = FocusFSM(config)
        self.scoring = ScoringSystem(config)
        
        # 会话数据
        self.session_data = SessionData(
            session_id=self.session_id,
            user_id=user_id
        )
        self.session_data.stats.session_start_time = time.time()
        
        # 回调
        self._callbacks = {
            "state_change": [],
            "milestone": [],
            "interruption": [],
            "cheating_detected": []
        }
        
        logger.info(f"SessionManager: {self.session_id}")
    
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
    
    def start_session(self) -> None:
        """开始会话"""
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
        处理单帧
        
        Args:
            has_face: 是否检测到人脸
            pitch: 俯仰角
            yaw: 偏航角
            ear_avg: 平均 EAR 值
            frame_id: 帧 ID
            delta_time: 帧间隔
            identity_verified: 身份是否通过验证
            
        Returns:
            处理结果
        """
        old_state = self.fsm.state
        
        # 处理帧（传递身份验证状态）
        new_state, warning_reason, is_valid = self.fsm.process_frame(
            has_face, pitch, yaw, ear_avg, delta_time,
            identity_verified=identity_verified
        )
        
        # 状态变化
        if old_state != new_state:
            self._emit("state_change", old_state, new_state)
            
            # 中断时
            if new_state == FocusState.INTERRUPTED:
                self.scoring.on_interruption()
                self.session_data.stats.interruption_count += 1
                self._emit("interruption", self.session_data.stats.interruption_count)
        
        # 专注时累加时间
        if self.fsm.is_focused and is_valid:
            self.session_data.stats.total_focus_time += delta_time
            score_update = self.scoring.add_focus_time(delta_time)
            
            # 里程碑通知
            for m in score_update.get("milestones_reached", []):
                self._emit("milestone", m)
        
        # 警告时累加警告时间
        if self.fsm.is_warning:
            self.session_data.stats.total_warning_time += delta_time
            self.session_data.stats.warning_count += 1
        
        # 更新状态
        self.session_data.stats.current_state = self.fsm.state
        self.session_data.stats.grace_period_remaining = self.fsm.grace_remaining
        self.session_data.stats.current_streak_minutes = self.scoring.current_streak_minutes
        self.session_data.stats.total_points = self.scoring.total_points
        self.session_data.stats.interruption_count = self.fsm._interruption_count
        self.session_data.stats.warning_count = self.fsm.get_stats()["state_change_count"]
        
        # 返回结果
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
        """结束会话"""
        self.session_data.is_active = False
        self.session_data.end_time = datetime.now()
        
        summary = self.get_summary()
        logger.info(f"Session ended: {self.session_id}, points={summary['score_summary']['total_points']}")
        
        return summary
    
    def get_summary(self) -> dict:
        """获取会话摘要"""
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
        """重置会话"""
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
