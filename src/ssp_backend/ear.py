"""
EAR (Eye Aspect Ratio) 眼部状态检测模块

使用 106 点面部关键点计算眼睛纵横比，判断眼睛是否睁开。

Author: SSP Team
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from .types import EyeData, PipelineConfig


logger = logging.getLogger(__name__)


class EYEIndexConfig:
    """眼部关键点索引配置
    
    基于 UniFace 的 106 点 landmarks 索引定义：
    - 左眼: indices[63-71] = 9个点，但通常使用6个特征点
    - 右眼: indices[72-80] = 9个点，但通常使用6个特征点
    
    EAR 计算使用 6 个关键点:
    - 左眼: [35, 36, 37, 38, 39, 40] 或使用 [63, 64, 65, 66, 67, 68]
    - 右眼: [41, 42, 43, 44, 45, 46] 或使用 [72, 73, 74, 75, 76, 77]
    
    标准 6 点配置 (推荐):
    - 左眼外角 -> 眼角1 -> 瞳孔上 -> 瞳孔下 -> 眼角2 -> 左眼外角
    - 点位: P1, P2, P3, P4, P5, P6
    
    示意图:
         P2---P3
        /     /
    P1 -       - P6
        /     /
         P5---P4
    """
    
    # 默认的 6 点索引 (使用 UniFace 106点的连续区间)
    # 左眼: 63, 64, 65, 66, 67, 68 (连续的6个点)
    # 右眼: 72, 73, 74, 75, 76, 77 (连续的6个点)
    DEFAULT_LEFT_EYE = [63, 64, 65, 66, 67, 68]
    DEFAULT_RIGHT_EYE = [72, 73, 74, 75, 76, 77]
    
    # Alternative 6-point configurations for different landmark sets
    # 基于 dlib 68 点的标准配置 (仅供参考)
    DLIB_LEFT_EYE = [36, 37, 38, 39, 40, 41]  # 假设使用68点
    DLIB_RIGHT_EYE = [42, 43, 44, 45, 46, 47]  # 假设使用68点


class EARCalculator:
    """EAR (Eye Aspect Ratio) 计算器
    
    EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
    
    其中:
    - p1, p4 是眼睛的左右角点
    - p2, p3 是眼睛的上部点
    - p5, p6 是眼睛的下部点
    """
    
    def __init__(
        self,
        config: PipelineConfig,
        left_eye_indices: Optional[list[int]] = None,
        right_eye_indices: Optional[list[int]] = None
    ):
        """
        初始化 EAR 计算器
        
        Args:
            config: 流水线配置
            left_eye_indices: 左眼 6 个关键点索引
            right_eye_indices: 右眼 6 个关键点索引
        """
        self.ear_threshold = config.ear_threshold
        self.consecutive_threshold = config.consecutive_eye_closed_threshold
        
        # 眼部关键点索引
        self.left_eye_indices = left_eye_indices or config.left_eye_indices or EYEIndexConfig.DEFAULT_LEFT_EYE
        self.right_eye_indices = right_eye_indices or config.right_eye_indices or EYEIndexConfig.DEFAULT_RIGHT_EYE
        
        # 连续闭眼计数
        self._consecutive_closed_frames = 0
        
        logger.info(
            f"EARCalculator initialized with threshold={self.ear_threshold}, "
            f"consecutive_threshold={self.consecutive_threshold}"
        )
        logger.info(f"Left eye indices: {self.left_eye_indices}")
        logger.info(f"Right eye indices: {self.right_eye_indices}")
    
    def calculate_ear(self, eye_points: np.ndarray) -> float:
        """
        计算单只眼的 EAR 值
        
        Args:
            eye_points: 6 个关键点坐标，形状 (6, 2)，顺序为:
                [p1, p2, p3, p4, p5, p6] - 按顺时针或逆时针排列
                
        Returns:
            EAR 值
        """
        if eye_points.shape != (6, 2):
            logger.warning(f"Invalid eye points shape: {eye_points.shape}, expected (6, 2)")
            return 0.0
        
        # 计算垂直距离
        # |p2 - p6| 和 |p3 - p5|
        v1 = np.linalg.norm(eye_points[1] - eye_points[5])
        v2 = np.linalg.norm(eye_points[2] - eye_points[4])
        
        # 计算水平距离
        # |p1 - p4|
        h = np.linalg.norm(eye_points[0] - eye_points[3])
        
        # 避免除零
        if h < 1e-6:
            return 0.0
        
        ear = (v1 + v2) / (2.0 * h)
        
        return float(ear)
    
    def extract_eye_points(self, landmarks_106: np.ndarray, eye_indices: list[int]) -> np.ndarray:
        """
        从 106 点 landmarks 中提取眼睛关键点
        
        Args:
            landmarks_106: 106 点 landmarks，形状 (106, 2)
            eye_indices: 6 个关键点索引列表
            
        Returns:
            6 个关键点坐标，形状 (6, 2)
        """
        if len(eye_indices) != 6:
            raise ValueError(f"Expected 6 eye indices, got {len(eye_indices)}")
        
        # 确保索引在有效范围内
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
        计算双眼状态
        
        Args:
            landmarks_106: 106 点 landmarks
            reset_counter: 是否重置连续闭眼计数器
            
        Returns:
            (ear_left, ear_right, is_open)
            - ear_left: 左眼 EAR 值
            - ear_right: 右眼 EAR 值
            - is_open: 双眼是否睁开
        """
        if reset_counter:
            self._consecutive_closed_frames = 0
        
        try:
            # 提取双眼关键点
            left_eye = self.extract_eye_points(landmarks_106, self.left_eye_indices)
            right_eye = self.extract_eye_points(landmarks_106, self.right_eye_indices)
            
            # 计算 EAR
            ear_left = self.calculate_ear(left_eye)
            ear_right = self.calculate_ear(right_eye)
            
            # 判断眼睛是否睁开
            # 使用平均值或较小值 (更严格的判断)
            ear_avg = (ear_left + ear_right) / 2
            ear_min = min(ear_left, ear_right)
            
            is_open = ear_avg >= self.ear_threshold
            
            # 更新连续闭眼计数
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
        获取完整的眼部状态数据
        
        Args:
            landmarks_106: 106 点 landmarks
            
        Returns:
            EyeData 对象
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
        检查眼睛是否持续闭合超过阈值
        
        Returns:
            True 如果连续闭眼帧数超过阈值
        """
        return self._consecutive_closed_frames >= self.consecutive_threshold
    
    def reset(self) -> None:
        """重置状态"""
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
    在图像上可视化眼部关键点
    
    Args:
        image: 输入图像
        landmarks_106: 106 点 landmarks
        left_eye_indices: 左眼索引
        right_eye_indices: 右眼索引
        color: 绘制颜色
        radius: 点的半径
        
    Returns:
        绘制了关键点的图像
    """
    import cv2
    
    vis_image = image.copy()
    
    # 绘制左眼
    for idx in left_eye_indices:
        x, y = map(int, landmarks_106[idx])
        cv2.circle(vis_image, (x, y), radius, color, -1)
    
    # 绘制右眼
    for idx in right_eye_indices:
        x, y = map(int, landmarks_106[idx])
        cv2.circle(vis_image, (x, y), radius, color, -1)
    
    # 连接双眼的点
    left_eye_pts = landmarks_106[left_eye_indices].astype(int)
    right_eye_pts = landmarks_106[right_eye_indices].astype(int)
    
    # 绘制左眼轮廓
    for i in range(len(left_eye_pts) - 1):
        cv2.line(vis_image, tuple(left_eye_pts[i]), tuple(left_eye_pts[i + 1]), color, 1)
    cv2.line(vis_image, tuple(left_eye_pts[-1]), tuple(left_eye_pts[0]), color, 1)
    
    # 绘制右眼轮廓
    for i in range(len(right_eye_pts) - 1):
        cv2.line(vis_image, tuple(right_eye_pts[i]), tuple(right_eye_pts[i + 1]), color, 1)
    cv2.line(vis_image, tuple(right_eye_pts[-1]), tuple(right_eye_pts[0]), color, 1)
    
    return vis_image
