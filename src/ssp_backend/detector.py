"""
核心检测模块

封装 UniFace 的人脸检测、头部姿态估计和关键点检测功能。

Author: SSP Team
"""

from __future__ import annotations

import time
import logging
from typing import Optional

import cv2
import numpy as np

from uniface.detection import RetinaFace, SCRFD
from uniface.headpose import HeadPose, HeadPoseResult
from uniface.landmark import Landmark106

from .types import HeadPoseData, PipelineConfig, SystemInfo


logger = logging.getLogger(__name__)


class CoreDetector:
    """核心检测器 - 封装 UniFace 模型"""
    
    def __init__(
        self,
        config: PipelineConfig,
        use_cuda: bool = True,
        detector_type: str = "retinaface"
    ):
        """
        初始化核心检测器
        
        Args:
            config: 流水线配置
            use_cuda: 是否使用 CUDA
            detector_type: 检测器类型 ("retinaface", "scrfd")
        """
        self.config = config
        self.use_cuda = use_cuda
        self.detector_type = detector_type
        
        # ONNX Runtime 执行提供者
        if use_cuda:
            self.providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        else:
            self.providers = ["CPUExecutionProvider"]
        
        # 初始化模型
        self._init_models()
        
        logger.info(f"CoreDetector initialized with {detector_type}, CUDA={use_cuda}")
    
    def _init_models(self) -> None:
        """初始化所有模型"""
        # 1. 人脸检测器
        logger.info("Loading face detector...")
        if self.detector_type == "scrfd":
            self.detector = SCRFD(providers=self.providers)
        else:
            self.detector = RetinaFace(providers=self.providers)
        
        # 2. 头部姿态估计器
        logger.info("Loading head pose estimator...")
        self.head_pose_estimator = HeadPose(providers=self.providers)
        
        # 3. 106点关键点检测器
        logger.info("Loading landmark detector...")
        self.landmark_detector = Landmark106(providers=self.providers)
        
        logger.info("All models loaded successfully")
    
    def detect_face(self, image: np.ndarray) -> Optional[dict]:
        """
        检测人脸并提取所有必要信息
        
        Args:
            image: 输入图像 (BGR格式)
            
        Returns:
            包含检测结果的字典，包含:
            - bbox: 人脸边界框
            - landmarks_5: 5点关键点
            - confidence: 置信度
            - face_crop: 人脸裁剪图
            - landmarks_106: 106点关键点
            - head_pose: 头部姿态数据
        """
        start_time = time.time()
        
        # 人脸检测
        faces = self.detector.detect(image)
        
        if not faces:
            return None
        
        # 取置信度最高的人脸
        face = faces[0]
        
        # 提取边界框
        bbox = face.bbox
        x1, y1, x2, y2 = map(int, bbox[:4])
        
        # 人脸裁剪
        face_crop = image[y1:y2, x1:x2]
        
        if face_crop.size == 0:
            return None
        
        # 头部姿态估计
        head_pose_result = self.head_pose_estimator.estimate(face_crop)
        head_pose_data = self._convert_head_pose(head_pose_result)
        
        # 106点关键点检测
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
        """转换头部姿态结果"""
        pitch, yaw, roll = result.pitch, result.yaw, result.roll
        
        # 检查是否在有效范围内
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
        
        return info
    
    def warmup(self, image_size: tuple = (640, 640)) -> None:
        """预热模型"""
        logger.info("Warming up models...")
        dummy_image = np.zeros((image_size[1], image_size[0], 3), dtype=np.uint8)
        
        # 运行几次推理
        for _ in range(3):
            self.detect_face(dummy_image)
        
        logger.info("Warmup complete")


class FaceDetectorLite:
    """轻量级人脸检测器 - 仅用于快速检测人脸是否存在"""
    
    def __init__(self, use_cuda: bool = True):
        """初始化轻量级检测器"""
        self.use_cuda = use_cuda
        self.providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if use_cuda else ["CPUExecutionProvider"]
        
        # 使用 RetinaFace (快速)
        self.detector = RetinaFace(providers=self.providers)
    
    def detect(self, image: np.ndarray) -> Optional[dict]:
        """快速检测人脸"""
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
        """预热"""
        dummy = np.zeros((640, 640, 3), dtype=np.uint8)
        for _ in range(3):
            self.detect(dummy)
