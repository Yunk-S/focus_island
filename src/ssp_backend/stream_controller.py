"""
视频流控制器模块

实现抽帧处理和目标人脸锁定逻辑。

Author: SSP Team
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum

import numpy as np

from .types import WarningReason


logger = logging.getLogger(__name__)


class FaceSelectionMode(Enum):
    """人脸选择模式"""
    LARGEST = "largest"              # 选择最大人脸
    MOST_CENTERED = "most_centered"   # 选择最居中的人脸
    COMBINED = "combined"           # 综合评分


@dataclass
class FaceCandidate:
    """人脸候选"""
    bbox: np.ndarray
    confidence: float
    area: float
    center_offset: float  # 距离图像中心的偏移
    combined_score: float  # 综合评分
    
    def __post_init__(self):
        # 计算综合评分 (面积越大越好，偏移越小越好)
        # 归一化处理
        area_score = min(self.area / 100000, 1.0) * 0.5  # 面积权重 50%
        center_score = max(0, 1 - self.center_offset / 500) * 0.5  # 居中权重 50%
        self.combined_score = area_score + center_score


@dataclass
class FrameController:
    """抽帧控制器
    
    控制视频流的帧采样率，降低功耗。
    建议每秒处理 3-5 帧，而非 30 FPS 全速运行。
    """
    
    # 帧率配置
    target_fps: float = 4.0            # 目标处理帧率
    min_frame_interval: float = 0.1   # 最小帧间隔 (秒)
    
    # 状态
    _last_process_time: float = 0.0
    _frame_counter: int = 0
    _total_frames: int = 0
    
    def __post_init__(self):
        self.min_frame_interval = 1.0 / self.target_fps
    
    def should_process_frame(self) -> bool:
        """
        判断当前帧是否应该处理
        
        Returns:
            True 如果应该处理此帧
        """
        current_time = time.time()
        elapsed = current_time - self._last_process_time
        
        if elapsed >= self.min_frame_interval:
            self._last_process_time = current_time
            self._frame_counter += 1
            self._total_frames += 1
            return True
        
        return False
    
    def force_process(self) -> bool:
        """强制处理当前帧"""
        self._last_process_time = time.time()
        self._frame_counter += 1
        self._total_frames += 1
        return True
    
    def get_stats(self) -> dict:
        """获取统计信息"""
        elapsed_total = time.time() - self._last_process_time + (self._frame_counter * self.min_frame_interval)
        actual_fps = self._total_frames / max(elapsed_total, 1.0)
        
        return {
            "target_fps": self.target_fps,
            "actual_fps": round(actual_fps, 2),
            "total_frames": self._total_frames,
            "min_interval_ms": round(self.min_frame_interval * 1000, 1)
        }
    
    def reset(self) -> None:
        """重置状态"""
        self._last_process_time = 0.0
        self._frame_counter = 0
        self._total_frames = 0


class FaceSelector:
    """目标人脸选择器
    
    当画面中有多张人脸时，选择最合适的一张作为"当前座次用户"。
    """
    
    def __init__(
        self,
        mode: FaceSelectionMode = FaceSelectionMode.COMBINED,
        image_center: Optional[tuple[float, float]] = None,
        image_size: tuple[int, int] = (640, 480)
    ):
        """
        初始化人脸选择器
        
        Args:
            mode: 选择模式
            image_center: 图像中心点坐标 (x, y)
            image_size: 图像尺寸 (width, height)
        """
        self.mode = mode
        self.image_center = image_center or (image_size[0] / 2, image_size[1] / 2)
        self.image_width = image_size[0]
        self.image_height = image_size[1]
        
        # 当前锁定的人脸
        self._locked_face: Optional[FaceCandidate] = None
        self._lock_stable_frames = 0
        self._unlock_frames_threshold = 5  # 连续5帧检测不到则解锁
        
        logger.info(f"FaceSelector initialized: mode={mode.value}")
    
    def update_image_params(self, image_width: int, image_height: int) -> None:
        """更新图像参数"""
        self.image_width = image_width
        self.image_height = image_height
        self.image_center = (image_width / 2, image_height / 2)
    
    def select_target_face(self, faces: list, frame_bbox: Optional[np.ndarray] = None) -> Optional[np.ndarray]:
        """
        从多张人脸中选择目标人脸
        
        Args:
            faces: RetinaFace 检测到的所有 Face 对象
            frame_bbox: 上一帧的目标人脸边界框 (用于追踪)
            
        Returns:
            选中的人脸边界框，或 None
        """
        if not faces:
            # 无脸检测
            if self._locked_face is not None:
                self._lock_stable_frames = 0
            self._locked_face = None
            return None
        
        # 构建筑选列表
        candidates = []
        for face in faces:
            bbox = face.bbox
            area = self._calculate_area(bbox)
            center = self._calculate_center(bbox)
            offset = self._calculate_center_offset(center)
            
            candidate = FaceCandidate(
                bbox=bbox,
                confidence=face.confidence,
                area=area,
                center_offset=offset,
                combined_score=0.0
            )
            candidates.append(candidate)
        
        # 根据模式选择
        if self.mode == FaceSelectionMode.LARGEST:
            best = max(candidates, key=lambda c: c.area)
        elif self.mode == FaceSelectionMode.MOST_CENTERED:
            best = min(candidates, key=lambda c: c.center_offset)
        else:  # COMBINED
            best = max(candidates, key=lambda c: c.combined_score)
        
        # 检查是否与锁定的人脸匹配
        if self._locked_face is not None:
            if self._is_same_face(best.bbox, self._locked_face.bbox):
                self._lock_stable_frames += 1
            else:
                self._lock_stable_frames = 0
        
        # 更新锁定
        self._locked_face = best
        
        return best.bbox
    
    def _calculate_area(self, bbox: np.ndarray) -> float:
        """计算人脸面积"""
        x1, y1, x2, y2 = bbox[:4]
        return float((x2 - x1) * (y2 - y1))
    
    def _calculate_center(self, bbox: np.ndarray) -> tuple[float, float]:
        """计算人脸中心点"""
        x1, y1, x2, y2 = bbox[:4]
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2
        return cx, cy
    
    def _calculate_center_offset(self, face_center: tuple[float, float]) -> float:
        """计算距离图像中心的偏移"""
        fx, fy = face_center
        ix, iy = self.image_center
        return np.sqrt((fx - ix) ** 2 + (fy - iy) ** 2)
    
    def _is_same_face(
        self,
        bbox1: np.ndarray,
        bbox2: np.ndarray,
        iou_threshold: float = 0.3
    ) -> bool:
        """
        判断两个边界框是否代表同一张人脸
        
        Args:
            bbox1, bbox2: 两个边界框
            iou_threshold: IoU 阈值
            
        Returns:
            True 如果是同一张人脸
        """
        # 计算 IoU
        x1 = max(bbox1[0], bbox2[0])
        y1 = max(bbox1[1], bbox2[1])
        x2 = min(bbox1[2], bbox2[2])
        y2 = min(bbox1[3], bbox2[3])
        
        intersection = max(0, x2 - x1) * max(0, y2 - y1)
        
        area1 = self._calculate_area(bbox1)
        area2 = self._calculate_area(bbox2)
        union = area1 + area2 - intersection
        
        if union <= 0:
            return False
        
        iou = intersection / union
        
        # 也检查中心点距离
        c1 = self._calculate_center(bbox1)
        c2 = self._calculate_center(bbox2)
        center_dist = np.sqrt((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2)
        
        # 阈值: IoU > 0.3 或 中心距离 < 50px
        return iou > iou_threshold or center_dist < 50
    
    def get_locked_face(self) -> Optional[np.ndarray]:
        """获取当前锁定的人脸"""
        if self._locked_face is not None:
            return self._locked_face.bbox
        return None
    
    def is_locked(self) -> bool:
        """是否已锁定人脸"""
        return self._locked_face is not None
    
    def reset(self) -> None:
        """重置锁定"""
        self._locked_face = None
        self._lock_stable_frames = 0


@dataclass
class AntiSpoofingCheck:
    """防欺骗检测结果"""
    is_real: bool = True
    confidence: float = 1.0
    warning: Optional[str] = None


class AntiSpoofingMonitor:
    """防作弊监控器
    
    监控人脸稳定性和身份一致性。
    """
    
    def __init__(
        self,
        face_stability_threshold: float = 0.8,
        tracking_required_frames: int = 3
    ):
        """
        初始化防作弊监控器
        
        Args:
            face_stability_threshold: 人脸稳定性阈值 (0-1)
            tracking_required_frames: 确认追踪所需的连续帧数
        """
        self.face_stability_threshold = face_stability_threshold
        self.tracking_required_frames = tracking_required_frames
        
        # 追踪状态
        self._tracked_bbox: Optional[np.ndarray] = None
        self._stable_frames = 0
        self._appearance_changed = False
        
        # 历史记录
        self._bbox_history: list[np.ndarray] = []
        self._max_history = 30
    
    def update(self, current_bbox: Optional[np.ndarray]) -> None:
        """更新追踪状态"""
        if current_bbox is None:
            # 无脸
            self._stable_frames = 0
            self._tracked_bbox = None
            return
        
        if self._tracked_bbox is None:
            # 首次追踪
            self._tracked_bbox = current_bbox.copy()
            self._stable_frames = 1
        else:
            # 检查是否稳定
            iou = self._calculate_iou(current_bbox, self._tracked_bbox)
            
            if iou > 0.5:  # 高度重叠
                self._stable_frames += 1
                # 平滑更新追踪框
                alpha = 0.3
                self._tracked_bbox = alpha * current_bbox + (1 - alpha) * self._tracked_bbox
            else:
                # 人脸切换或大幅移动
                if self._stable_frames >= self.tracking_required_frames:
                    self._appearance_changed = True
                self._stable_frames = 1
                self._tracked_bbox = current_bbox.copy()
        
        # 记录历史
        self._bbox_history.append(current_bbox.copy())
        if len(self._bbox_history) > self._max_history:
            self._bbox_history.pop(0)
    
    def _calculate_iou(self, bbox1: np.ndarray, bbox2: np.ndarray) -> float:
        """计算 IoU"""
        x1 = max(bbox1[0], bbox2[0])
        y1 = max(bbox1[1], bbox2[1])
        x2 = min(bbox1[2], bbox2[2])
        y2 = min(bbox1[3], bbox2[3])
        
        intersection = max(0, x2 - x1) * max(0, y2 - y1)
        
        area1 = (bbox1[2] - bbox1[0]) * (bbox1[3] - bbox1[1])
        area2 = (bbox2[2] - bbox2[0]) * (bbox2[3] - bbox2[1])
        union = area1 + area2 - intersection
        
        if union <= 0:
            return 0.0
        
        return intersection / union
    
    def is_tracking_stable(self) -> bool:
        """追踪是否稳定"""
        return self._stable_frames >= self.tracking_required_frames
    
    def is_appearance_changed(self) -> bool:
        """人脸是否发生切换"""
        return self._appearance_changed
    
    def reset_appearance_flag(self) -> None:
        """重置外观切换标志"""
        self._appearance_changed = False
    
    def get_stability_score(self) -> float:
        """获取稳定性评分"""
        if len(self._bbox_history) < 2:
            return 1.0
        
        # 计算历史边界框的变化程度
        if len(self._bbox_history) >= 2:
            last_bbox = self._bbox_history[-1]
            prev_bbox = self._bbox_history[-2]
            iou = self._calculate_iou(last_bbox, prev_bbox)
            return float(iou)
        
        return 1.0
    
    def reset(self) -> None:
        """重置状态"""
        self._tracked_bbox = None
        self._stable_frames = 0
        self._appearance_changed = False
        self._bbox_history.clear()
