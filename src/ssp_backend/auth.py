"""
身份认证模块

实现用户身份绑定和防作弊检测。

Author: SSP Team
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime
import json

import numpy as np

from .types import WarningReason


logger = logging.getLogger(__name__)


@dataclass
class UserProfile:
    """用户档案"""
    user_id: str
    seat_id: str                      # 座位ID
    embedding: np.ndarray             # 基准特征向量 (512维)
    registered_at: datetime = field(default_factory=datetime.now)
    last_verified: datetime = field(default_factory=datetime.now)
    verification_count: int = 0
    failed_verifications: int = 0
    total_sessions: int = 0
    
    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "seat_id": self.seat_id,
            "embedding_norm": float(np.linalg.norm(self.embedding)),
            "registered_at": self.registered_at.isoformat(),
            "last_verified": self.last_verified.isoformat(),
            "verification_count": self.verification_count,
            "failed_verifications": self.failed_verifications,
            "total_sessions": self.total_sessions
        }


@dataclass 
class VerificationResult:
    """身份验证结果"""
    is_verified: bool
    similarity: float                 # 余弦相似度
    threshold: float                 # 判定阈值
    is_cheating: bool                # 是否作弊
    message: str
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> dict:
        return {
            "is_verified": self.is_verified,
            "similarity": round(self.similarity, 4),
            "threshold": self.threshold,
            "is_cheating": self.is_cheating,
            "message": self.message,
            "timestamp": self.timestamp
        }


class IdentityAuthenticator:
    """身份认证器
    
    管理用户身份绑定和实时身份验证。
    使用 ArcFace 提取的 512 维特征向量进行余弦相似度比对。
    """
    
    def __init__(
        self,
        similarity_threshold: float = 0.6,
        cheating_threshold: float = 0.5,
        verification_interval: float = 60.0,  # 每60秒验证一次
        max_failed_verifications: int = 3
    ):
        """
        初始化身份认证器
        
        Args:
            similarity_threshold: 身份验证通过的相似度阈值 (默认 0.6)
            cheating_threshold: 判定为换人的相似度阈值 (默认 0.5)
            verification_interval: 自动验证间隔 (秒)
            max_failed_verifications: 允许的最大连续验证失败次数
        """
        self.similarity_threshold = similarity_threshold
        self.cheating_threshold = cheating_threshold
        self.verification_interval = verification_interval
        self.max_failed_verifications = max_failed_verifications
        
        # 当前绑定的用户
        self.current_user: Optional[UserProfile] = None
        
        # 验证状态
        self._last_verification_time = 0.0
        self._consecutive_failures = 0
        self._is_locked = False
        
        logger.info(
            f"IdentityAuthenticator initialized: "
            f"threshold={similarity_threshold}, "
            f"cheating_threshold={cheating_threshold}, "
            f"interval={verification_interval}s"
        )
    
    def bind_user(
        self,
        user_id: str,
        seat_id: str,
        embedding: np.ndarray
    ) -> UserProfile:
        """
        绑定用户身份 (阶段一)
        
        当用户点击"开始专注"时，提取特征向量并绑定到座位。
        
        Args:
            user_id: 用户ID
            seat_id: 座位ID
            embedding: ArcFace 提取的 512 维特征向量
            
        Returns:
            UserProfile 对象
        """
        # 创建用户档案
        profile = UserProfile(
            user_id=user_id,
            seat_id=seat_id,
            embedding=embedding.copy(),
            registered_at=datetime.now(),
            last_verified=datetime.now()
        )
        
        self.current_user = profile
        self._last_verification_time = time.time()
        self._consecutive_failures = 0
        self._is_locked = False
        
        logger.info(
            f"User bound: user_id={user_id}, seat_id={seat_id}, "
            f"embedding_norm={np.linalg.norm(embedding):.4f}"
        )
        
        return profile
    
    def verify_identity(
        self,
        current_embedding: np.ndarray
    ) -> VerificationResult:
        """
        验证当前人脸是否与注册用户匹配 (防作弊)
        
        Args:
            current_embedding: 当前帧提取的 512 维特征向量
            
        Returns:
            VerificationResult 对象
        """
        if self.current_user is None:
            return VerificationResult(
                is_verified=False,
                similarity=0.0,
                threshold=self.similarity_threshold,
                is_cheating=False,
                message="No user bound"
            )
        
        # 计算余弦相似度
        similarity = self._cosine_similarity(
            self.current_user.embedding,
            current_embedding
        )
        
        # 更新验证统计
        self.current_user.verification_count += 1
        self.current_user.last_verified = datetime.now()
        self._last_verification_time = time.time()
        
        # 判断结果
        if similarity >= self.similarity_threshold:
            # 验证通过
            self._consecutive_failures = 0
            self.current_user.failed_verifications = 0
            
            return VerificationResult(
                is_verified=True,
                similarity=similarity,
                threshold=self.similarity_threshold,
                is_cheating=False,
                message="Identity verified"
            )
        
        elif similarity >= self.cheating_threshold:
            # 验证失败但未判定为换人
            self._consecutive_failures += 1
            self.current_user.failed_verifications = self._consecutive_failures
            
            return VerificationResult(
                is_verified=False,
                similarity=similarity,
                threshold=self.similarity_threshold,
                is_cheating=False,
                message=f"Verification failed ({self._consecutive_failures}/{self.max_failed_verifications})"
            )
        
        else:
            # 判定为换人作弊
            self._consecutive_failures += 1
            self._is_locked = True
            
            return VerificationResult(
                is_verified=False,
                similarity=similarity,
                threshold=self.similarity_threshold,
                is_cheating=True,
                message="CHEATING DETECTED: Face mismatch (possible person swap)"
            )
    
    def should_verify(self) -> bool:
        """检查是否需要执行自动验证"""
        if self.current_user is None:
            return False
        
        elapsed = time.time() - self._last_verification_time
        return elapsed >= self.verification_interval
    
    def is_locked(self) -> bool:
        """检查是否被锁定 (检测到作弊)"""
        return self._is_locked
    
    def unlock(self) -> None:
        """解除锁定"""
        self._is_locked = False
        self._consecutive_failures = 0
        logger.info("Authentication unlocked")
    
    def unbind_user(self) -> Optional[UserProfile]:
        """
        解绑当前用户
        
        Returns:
            之前的用户档案
        """
        old_user = self.current_user
        
        if old_user:
            old_user.total_sessions += 1
            logger.info(f"User unbound: user_id={old_user.user_id}, total_sessions={old_user.total_sessions}")
        
        self.current_user = None
        self._is_locked = False
        self._consecutive_failures = 0
        
        return old_user
    
    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """
        计算两个向量的余弦相似度
        
        Args:
            a, b: 两个向量，形状相同
            
        Returns:
            余弦相似度 [-1, 1]
        """
        # 假设向量已经是 L2 归一化的
        # cos_sim = dot(a, b) / (||a|| * ||b||)
        # 对于归一化向量，简化为 dot(a, b)
        
        dot_product = np.dot(a, b)
        
        # 确保在 [-1, 1] 范围内 (处理浮点误差)
        return float(np.clip(dot_product, -1.0, 1.0))
    
    def get_current_user_info(self) -> Optional[dict]:
        """获取当前用户信息"""
        if self.current_user is None:
            return None
        
        return {
            "user_id": self.current_user.user_id,
            "seat_id": self.current_user.seat_id,
            "is_locked": self._is_locked,
            "consecutive_failures": self._consecutive_failures,
            "time_since_last_verification": round(time.time() - self._last_verification_time, 1),
            "total_verifications": self.current_user.verification_count,
            "failed_verifications": self.current_user.failed_verifications
        }
    
    def update_thresholds(
        self,
        similarity_threshold: Optional[float] = None,
        cheating_threshold: Optional[float] = None,
        verification_interval: Optional[float] = None
    ) -> None:
        """更新认证阈值"""
        if similarity_threshold is not None:
            self.similarity_threshold = similarity_threshold
        if cheating_threshold is not None:
            self.cheating_threshold = cheating_threshold
        if verification_interval is not None:
            self.verification_interval = verification_interval
        
        logger.info(
            f"Thresholds updated: "
            f"similarity={self.similarity_threshold}, "
            f"cheating={self.cheating_threshold}, "
            f"interval={self.verification_interval}s"
        )


def create_test_embedding(seed: int = 42) -> np.ndarray:
    """创建测试用特征向量 (用于开发测试)"""
    np.random.seed(seed)
    vec = np.random.randn(512).astype(np.float32)
    vec = vec / np.linalg.norm(vec)  # L2 归一化
    return vec
