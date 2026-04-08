"""
EAR (Eye Aspect Ratio) Eye State Detection Module

Uses 106-point facial landmarks to calculate eye aspect ratio and determine if eyes are open.

Author: SSP Team
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from .types import EyeData, PipelineConfig


logger = logging.getLogger(__name__)


class EYEIndexConfig:
    """Eye landmark indices configuration
    
    Based on UniFace 106-point landmarks indices:
    - Left eye: indices[63-71] = 9 points, but typically use 6 feature points
    - Right eye: indices[72-80] = 9 points, but typically use 6 feature points
    
    EAR calculation uses 6 landmarks:
    - Left eye: [35, 36, 37, 38, 39, 40] or [63, 64, 65, 66, 67, 68]
    - Right eye: [41, 42, 43, 44, 45, 46] or [72, 73, 74, 75, 76, 77]
    
    Standard 6-point configuration (recommended):
    - Left eye outer corner -> corner1 -> upper pupil -> lower pupil -> corner2 -> left outer corner
    - Points: P1, P2, P3, P4, P5, P6
    
    Diagram:
         P2---P3
        /     /
    P1 -       - P6
        /     /
         P5---P4
    """
    
    # Default 6-point indices (using UniFace 106-point continuous range)
    # Left eye: 63, 64, 65, 66, 67, 68 (6 consecutive points)
    # Right eye: 72, 73, 74, 75, 76, 77 (6 consecutive points)
    DEFAULT_LEFT_EYE = [63, 64, 65, 66, 67, 68]
    DEFAULT_RIGHT_EYE = [72, 73, 74, 75, 76, 77]
    
    # Alternative 6-point configurations for different landmark sets
    # Based on dlib 68-point standard configuration (for reference only)
    DLIB_LEFT_EYE = [36, 37, 38, 39, 40, 41]  # Assuming using 68 points
    DLIB_RIGHT_EYE = [42, 43, 44, 45, 46, 47]  # Assuming using 68 points


class EARCalculator:
    """EAR (Eye Aspect Ratio) Calculator
    
    EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
    
    Where:
    - p1, p4 are the left and right corner points of the eye
    - p2, p3 are the upper points of the eye
    - p5, p6 are the lower points of the eye
    """
    
    def __init__(
        self,
        config: PipelineConfig,
        left_eye_indices: Optional[list[int]] = None,
        right_eye_indices: Optional[list[int]] = None
    ):
        """
        Initialize EAR calculator
        
        Args:
            config: Pipeline configuration
            left_eye_indices: Left eye 6-point indices
            right_eye_indices: Right eye 6-point indices
        """
        self.ear_threshold = config.ear_threshold
        self.consecutive_threshold = config.consecutive_eye_closed_threshold
        
        # Eye landmark indices
        self.left_eye_indices = left_eye_indices or config.left_eye_indices or EYEIndexConfig.DEFAULT_LEFT_EYE
        self.right_eye_indices = right_eye_indices or config.right_eye_indices or EYEIndexConfig.DEFAULT_RIGHT_EYE
        
        # Consecutive eye closed frame counter
        self._consecutive_closed_frames = 0
        
        logger.info(
            f"EARCalculator initialized with threshold={self.ear_threshold}, "
            f"consecutive_threshold={self.consecutive_threshold}"
        )
        logger.info(f"Left eye indices: {self.left_eye_indices}")
        logger.info(f"Right eye indices: {self.right_eye_indices}")
    
    def calculate_ear(self, eye_points: np.ndarray) -> float:
        """
        Calculate EAR value for single eye
        
        Args:
            eye_points: 6 landmark coordinates, shape (6, 2), order:
                [p1, p2, p3, p4, p5, p6] - clockwise or counterclockwise
                
        Returns:
            EAR value
        """
        if eye_points.shape != (6, 2):
            logger.warning(f"Invalid eye points shape: {eye_points.shape}, expected (6, 2)")
            return 0.0
        
        # Calculate vertical distances
        # |p2 - p6| and |p3 - p5|
        v1 = np.linalg.norm(eye_points[1] - eye_points[5])
        v2 = np.linalg.norm(eye_points[2] - eye_points[4])
        
        # Calculate horizontal distance
        # |p1 - p4|
        h = np.linalg.norm(eye_points[0] - eye_points[3])
        
        # Avoid division by zero
        if h < 1e-6:
            return 0.0
        
        ear = (v1 + v2) / (2.0 * h)
        
        return float(ear)
    
    def extract_eye_points(self, landmarks_106: np.ndarray, eye_indices: list[int]) -> np.ndarray:
        """
        Extract eye landmarks from 106-point landmarks
        
        Args:
            landmarks_106: 106-point landmarks, shape (106, 2)
            eye_indices: List of 6 landmark indices
            
        Returns:
            6 landmark coordinates, shape (6, 2)
        """
        if len(eye_indices) != 6:
            raise ValueError(f"Expected 6 eye indices, got {len(eye_indices)}")
        
        # Ensure indices are within valid range
        for idx in eye_indices:
            if idx < 0 or idx >= len(landmarks_106):
                raise ValueError(f"Invalid eye index {idx}, landmarks has {len(landmarks_106)} points")
        
        eye_points = landmarks_106[eye_indices]
        return eye_points
    
    def calculate_eye_state(
        self,
        landmarks_106: np.ndarray,
        reset_counter: bool = False
    ) -> tuple[float, float, bool]:
        """
        Calculate both eyes state
        
        Args:
            landmarks_106: 106-point landmarks
            reset_counter: Whether to reset consecutive closed counter
            
        Returns:
            (ear_left, ear_right, is_open)
            - ear_left: Left eye EAR value
            - ear_right: Right eye EAR value
            - is_open: Whether both eyes are open
        """
        if reset_counter:
            self._consecutive_closed_frames = 0
        
        try:
            # Extract both eyes landmarks
            left_eye = self.extract_eye_points(landmarks_106, self.left_eye_indices)
            right_eye = self.extract_eye_points(landmarks_106, self.right_eye_indices)
            
            # Calculate EAR
            ear_left = self.calculate_ear(left_eye)
            ear_right = self.calculate_ear(right_eye)
            
            # Determine if eyes are open
            # Use average or minimum value (stricter judgment)
            ear_avg = (ear_left + ear_right) / 2
            ear_min = min(ear_left, ear_right)
            
            is_open = ear_avg >= self.ear_threshold
            
            # Update consecutive closed counter
            if not is_open:
                self._consecutive_closed_frames += 1
            else:
                self._consecutive_closed_frames = 0
            
            return ear_left, ear_right, is_open
            
        except Exception as e:
            logger.error(f"Error calculating eye state: {e}")
            return 0.0, 0.0, False
    
    def get_eye_data(self, landmarks_106: np.ndarray) -> EyeData:
        """
        Get complete eye state data
        
        Args:
            landmarks_106: 106-point landmarks
            
        Returns:
            EyeData object
        """
        ear_left, ear_right, is_open = self.calculate_eye_state(landmarks_106)
        ear_avg = (ear_left + ear_right) / 2
        
        return EyeData(
            ear_left=ear_left,
            ear_right=ear_right,
            ear_avg=ear_avg,
            is_open=is_open,
            consecutive_closed=self._consecutive_closed_frames
        )
    
    def is_eyes_closed_sustained(self) -> bool:
        """
        Check if eyes are continuously closed beyond threshold
        
        Returns:
            True if consecutive closed frames exceed threshold
        """
        return self._consecutive_closed_frames >= self.consecutive_threshold
    
    def reset(self) -> None:
        """Reset state"""
        self._consecutive_closed_frames = 0


def visualize_eye_points(
    image: np.ndarray,
    landmarks_106: np.ndarray,
    left_eye_indices: list[int],
    right_eye_indices: list[int],
    color: tuple = (0, 255, 0),
    radius: int = 2
) -> np.ndarray:
    """
    Visualize eye landmarks on image
    
    Args:
        image: Input image
        landmarks_106: 106-point landmarks
        left_eye_indices: Left eye indices
        right_eye_indices: Right eye indices
        color: Drawing color
        radius: Point radius
        
    Returns:
        Image with landmarks drawn
    """
    import cv2
    
    vis_image = image.copy()
    
    # Draw left eye
    for idx in left_eye_indices:
        x, y = map(int, landmarks_106[idx])
        cv2.circle(vis_image, (x, y), radius, color, -1)
    
    # Draw right eye
    for idx in right_eye_indices:
        x, y = map(int, landmarks_106[idx])
        cv2.circle(vis_image, (x, y), radius, color, -1)
    
    # Connect both eyes' points
    left_eye_pts = landmarks_106[left_eye_indices].astype(int)
    right_eye_pts = landmarks_106[right_eye_indices].astype(int)
    
    # Draw left eye contour
    for i in range(len(left_eye_pts) - 1):
        cv2.line(vis_image, tuple(left_eye_pts[i]), tuple(left_eye_pts[i + 1]), color, 1)
    cv2.line(vis_image, tuple(left_eye_pts[-1]), tuple(left_eye_pts[0]), color, 1)
    
    # Draw right eye contour
    for i in range(len(right_eye_pts) - 1):
        cv2.line(vis_image, tuple(right_eye_pts[i]), tuple(right_eye_pts[i + 1]), color, 1)
    cv2.line(vis_image, tuple(right_eye_pts[-1]), tuple(right_eye_pts[0]), color, 1)
    
    return vis_image
