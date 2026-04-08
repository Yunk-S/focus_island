"""
UniFace 模型管理器

统一管理所有 ONNX 模型的加载和初始化。
人脸检测遵循 UniFace 文档: https://github.com/yakhyo/uniface
（`from uniface.detection import RetinaFace` + `RetinaFace(providers=...)`；
本地权重放在项目 `models/`，通过 `UNIFACE_CACHE_DIR` 指向该目录）。

Author: SSP Team
"""

from __future__ import annotations

import os

# 设置模型路径为项目相对路径 (必须在 import uniface 之前设置)
# 项目结构: e:\project\SSP\focus_island\models\
# __file__ = e:\project\SSP\focus_island\src\focus_island\model_manager.py
# 向上三级: src -> focus_island(项目根目录) -> e:\project\SSP
# 然后进入 focus_island/models
MODEL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "models"
)
os.environ["UNIFACE_CACHE_DIR"] = MODEL_DIR

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

from .onnx_util import resolve_onnx_providers
from .types import SystemInfo


logger = logging.getLogger(__name__)


@dataclass
class ModelStats:
    """模型统计信息"""
    model_name: str = ""
    load_time_ms: float = 0.0
    inference_count: int = 0
    total_inference_time_ms: float = 0.0
    avg_inference_time_ms: float = 0.0
    
    def record_inference(self, time_ms: float) -> None:
        """记录一次推理"""
        self.inference_count += 1
        self.total_inference_time_ms += time_ms
        self.avg_inference_time_ms = self.total_inference_time_ms / self.inference_count


