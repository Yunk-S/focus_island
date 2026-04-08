"""
Video Stream Controller Module

Implements frame sampling and target face locking logic.

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
    """Face selection mode"""
    LARGEST = "largest"              # Select largest face
    MOST_CENTERED = "most_centered"   # Select most centered face
    COMBINED = "combined"           # Combined score


@dataclass
class FaceCandidate:
    """Face candidate"""
    bbox: np.ndarray
    confidence: float
    area: float
    center_offset: float  # Offset from image center
    combined_score: float  # Combined score
    
    def __post_init__(self):
        # Calculate combined score (larger area is better, smaller offset is better)
        # Normalized
        area_score = min(self.area / 100000, 1.0) * 0.5  # Area weight 50%
        center_score = max(0, 1 - self.center_offset / 500) * 0.5  # Center weight 50%
        self.combined_score = area_score + center_score


@dataclass
class FrameController:
    """Frame Sampling Controller
    
    Controls video stream frame sampling rate to reduce power consumption.
    Recommended to process 3-5 frames per second, not full 30 FPS.
    """
    
    # Frame rate config
    target_fps: float = 4.0            # Target processing frame rate
    min_frame_interval: float = 0.1   # Min frame interval (seconds)
    
    # State
    _last_process_time: float = 0.0
    _frame_counter: int = 0
    _total_frames: int = 0
    
    def __post_init__(self):
        self.min_frame_interval = 1.0 / self.target_fps
    
    def should_process_frame(self) -> bool:
        """
        Determine if current frame should be processed
        
        Returns:
            True if should process this frame
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
        """Force process current frame"""
        self._last_process_time = time.time()
        self._frame_counter += 1
        self._total_frames += 1
        return True
    
    def get_stats(self) -> dict:
        """Get statistics"""
        elapsed_total = time.time() - self._last_process_time + (self._frame_counter * self.min_frame_interval)
        actual_fps = self._total_frames / max(elapsed_total, 1.0)
        
        return {
            "target_fps": self.target_fps,
            "actual_fps": round(actual_fps, 2),
            "total_frames": self._total_frames,
            "min_interval_ms": round(self.min_frame_interval * 1000, 1)
        }
    
    def reset(self) -> None:
        """Reset state"""
        self._last_process_time = 0.0
        self._frame_counter = 0
        self._total_frames = 0


