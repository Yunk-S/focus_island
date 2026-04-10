"""
UniFace Model Manager

Unified management for all ONNX model loading and initialization.
Face detection follows UniFace documentation: https://github.com/yakhyo/uniface
(`from uniface.detection import RetinaFace` + `RetinaFace(providers=...)`;
Local weights in project `models/`, pointed by `UNIFACE_CACHE_DIR`).

Author: SSP Team
"""

from __future__ import annotations

import os

# Set model path as project relative path (must set before import uniface)
# Project structure: e:\project\SSP\focus_island\models\
# __file__ = e:\project\SSP\focus_island\src\focus_island\model_manager.py
# Go up three levels: src -> focus_island(project root) -> e:\project\SSP
# Then enter focus_island/models
MODEL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "models"
)
os.environ["UNIFACE_CACHE_DIR"] = MODEL_DIR

import gc
import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional, Literal

import numpy as np

if TYPE_CHECKING:
    from uniface.detection import RetinaFace, SCRFD
    from uniface.recognition import ArcFace, MobileFace
    from uniface.landmark import Landmark106
    from uniface.headpose import HeadPose
    from uniface.types import HeadPoseResult

from .onnx_util import create_onnx_session_low_memory, resolve_onnx_providers
from .types import SystemInfo


logger = logging.getLogger(__name__)


@dataclass
class ModelStats:
    """Model statistics"""
    model_name: str = ""
    load_time_ms: float = 0.0
    inference_count: int = 0
    total_inference_time_ms: float = 0.0
    avg_inference_time_ms: float = 0.0
    
    def record_inference(self, time_ms: float) -> None:
        """Record an inference"""
        self.inference_count += 1
        self.total_inference_time_ms += time_ms
        self.avg_inference_time_ms = self.total_inference_time_ms / self.inference_count