class ModelManager:
    """UniFace 模型管理器
    
    统一管理以下模型的生命周期:
    - RetinaFace: 人脸检测 + 5点关键点
    - ArcFace: 512维面部特征向量提取
    - Landmark106: 106点精细关键点
    - HeadPose: 3D头部姿态估计 (Pitch/Yaw/Roll)
    """
    
    def __init__(
        self,
        use_cuda: bool = True,
        detector_type: Literal["retinaface", "scrfd"] = "retinaface",
        recognition_model: Literal["arcface", "mobileface"] = "arcface",
        headpose_model: str = "resnet18"
    ):
        """
        初始化模型管理器
        
        Args:
            use_cuda: 是否使用 CUDA (GPU)
            detector_type: 人脸检测器类型
            recognition_model: 人脸识别模型类型
            headpose_model: 头部姿态模型类型
        """
        self.use_cuda = use_cuda
        self.detector_type = detector_type
        self.recognition_model = recognition_model
        self.headpose_model = headpose_model
        
        self.providers = resolve_onnx_providers(use_cuda)
        if use_cuda and self.providers == ["CPUExecutionProvider"]:
            logger.info("CUDA requested but not available; ONNX using CPU only")
        logger.info("ONNX execution providers: %s", self.providers)
        
        # 模型实例 (类型仅作提示，由 load_all_models 动态赋值)
        self.detector = None
        self.recognizer = None
        self.landmark_detector = None
        self.headpose_estimator = None
        
        # 模型统计
        self.detector_stats = ModelStats(model_name="detector")
        self.recognizer_stats = ModelStats(model_name="recognizer")
        self.landmark_stats = ModelStats(model_name="landmark")
        self.headpose_stats = ModelStats(model_name="headpose")
        
        # 加载状态
        self._models_loaded = False
        self._load_start_time: float = 0
        self._total_load_time_ms: float = 0
    
    def load_all_models(self) -> None:
        """加载所有模型（延迟导入 uniface 以规避 scipy DLL 崩溃）"""
        if self._models_loaded:
            logger.warning("Models already loaded")
            return

        # ── 真正的 uniface 导入在这里执行 ───────────────────────────────
        from uniface.detection import RetinaFace, SCRFD  # noqa: F811
        from uniface.recognition import ArcFace, MobileFace  # noqa: F811
        from uniface.landmark import Landmark106  # noqa: F811
        from uniface.headpose import HeadPose  # noqa: F811
        # ─────────────────────────────────────────────────────────────

        self._load_start_time = time.time()
        
        # 检查模型文件是否存在
        self._ensure_models_exist()
        
        # 1. 加载人脸检测器
        logger.info("Loading face detector...")
        t0 = time.time()
        if self.detector_type == "scrfd":
            self.detector = SCRFD(providers=self.providers)
        else:
            self.detector = RetinaFace(providers=self.providers)
        logger.info(f"Face detector loaded in {(time.time() - t0) * 1000:.1f}ms")
        
        # 2. 加载人脸识别模型 (ArcFace)
        logger.info("Loading face recognizer (ArcFace)...")
        t0 = time.time()
        if self.recognition_model == "mobileface":
            self.recognizer = MobileFace(providers=self.providers)
        else:
            self.recognizer = ArcFace(providers=self.providers)
        logger.info(f"Face recognizer loaded in {(time.time() - t0) * 1000:.1f}ms")
        
        # 3. 加载106点关键点检测器
        logger.info("Loading 106-point landmark detector...")
        t0 = time.time()
        self.landmark_detector = Landmark106(providers=self.providers)
        logger.info(f"Landmark detector loaded in {(time.time() - t0) * 1000:.1f}ms")
        
        # 4. 加载头部姿态估计模型
        logger.info("Loading head pose estimator...")
        t0 = time.time()
        self.headpose_estimator = HeadPose(providers=self.providers)
        logger.info(f"Head pose estimator loaded in {(time.time() - t0) * 1000:.1f}ms")
        
        self._models_loaded = True
        self._total_load_time_ms = (time.time() - self._load_start_time) * 1000
        logger.info(f"All models loaded in {self._total_load_time_ms:.1f}ms total")
    
    def _ensure_models_exist(self) -> None:
        """确保模型文件存在"""
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
        人脸检测
        
        Args:
            image: 输入图像 (BGR格式)
            
        Returns:
            Face 对象列表
        """
        t0 = time.time()
        faces = self.detector.detect(image)
        self.detector_stats.record_inference((time.time() - t0) * 1000)
        return faces
    
    def extract_embedding(self, image: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        """
        提取人脸特征向量 (512维)
        
        Args:
            image: 输入图像 (BGR格式)
            landmarks: 5点关键点 (用于人脸对齐)
            
        Returns:
            512维归一化特征向量
        """
        t0 = time.time()
        embedding = self.recognizer.get_normalized_embedding(image, landmarks)
        self.recognizer_stats.record_inference((time.time() - t0) * 1000)
        return embedding
    
    def get_landmarks_106(self, image: np.ndarray, bbox: np.ndarray) -> np.ndarray:
        """
        获取106点面部关键点
        
        Args:
            image: 输入图像 (BGR格式)
            bbox: 人脸边界框 [x1, y1, x2, y2]
            
        Returns:
            106点坐标数组，形状 (106, 2)
        """
        t0 = time.time()
        landmarks = self.landmark_detector.get_landmarks(image, bbox)
        self.landmark_stats.record_inference((time.time() - t0) * 1000)
        return landmarks
    
    def estimate_head_pose(self, face_crop: np.ndarray) -> HeadPoseResult:
        """
        估计头部姿态
        
        Args:
            face_crop: 人脸裁剪图 (BGR格式)
            
        Returns:
            HeadPoseResult，包含 pitch, yaw, roll (度)
        """
        t0 = time.time()
        result = self.headpose_estimator.estimate(face_crop)
        self.headpose_stats.record_inference((time.time() - t0) * 1000)
        return result
    
    def extract_face_embedding(self, image: np.ndarray, face) -> tuple[np.ndarray, np.ndarray]:
        """
        从检测到的人脸提取512维特征向量
        
        Args:
            image: 输入图像
            face: RetinaFace 返回的 Face 对象
            
        Returns:
            (embedding, aligned_face): 512维特征向量和对齐后的人脸图
        """
        import cv2
        from uniface.face_utils import face_alignment
        
        # 获取5点关键点用于对齐
        landmarks_5 = face.landmarks  # (5, 2)
        
        # 人脸对齐 (112x112)
        aligned_face, _ = face_alignment(image, landmarks_5, image_size=(112, 112))
        
        # 提取特征向量
        embedding = self.extract_embedding(aligned_face, landmarks_5)
        
        return embedding, aligned_face
    
    def full_analysis(self, image: np.ndarray, bbox: np.ndarray) -> dict:
        """
        完整人脸分析 (一站式获取所有数据)
        
        Args:
            image: 输入图像
            bbox: 人脸边界框 [x1, y1, x2, y2]
            
        Returns:
            包含所有分析结果的字典
        """
        import cv2
        from uniface.face_utils import face_alignment
        
        x1, y1, x2, y2 = map(int, bbox[:4])
        
        # 1. 人脸裁剪
        face_crop = image[y1:y2, x1:x2]
        if face_crop.size == 0:
            return None
        
        # 2. 头部姿态
        head_pose = self.estimate_head_pose(face_crop)
        
        # 3. 106点关键点
        landmarks_106 = self.get_landmarks_106(image, bbox)
        
        # 4. 5点关键点和对齐人脸 (用于识别)
        faces = self.detect_faces(image)
        if not faces:
            return None
        
        # 找对应的face对象
        target_face = None
        for f in faces:
            if np.allclose(f.bbox, bbox, atol=1.0):
                target_face = f
                break
        if target_face is None:
            target_face = faces[0]
        
        # 人脸对齐和特征提取
        embedding, aligned_face = self.extract_face_embedding(image, target_face)
        
        return {
            "bbox": bbox,
            "face_crop": face_crop,
            "aligned_face": aligned_face,
            "landmarks_5": target_face.landmarks,
            "landmarks_106": landmarks_106,
            "head_pose": head_pose,
            "embedding": embedding,  # 512维特征向量
            "confidence": target_face.confidence
        }
    
    def get_system_info(self) -> SystemInfo:
        """获取系统信息"""
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
        """获取模型统计"""
        return {
            "models_loaded": self._models_loaded,
            "total_load_time_ms": round(self._total_load_time_ms, 2),
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
        """预热模型"""
        import cv2
        
        logger.info(f"Warming up models ({iterations} iterations)...")
        
        # 创建测试图像
        dummy_image = np.zeros((640, 640, 3), dtype=np.uint8)
        
        for i in range(iterations):
            # 人脸检测
            faces = self.detect_faces(dummy_image)
            
            if faces:
                face = faces[0]
                bbox = face.bbox
                
                # 头部姿态
                x1, y1, x2, y2 = map(int, bbox[:4])
                face_crop = dummy_image[y1:y2, x1:x2]
                if face_crop.size > 0:
                    self.estimate_head_pose(face_crop)
                
                # 106点
                self.get_landmarks_106(dummy_image, bbox)
                
                # 特征提取
                self.extract_face_embedding(dummy_image, face)
        
        logger.info("Warmup complete")
    
    @property
    def is_loaded(self) -> bool:
        """模型是否已加载"""
        return self._models_loaded
    
    def release(self) -> None:
        """释放模型资源"""
        self.detector = None
        self.recognizer = None
        self.landmark_detector = None
        self.headpose_estimator = None
        self._models_loaded = False
        logger.info("Model resources released")