class FaceSelector:
    """Target Face Selector
    
    When multiple faces are in frame, select the most suitable one as "current seat user".
    """
    
    def __init__(
        self,
        mode: FaceSelectionMode = FaceSelectionMode.COMBINED,
        image_center: Optional[tuple[float, float]] = None,
        image_size: tuple[int, int] = (640, 480)
    ):
        """
        Initialize face selector
        
        Args:
            mode: Selection mode
            image_center: Image center coordinates (x, y)
            image_size: Image size (width, height)
        """
        self.mode = mode
        self.image_center = image_center or (image_size[0] / 2, image_size[1] / 2)
        self.image_width = image_size[0]
        self.image_height = image_size[1]
        
        # Currently locked face
        self._locked_face: Optional[FaceCandidate] = None
        self._lock_stable_frames = 0
        self._unlock_frames_threshold = 5  # Unlock after 5 consecutive frames without detection
        
        logger.info(f"FaceSelector initialized: mode={mode.value}")
    
    def update_image_params(self, image_width: int, image_height: int) -> None:
        """Update image params"""
        self.image_width = image_width
        self.image_height = image_height
        self.image_center = (image_width / 2, image_height / 2)
    
    def select_target_face(self, faces: list, frame_bbox: Optional[np.ndarray] = None) -> Optional[np.ndarray]:
        """
        Select target face from multiple faces
        
        Args:
            faces: All Face objects detected by RetinaFace
            frame_bbox: Previous frame's target face bounding box (for tracking)
            
        Returns:
            Selected face bounding box, or None
        """
        if not faces:
            # No face detected
            if self._locked_face is not None:
                self._lock_stable_frames = 0
            self._locked_face = None
            return None
        
        # Build candidate list
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
        
        # Select based on mode
        if self.mode == FaceSelectionMode.LARGEST:
            best = max(candidates, key=lambda c: c.area)
        elif self.mode == FaceSelectionMode.MOST_CENTERED:
            best = min(candidates, key=lambda c: c.center_offset)
        else:  # COMBINED
            best = max(candidates, key=lambda c: c.combined_score)
        
        # Check if matches locked face
        if self._locked_face is not None:
            if self._is_same_face(best.bbox, self._locked_face.bbox):
                self._lock_stable_frames += 1
            else:
                self._lock_stable_frames = 0
        
        # Update lock
        self._locked_face = best
        
        return best.bbox
    
    def _calculate_area(self, bbox: np.ndarray) -> float:
        """Calculate face area"""
        x1, y1, x2, y2 = bbox[:4]
        return float((x2 - x1) * (y2 - y1))
    
    def _calculate_center(self, bbox: np.ndarray) -> tuple[float, float]:
        """Calculate face center point"""
        x1, y1, x2, y2 = bbox[:4]
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2
        return cx, cy
    
    def _calculate_center_offset(self, face_center: tuple[float, float]) -> float:
        """Calculate offset from image center"""
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
        Determine if two bounding boxes represent the same face
        
        Args:
            bbox1, bbox2: Two bounding boxes
            iou_threshold: IoU threshold
            
        Returns:
            True if same face
        """
        # Calculate IoU
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
        
        # Also check center distance
        c1 = self._calculate_center(bbox1)
        c2 = self._calculate_center(bbox2)
        center_dist = np.sqrt((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2)
        
        # Threshold: IoU > 0.3 or center distance < 50px
        return iou > iou_threshold or center_dist < 50
    
    def get_locked_face(self) -> Optional[np.ndarray]:
        """Get currently locked face"""
        if self._locked_face is not None:
            return self._locked_face.bbox
        return None
    
    def is_locked(self) -> bool:
        """Is face locked"""
        return self._locked_face is not None
    
    def reset(self) -> None:
        """Reset lock"""
        self._locked_face = None
        self._lock_stable_frames = 0


@dataclass
class AntiSpoofingCheck:
    """Anti-spoofing check result"""
    is_real: bool = True
    confidence: float = 1.0
    warning: Optional[str] = None


class AntiSpoofingMonitor:
    """Anti-cheating Monitor
    
    Monitors face stability and identity consistency.
    """
    
    def __init__(
        self,
        face_stability_threshold: float = 0.8,
        tracking_required_frames: int = 3
    ):
        """
        Initialize anti-cheating monitor
        
        Args:
            face_stability_threshold: Face stability threshold (0-1)
            tracking_required_frames: Consecutive frames required to confirm tracking
        """
        self.face_stability_threshold = face_stability_threshold
        self.tracking_required_frames = tracking_required_frames
        
        # Tracking state
        self._tracked_bbox: Optional[np.ndarray] = None
        self._stable_frames = 0
        self._appearance_changed = False
        
        # History
        self._bbox_history: list[np.ndarray] = []
        self._max_history = 30
    
    def update(self, current_bbox: Optional[np.ndarray]) -> None:
        """Update tracking state"""
        if current_bbox is None:
            # No face
            self._stable_frames = 0
            self._tracked_bbox = None
            return
        
        if self._tracked_bbox is None:
            # First tracking
            self._tracked_bbox = current_bbox.copy()
            self._stable_frames = 1
        else:
            # Check if stable
            iou = self._calculate_iou(current_bbox, self._tracked_bbox)
            
            if iou > 0.5:  # High overlap
                self._stable_frames += 1
                # Smooth update tracking box
                alpha = 0.3
                self._tracked_bbox = alpha * current_bbox + (1 - alpha) * self._tracked_bbox
            else:
                # Face switch or large movement
                if self._stable_frames >= self.tracking_required_frames:
                    self._appearance_changed = True
                self._stable_frames = 1
                self._tracked_bbox = current_bbox.copy()
        
        # Record history
        self._bbox_history.append(current_bbox.copy())
        if len(self._bbox_history) > self._max_history:
            self._bbox_history.pop(0)
    
    def _calculate_iou(self, bbox1: np.ndarray, bbox2: np.ndarray) -> float:
        """Calculate IoU"""
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
        """Is tracking stable"""
        return self._stable_frames >= self.tracking_required_frames
    
    def is_appearance_changed(self) -> bool:
        """Has face switch occurred"""
        return self._appearance_changed
    
    def reset_appearance_flag(self) -> None:
        """Reset appearance switch flag"""
        self._appearance_changed = False
    
    def get_stability_score(self) -> float:
        """Get stability score"""
        if len(self._bbox_history) < 2:
            return 1.0
        
        # Calculate variation in historical bounding boxes
        if len(self._bbox_history) >= 2:
            last_bbox = self._bbox_history[-1]
            prev_bbox = self._bbox_history[-2]
            iou = self._calculate_iou(last_bbox, prev_bbox)
            return float(iou)
        
        return 1.0
    
    def reset(self) -> None:
        """Reset state"""
        self._tracked_bbox = None
        self._stable_frames = 0
        self._appearance_changed = False
        self._bbox_history.clear()