class ModelManager:
    """UniFace Model Manager
    
    Unified lifecycle management for:
    - RetinaFace: Face detection + 5-point landmarks
    - ArcFace: 512-dim face feature vector extraction
    - Landmark106: 106-point fine landmarks
    - HeadPose: 3D head pose estimation (Pitch/Yaw/Roll)
    """
    
    def __init__(
        self,
        use_cuda: bool = True,
        detector_type: Literal["retinaface", "scrfd"] = "retinaface",
        recognition_model: Literal["arcface", "mobileface"] = "arcface",
        headpose_model: str = "resnet18"
    ):
        """
        Initialize model manager
        
        Args:
            use_cuda: Enable CUDA (GPU)
            detector_type: Face detector type
            recognition_model: Face recognition model type
            headpose_model: Head pose model type
        """
        self.use_cuda = use_cuda
        self.detector_type = detector_type
        self.recognition_model = recognition_model
        self.headpose_model = headpose_model
        
        self.providers = resolve_onnx_providers(use_cuda)
        if use_cuda and self.providers == ["CPUExecutionProvider"]:
            logger.info("CUDA requested but not available; ONNX using CPU only")
        logger.info("ONNX execution providers: %s", self.providers)
        
        # Model instances (type hints only, assigned dynamically by load_all_models)
        self.detector = None
        self.recognizer = None
        self.landmark_detector = None
        self.headpose_estimator = None
        
        # Model statistics
        self.detector_stats = ModelStats(model_name="detector")
        self.recognizer_stats = ModelStats(model_name="recognizer")
        self.landmark_stats = ModelStats(model_name="landmark")
        self.headpose_stats = ModelStats(model_name="headpose")
        
        # Load state
        self._models_loaded = False
        self._load_start_time: float = 0
        self._total_load_time_ms: float = 0
        self._headpose_variant: str = ""
    
    def _load_headpose_estimator(self, HeadPose: type) -> None:
        """Load head pose with low-RAM session options and smaller-model fallbacks.

        UniFace binds ``create_onnx_session`` in ``headpose.models`` at import time,
        so we patch that name (not ``uniface.onnx_utils``) during load only.
        Loading head pose before ArcFace/Landmark reduces peak memory at init time.
        """
        from uniface.constants import HeadPoseWeights
        import uniface.headpose.models as hp_models

        _orig_create = hp_models.create_onnx_session
        hp_models.create_onnx_session = create_onnx_session_low_memory
        try:
            candidates = [
                # Smallest first — avoids "bad allocation" on memory-constrained setups
                HeadPoseWeights.MOBILENET_V3_SMALL,
                HeadPoseWeights.MOBILENET_V2,
                HeadPoseWeights.RESNET18,
            ]
            last_exc: BaseException | None = None
            for weight in candidates:
                gc.collect()
                try:
                    logger.info("Loading head pose estimator (%s)...", weight.value)
                    t0 = time.time()
                    self.headpose_estimator = HeadPose(
                        model_name=weight, providers=self.providers
                    )
                    self._headpose_variant = weight.value
                    logger.info(
                        "Head pose estimator loaded in %.1fms (%s)",
                        (time.time() - t0) * 1000,
                        weight.value,
                    )
                    return
                except RuntimeError as e:
                    last_exc = e
                    logger.warning(
                        "Head pose load failed (%s): %s", weight.value, e
                    )
                    self.headpose_estimator = None
            msg = (
                "Could not load any head pose model (often out of memory: close "
                "other apps or use a machine with more RAM)."
            )
            raise RuntimeError(msg) from last_exc
        finally:
            hp_models.create_onnx_session = _orig_create
    
    def load_all_models(self) -> None:
        """Load all models (lazy import uniface to avoid scipy DLL crash)"""
        if self._models_loaded:
            logger.warning("Models already loaded")
            return

        self._load_start_time = time.time()
        
        # Check if model files exist
        self._ensure_models_exist()

        # ── CRITICAL: Patch uniface ONNX session creation BEFORE any uniface import ──
        # This patch MUST happen before any 'from uniface.xxx import Yyy' statement,
        # otherwise the import will bind the original function reference and our
        # patch won't affect those already-imported modules.
        import uniface.onnx_utils as uniface_onnx
        _orig_uniface_create = uniface_onnx.create_onnx_session
        uniface_onnx.create_onnx_session = create_onnx_session_low_memory
        logger.info("Applied low-memory ONNX session patch (enable_cpu_mem_arena=False)")

        try:
            # ── Now safe to import uniface modules ──────────────────────────────
            from uniface.detection import RetinaFace, SCRFD  # noqa: F811
            from uniface.recognition import ArcFace, MobileFace  # noqa: F811
            from uniface.landmark import Landmark106  # noqa: F811
            from uniface.headpose import HeadPose  # noqa: F811
            # ─────────────────────────────────────────────────────────────────────

            # 1. Load face detector
            logger.info("Loading face detector...")
            t0 = time.time()
            if self.detector_type == "scrfd":
                self.detector = SCRFD(providers=self.providers)
            else:
                self.detector = RetinaFace(providers=self.providers)
            logger.info(f"Face detector loaded in {(time.time() - t0) * 1000:.1f}ms")

            # 2. Head pose (before ArcFace + landmarks to reduce peak RAM at ONNX init)
            self._load_headpose_estimator(HeadPose)

            # 3. Load face recognition model (ArcFace)
            logger.info("Loading face recognizer (ArcFace)...")
            t0 = time.time()
            if self.recognition_model == "mobileface":
                self.recognizer = MobileFace(providers=self.providers)
            else:
                self.recognizer = ArcFace(providers=self.providers)
            logger.info(f"Face recognizer loaded in {(time.time() - t0) * 1000:.1f}ms")

            # 4. Load 106-point landmark detector
            logger.info("Loading 106-point landmark detector...")
            t0 = time.time()
            self.landmark_detector = Landmark106(providers=self.providers)
            logger.info(f"Landmark detector loaded in {(time.time() - t0) * 1000:.1f}ms")
        finally:
            # Restore original create_onnx_session after all models are loaded
            uniface_onnx.create_onnx_session = _orig_uniface_create
            # Free any temporary allocation from the load sequence
            gc.collect()

        self._models_loaded = True
        self._total_load_time_ms = (time.time() - self._load_start_time) * 1000
        logger.info(f"All models loaded in {self._total_load_time_ms:.1f}ms total")
    
    def _ensure_models_exist(self) -> None:
        """Ensure model files exist"""
        required_models = {
            "retinaface_mnet_v2.onnx": "Face Detection",
            "arcface_mnet.onnx": "Face Recognition",
            "2d_106.onnx": "Landmark Detection",
            "headpose_resnet18.onnx": "Head Pose Estimation"
        }
        
        missing = []
        for model_file, desc in required_models.items():
            model_path = os.path.join(MODEL_DIR, model_file)
            if not os.path.exists(model_path):
                missing.append((model_file, desc))
        
        if missing:
            logger.warning("Some models are missing:")
            for model_file, desc in missing:
                logger.warning(f"  - {model_file} ({desc})")
            logger.warning(f"Please download models to: {MODEL_DIR}")
    
    def detect_faces(self, image: np.ndarray) -> list:
        """
        Face detection
        
        Args:
            image: Input image (BGR format)
            
        Returns:
            List of Face objects
        """
        t0 = time.time()
        faces = self.detector.detect(image)
        self.detector_stats.record_inference((time.time() - t0) * 1000)
        return faces
    
    def extract_embedding(self, image: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        """
        Extract face feature vector (512-dim)
        
        Args:
            image: Input image (BGR format)
            landmarks: 5-point landmarks (for face alignment)
            
        Returns:
            512-dim normalized feature vector
        """
        t0 = time.time()
        embedding = self.recognizer.get_normalized_embedding(image, landmarks)
        self.recognizer_stats.record_inference((time.time() - t0) * 1000)
        return embedding
    
    def get_landmarks_106(self, image: np.ndarray, bbox: np.ndarray) -> np.ndarray:
        """
        Get 106-point facial landmarks
        
        Args:
            image: Input image (BGR format)
            bbox: Face bounding box [x1, y1, x2, y2]
            
        Returns:
            106-point coordinates array, shape (106, 2)
        """
        t0 = time.time()
        landmarks = self.landmark_detector.get_landmarks(image, bbox)
        self.landmark_stats.record_inference((time.time() - t0) * 1000)
        return landmarks
    
    def estimate_head_pose(self, face_crop: np.ndarray) -> HeadPoseResult:
        """
        Estimate head pose
        
        Args:
            face_crop: Face crop image (BGR format)
            
        Returns:
            HeadPoseResult, contains pitch, yaw, roll (degrees)
        """
        t0 = time.time()
        result = self.headpose_estimator.estimate(face_crop)
        self.headpose_stats.record_inference((time.time() - t0) * 1000)
        return result
    
    def extract_face_embedding(self, image: np.ndarray, face) -> tuple[np.ndarray, np.ndarray]:
        """
        Extract 512-dim feature vector from detected face
        
        Args:
            image: Input image
            face: Face object returned by RetinaFace
            
        Returns:
            (embedding, aligned_face): 512-dim feature vector and aligned face image
        """
        import cv2
        from uniface.face_utils import face_alignment
        
        # Get 5-point landmarks for alignment
        landmarks_5 = face.landmarks  # (5, 2)
        
        # Face alignment (112x112)
        aligned_face, _ = face_alignment(image, landmarks_5, image_size=(112, 112))
        
        # Extract feature vector
        embedding = self.extract_embedding(aligned_face, landmarks_5)
        
        return embedding, aligned_face
    
    def full_analysis(self, image: np.ndarray, bbox: np.ndarray) -> dict:
        """
        Complete face analysis (one-stop to get all data)
        
        Args:
            image: Input image
            bbox: Face bounding box [x1, y1, x2, y2]
            
        Returns:
            Dict containing all analysis results
        """
        import cv2
        from uniface.face_utils import face_alignment
        
        x1, y1, x2, y2 = map(int, bbox[:4])
        
        # 1. Face crop
        face_crop = image[y1:y2, x1:x2]
        if face_crop.size == 0:
            return None
        
        # 2. Head pose
        head_pose = self.estimate_head_pose(face_crop)
        
        # 3. 106-point landmarks
        landmarks_106 = self.get_landmarks_106(image, bbox)
        
        # 4. 5-point landmarks and aligned face (for recognition)
        faces = self.detect_faces(image)
        if not faces:
            return None
        
        # Find corresponding face object
        target_face = None
        for f in faces:
            if np.allclose(f.bbox, bbox, atol=1.0):
                target_face = f
                break
        if target_face is None:
            target_face = faces[0]
        
        # Face alignment and feature extraction
        embedding, aligned_face = self.extract_face_embedding(image, target_face)
        
        return {
            "bbox": bbox,
            "face_crop": face_crop,
            "aligned_face": aligned_face,
            "landmarks_5": target_face.landmarks,
            "landmarks_106": landmarks_106,
            "head_pose": head_pose,
            "embedding": embedding,  # 512-dim feature vector
            "confidence": target_face.confidence
        }
    
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
        
        info.model_loaded = self._models_loaded
        
        return info
    
    def get_stats(self) -> dict:
        """Get model statistics"""
        return {
            "models_loaded": self._models_loaded,
            "total_load_time_ms": round(self._total_load_time_ms, 2),
            "headpose_variant": self._headpose_variant,
            "detector": {
                "count": self.detector_stats.inference_count,
                "avg_ms": round(self.detector_stats.avg_inference_time_ms, 2)
            },
            "recognizer": {
                "count": self.recognizer_stats.inference_count,
                "avg_ms": round(self.recognizer_stats.avg_inference_time_ms, 2)
            },
            "landmark": {
                "count": self.landmark_stats.inference_count,
                "avg_ms": round(self.landmark_stats.avg_inference_time_ms, 2)
            },
            "headpose": {
                "count": self.headpose_stats.inference_count,
                "avg_ms": round(self.headpose_stats.avg_inference_time_ms, 2)
            }
        }
    
    def warmup(self, iterations: int = 3) -> None:
        """Warmup models"""
        import cv2
        
        logger.info(f"Warming up models ({iterations} iterations)...")
        
        # Create test image
        dummy_image = np.zeros((640, 640, 3), dtype=np.uint8)
        
        for i in range(iterations):
            # Face detection
            faces = self.detect_faces(dummy_image)
            
            if faces:
                face = faces[0]
                bbox = face.bbox
                
                # Head pose
                x1, y1, x2, y2 = map(int, bbox[:4])
                face_crop = dummy_image[y1:y2, x1:x2]
                if face_crop.size > 0:
                    self.estimate_head_pose(face_crop)
                
                # 106-point
                self.get_landmarks_106(dummy_image, bbox)
                
                # Feature extraction
                self.extract_face_embedding(dummy_image, face)
        
        logger.info("Warmup complete")
    
    @property
    def is_loaded(self) -> bool:
        """Model loaded status"""
        return self._models_loaded
    
    def release(self) -> None:
        """Release model resources"""
        self.detector = None
        self.recognizer = None
        self.landmark_detector = None
        self.headpose_estimator = None
        self._models_loaded = False
        logger.info("Model resources released")
