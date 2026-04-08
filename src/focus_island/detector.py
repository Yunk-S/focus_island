"""
Core Detection Module

Wraps UniFace's face detection, head pose estimation and landmark detection functionality.

Author: SSP Team
"""

from __future__ import annotations

import time
import logging
from typing import TYPE_CHECKING, Optional

import cv2
import numpy as np

if TYPE_CHECKING:
    from uniface.detection import RetinaFace, SCRFD
    from uniface.headpose import HeadPose, HeadPoseResult
    from uniface.landmark import Landmark106

from .onnx_util import resolve_onnx_providers
from .types import HeadPoseData, PipelineConfig, SystemInfo


logger = logging.getLogger(__name__)


class CoreDetector:
    """Core Detector - Wraps UniFace Models"""
    
    def __init__(
        self,
        config: PipelineConfig,
        use_cuda: bool = True,
        detector_type: str = "retinaface"
    ):
        """
        Initialize core detector
        
        Args:
            config: Pipeline configuration
            use_cuda: Enable CUDA
            detector_type: Detector type ("retinaface", "scrfd")
        """
        self.config = config
        self.use_cuda = use_cuda
        self.detector_type = detector_type
        self.providers = resolve_onnx_providers(use_cuda)
        
        # Model instances (dynamically assigned by _init_models at runtime)
        self.detector = None
        self.head_pose_estimator = None
        self.landmark_detector = None

        # Initialize models
        self._init_models()
        
        logger.info(f"CoreDetector initialized with {detector_type}, CUDA={use_cuda}")
    
    def _init_models(self) -> None:
        """Initialize all models (lazy import uniface)"""
        # Real uniface import here
        from uniface.detection import RetinaFace, SCRFD  # noqa: F811
        from uniface.headpose import HeadPose  # noqa: F811
        from uniface.landmark import Landmark106  # noqa: F811

        # 1. Face detector
        logger.info("Loading face detector...")
        if self.detector_type == "scrfd":
            self.detector = SCRFD(providers=self.providers)
        else:
            self.detector = RetinaFace(providers=self.providers)
        
        # 2. Head pose estimator
        logger.info("Loading head pose estimator...")
        self.head_pose_estimator = HeadPose(providers=self.providers)
        
        # 3. 106-point landmark detector
        logger.info("Loading landmark detector...")
        self.landmark_detector = Landmark106(providers=self.providers)
        
        logger.info("All models loaded successfully")
    
    def detect_face(self, image: np.ndarray) -> Optional[dict]:
        """
        Detect face and extract all necessary information
        
        Args:
            image: Input image (BGR format)
            
        Returns:
            Dict containing detection results with:
            - bbox: Face bounding box
            - landmarks_5: 5-point landmarks
            - confidence: Confidence score
            - face_crop: Face crop image
            - landmarks_106: 106-point landmarks
            - head_pose: Head pose data
        """
        start_time = time.time()
        
        # Face detection
        faces = self.detector.detect(image)
        
        if not faces:
            return None
        
        # Get highest confidence face
        face = faces[0]
        
        # Extract bounding box
        bbox = face.bbox
        x1, y1, x2, y2 = map(int, bbox[:4])
        
        # Face crop
        face_crop = image[y1:y2, x1:x2]
        
        if face_crop.size == 0:
            return None
        
        # Head pose estimation
        head_pose_result = self.head_pose_estimator.estimate(face_crop)
        head_pose_data = self._convert_head_pose(head_pose_result)
        
        # 106-point landmark detection
        landmarks_106 = self.landmark_detector.get_landmarks(image, bbox)
        
        detection_time = (time.time() - start_time) * 1000
        
        return {
            "bbox": bbox,
            "landmarks_5": face.landmarks,
            "confidence": face.confidence,
            "face_crop": face_crop,
            "landmarks_106": landmarks_106,
            "head_pose": head_pose_data,
            "detection_time_ms": detection_time
        }
    
    def _convert_head_pose(self, result: HeadPoseResult) -> HeadPoseData:
        """Convert head pose result"""
        pitch, yaw, roll = result.pitch, result.yaw, result.roll
        
        # Check if within valid range
        is_valid = (
            abs(pitch) <= self.config.pitch_threshold and
            abs(yaw) <= self.config.yaw_threshold
        )
        
        return HeadPoseData(
            pitch=pitch,
            yaw=yaw,
            roll=roll,
            is_valid=is_valid
        )
    
    def get_system_info(self) -> SystemInfo:
        """Get system info"""
        info = SystemInfo()
        
        try:
            import onnxruntime as ort
            info.onnx_providers = ort.get_available_providers()
            
            if "CUDAExecutionProvider" in info.onnx_providers:
                info.gpu_available = True
                try:
                    opts = ort.CUDAProviderOptions()
                    info.gpu_name = "NVIDIA GPU (CUDA)"
                except:
                    info.gpu_name = "CUDA Available"
        except ImportError:
            pass
        
        return info
    
    def warmup(self, image_size: tuple = (640, 640)) -> None:
        """Warmup models"""
        logger.info("Warming up models...")
        dummy_image = np.zeros((image_size[1], image_size[0], 3), dtype=np.uint8)
        
        # Run several inferences
        for _ in range(3):
            self.detect_face(dummy_image)
        
        logger.info("Warmup complete")


class FaceDetectorLite:
    """Lightweight face detector - only for quickly detecting face existence"""

    def __init__(self, use_cuda: bool = True):
        """Initialize lightweight detector"""
        self.use_cuda = use_cuda
        self.providers = resolve_onnx_providers(use_cuda)

        # Use RetinaFace (fast) - lazy import
        from uniface.detection import RetinaFace  # noqa: F811
        self.detector = RetinaFace(providers=self.providers)
    
    def detect(self, image: np.ndarray) -> Optional[dict]:
        """Quick face detection"""
        faces = self.detector.detect(image)
        
        if not faces:
            return None
        
        face = faces[0]
        return {
            "bbox": face.bbox,
            "confidence": face.confidence,
            "landmarks_5": face.landmarks
        }
    
    def warmup(self) -> None:
        """Warmup"""
        dummy = np.zeros((640, 640, 3), dtype=np.uint8)
        for _ in range(3):
            self.detect(dummy)
