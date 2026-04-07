"""
示例代码

展示如何使用 Focus Island 的各种功能。

Author: SSP Team
"""

import cv2
import numpy as np

from focus_island.types import PipelineConfig
from focus_island.pipeline import FocusPipeline
from focus_island.detector import CoreDetector
from focus_island.ear import EARCalculator, EYEIndexConfig, visualize_eye_points


def example_basic_usage():
    """基本用法示例"""
    print("=" * 50)
    print("Example 1: Basic Usage")
    print("=" * 50)
    
    # 创建配置
    config = PipelineConfig()
    
    # 创建流水线
    pipeline = FocusPipeline(
        config=config,
        use_cuda=True,
        enable_visualization=True
    )
    
    # 预热
    pipeline.warmup()
    
    # 处理单张图片
    image = cv2.imread("test.jpg")
    if image is not None:
        result = pipeline.process_frame(image)
        print(f"Result: {result}")
    
    print()


def example_camera_mode():
    """摄像头模式示例"""
    print("=" * 50)
    print("Example 2: Camera Mode")
    print("=" * 50)
    
    config = PipelineConfig()
    
    pipeline = FocusPipeline(
        config=config,
        use_cuda=True,
        enable_visualization=True
    )
    
    pipeline.warmup()
    
    # 打开摄像头
    pipeline.process_camera(
        camera_id=0,
        flip_horizontal=True,
        window_name="Focus Detection Demo"
    )
    
    print()


def example_video_processing():
    """视频处理示例"""
    print("=" * 50)
    print("Example 3: Video Processing")
    print("=" * 50)
    
    config = PipelineConfig()
    
    pipeline = FocusPipeline(
        config=config,
        use_cuda=True,
        enable_visualization=True
    )
    
    pipeline.warmup()
    
    # 处理视频
    stats = pipeline.process_video(
        video_path="input_video.mp4",
        output_path="output_video.mp4"
    )
    
    print(f"Processing complete: {stats}")
    print()


def example_custom_config():
    """自定义配置示例"""
    print("=" * 50)
    print("Example 4: Custom Configuration")
    print("=" * 50)
    
    # 自定义配置
    config = PipelineConfig(
        pitch_threshold=15.0,      # 更严格的俯仰角阈值
        yaw_threshold=20.0,        # 更严格的偏航角阈值
        ear_threshold=0.20,       # 更严格的 EAR 阈值
        grace_period_seconds=3.0  # 更短的宽容时间
    )
    
    pipeline = FocusPipeline(
        config=config,
        use_cuda=True,
        enable_visualization=True
    )
    
    pipeline.warmup()
    
    print(f"Custom config: pitch<{config.pitch_threshold}°, yaw<{config.yaw_threshold}°, EAR>{config.ear_threshold}")
    print()
    
    # 可以动态更新配置
    pipeline.update_config({
        "pitch_threshold": 25.0,
        "ear_threshold": 0.15
    })
    
    print(f"Updated config: pitch<{pipeline.config.pitch_threshold}°, EAR>{pipeline.config.ear_threshold}")
    print()


def example_landmark_visualization():
    """关键点可视化示例"""
    print("=" * 50)
    print("Example 5: Landmark Visualization")
    print("=" * 50)
    
    # 创建检测器
    config = PipelineConfig()
    detector = CoreDetector(config=config, use_cuda=True)
    
    # 加载图片
    image = cv2.imread("test_face.jpg")
    if image is None:
        print("No test image found, skipping...")
        return
    
    # 检测人脸
    result = detector.detect_face(image)
    
    if result is not None:
        # 可视化眼部关键点
        vis_image = visualize_eye_points(
            image,
            result["landmarks_106"],
            EYEIndexConfig.DEFAULT_LEFT_EYE,
            EYEIndexConfig.DEFAULT_RIGHT_EYE,
            color=(0, 255, 0)
        )
        
        # 绘制所有 106 点
        for i, (x, y) in enumerate(result["landmarks_106"].astype(int)):
            color = (0, 0, 255) if i < 63 else (255, 0, 0) if i < 72 else (0, 255, 255)
            cv2.circle(vis_image, (x, y), 2, color, -1)
        
        # 显示结果
        cv2.imshow("Landmarks", vis_image)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    
    print()


def example_session_management():
    """会话管理示例"""
    print("=" * 50)
    print("Example 6: Session Management")
    print("=" * 50)
    
    config = PipelineConfig()
    
    pipeline = FocusPipeline(
        config=config,
        use_cuda=True,
        enable_visualization=False
    )
    
    pipeline.warmup()
    
    # 获取会话摘要
    summary = pipeline.get_session_summary()
    print(f"Session ID: {summary['session_id']}")
    print(f"Start time: {summary['start_time']}")
    print(f"Current state: {summary['current_state']}")
    print()
    
    # 处理几帧
    for i in range(100):
        # 模拟处理 (使用空白帧或读取视频帧)
        dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        result = pipeline.process_frame(dummy_frame)
        
        if i % 20 == 0:
            print(f"Frame {i}: State={result['state']}, Points={result['stats']['total_points']}")
    
    # 获取更新后的摘要
    final_summary = pipeline.get_session_summary()
    print()
    print("Final Summary:")
    print(f"  Total points: {final_summary['score_summary']['total_points']}")
    print(f"  Focus time: {final_summary['score_summary']['total_focus_time_min']:.2f} min")
    print(f"  Interruptions: {final_summary['fsm_stats']['interruption_count']}")
    print()
    
    # 重置会话
    pipeline.reset_session()
    print("Session reset!")
    print()


def example_system_info():
    """系统信息示例"""
    print("=" * 50)
    print("Example 7: System Information")
    print("=" * 50)
    
    config = PipelineConfig()
    
    pipeline = FocusPipeline(
        config=config,
        use_cuda=True,
        enable_visualization=False
    )
    
    system_info = pipeline.get_system_info()
    
    print("System Information:")
    print(f"  GPU Available: {system_info.gpu_available}")
    print(f"  GPU Name: {system_info.gpu_name}")
    print(f"  ONNX Providers: {system_info.onnx_providers}")
    print()


def example_ear_calculation():
    """EAR 计算示例"""
    print("=" * 50)
    print("Example 8: EAR Calculation")
    print("=" * 50)
    
    # 创建配置和计算器
    config = PipelineConfig()
    ear_calc = EARCalculator(config)
    
    # 创建模拟的眼部关键点
    # 睁眼状态
    open_eye = np.array([
        [100, 110],  # P1: 左角
        [110, 105],  # P2: 上部1
        [120, 105],  # P3: 上部2
        [130, 110],  # P4: 右角
        [120, 115],  # P5: 下部2
        [110, 115],  # P6: 下部1
    ], dtype=np.float32)
    
    # 闭眼状态
    closed_eye = np.array([
        [100, 110],
        [110, 110],  # 上部向下移动
        [120, 110],
        [130, 110],
        [120, 110],  # 下部向上移动
        [110, 110],
    ], dtype=np.float32)
    
    # 计算 EAR
    ear_open = ear_calc.calculate_ear(open_eye)
    ear_closed = ear_calc.calculate_ear(closed_eye)
    
    print(f"Open eye EAR: {ear_open:.4f}")
    print(f"Closed eye EAR: {ear_closed:.4f}")
    print(f"Threshold: {ear_calc.ear_threshold}")
    print()
    print(f"Open eye detected as: {'Open' if ear_open >= ear_calc.ear_threshold else 'Closed'}")
    print(f"Closed eye detected as: {'Open' if ear_closed >= ear_calc.ear_threshold else 'Closed'}")
    print()


def main():
    """运行所有示例"""
    print("\n" + "=" * 60)
    print("SSP Backend Examples")
    print("=" * 60 + "\n")
    
    # 运行各个示例
    example_system_info()
    
    # 以下示例需要实际硬件/图像
    # example_basic_usage()
    # example_camera_mode()
    # example_video_processing()
    # example_custom_config()
    # example_landmark_visualization()
    # example_session_management()
    # example_ear_calculation()
    
    print("Examples complete!")


if __name__ == "__main__":
    main()
