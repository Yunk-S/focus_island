"""
主程序入口和命令行界面

提供 CLI 界面用于启动和管理专注检测服务。

Author: SSP Team
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import os
import yaml
from pathlib import Path
from typing import Optional

# 设置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_config(config_path: str) -> dict:
    """加载配置文件"""
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def setup_logging(level: str) -> None:
    """设置日志级别"""
    numeric_level = getattr(logging, level.upper(), None)
    if isinstance(numeric_level, int):
        logging.getLogger().setLevel(numeric_level)
    else:
        logging.getLogger().setLevel(logging.INFO)


class SSPBackendCLI:
    """SSP 后端命令行工具"""
    
    def __init__(self):
        self.pipeline = None
        self.ws_server = None
        self.api_server = None
        self.config = None
    
    def run_camera(
        self,
        camera_id: int = 0,
        config_path: Optional[str] = None,
        use_cuda: bool = True,
        detector_type: str = "retinaface",
        enable_vis: bool = True
    ) -> None:
        """运行摄像头模式"""
        from ssp_backend.pipeline import FocusPipeline
        from ssp_backend.types import PipelineConfig
        
        # 加载配置
        if config_path:
            config_data = load_config(config_path)
            config = PipelineConfig.from_dict(config_data)
        else:
            config = PipelineConfig()
        
        # 创建流水线
        pipeline = FocusPipeline(
            config=config,
            use_cuda=use_cuda,
            detector_type=detector_type,
            enable_visualization=enable_vis
        )
        
        # 预热
        pipeline.warmup()
        
        # 运行摄像头
        logger.info(f"Starting camera mode (camera_id={camera_id})")
        pipeline.process_camera(
            camera_id=camera_id,
            flip_horizontal=True,
            window_name="SSP - Smart Study Spot"
        )
    
    def run_video(
        self,
        video_path: str,
        output_path: Optional[str] = None,
        config_path: Optional[str] = None,
        use_cuda: bool = True,
        detector_type: str = "retinaface",
        enable_vis: bool = True
    ) -> None:
        """运行视频文件模式"""
        from ssp_backend.pipeline import FocusPipeline
        from ssp_backend.types import PipelineConfig
        
        if not os.path.exists(video_path):
            logger.error(f"Video file not found: {video_path}")
            return
        
        # 加载配置
        if config_path:
            config_data = load_config(config_path)
            config = PipelineConfig.from_dict(config_data)
        else:
            config = PipelineConfig()
        
        # 创建流水线
        pipeline = FocusPipeline(
            config=config,
            use_cuda=use_cuda,
            detector_type=detector_type,
            enable_visualization=enable_vis
        )
        
        # 预热
        pipeline.warmup()
        
        # 运行视频
        logger.info(f"Starting video mode (input={video_path}, output={output_path})")
        stats = pipeline.process_video(
            video_path=video_path,
            output_path=output_path,
            flip_horizontal=False
        )
        
        logger.info(f"Processing complete: {stats}")
    
    def run_server(
        self,
        config_path: Optional[str] = None,
        ws_port: int = 8765,
        api_port: int = 8000,
        use_cuda: bool = True,
        detector_type: str = "retinaface"
    ) -> None:
        """运行服务模式"""
        from ssp_backend.pipeline import FocusPipeline
        from ssp_backend.types import PipelineConfig
        from ssp_backend.websocket_server import WebSocketServer
        from ssp_backend.api_server import RESTAPIServer
        
        # 加载配置
        if config_path:
            config_data = load_config(config_path)
            config = PipelineConfig.from_dict(config_data)
        else:
            config = PipelineConfig()
        
        # 创建流水线
        pipeline = FocusPipeline(
            config=config,
            use_cuda=use_cuda,
            detector_type=detector_type,
            enable_visualization=False
        )
        
        # 预热
        pipeline.warmup()
        
        # 获取系统信息
        system_info = pipeline.get_system_info()
        logger.info(f"System info: {system_info.to_dict()}")
        
        # 启动 WebSocket 服务器
        ws_server = WebSocketServer(port=ws_port)
        
        # 启动 REST API 服务器
        try:
            api_server = RESTAPIServer(port=api_port)
            api_server.set_pipeline(pipeline)
            api_server.set_system_info(system_info)
        except ImportError as e:
            logger.warning(f"FastAPI not available: {e}")
            api_server = None
        
        # 设置流水线广播
        pipeline._ws_server = ws_server
        
        async def start_servers():
            """启动所有服务器"""
            await ws_server.start()
            logger.info(f"WebSocket server running on ws://0.0.0.0:{ws_port}")
            
            if api_server:
                import uvicorn
                config = uvicorn.Config(
                    api_server.app,
                    host="0.0.0.0",
                    port=api_port,
                    log_level="info"
                )
                server = uvicorn.Server(config)
                await server.serve()
        
        logger.info("Starting server mode...")
        logger.info(f"WebSocket: ws://0.0.0.0:{ws_port}")
        if api_server:
            logger.info(f"REST API: http://0.0.0.0:{api_port}")
        
        try:
            asyncio.run(start_servers())
        except KeyboardInterrupt:
            logger.info("Shutting down...")
    
    def test_models(self, use_cuda: bool = True) -> None:
        """测试模型加载"""
        from ssp_backend.detector import CoreDetector
        from ssp_backend.types import PipelineConfig
        
        logger.info("Testing model loading...")
        
        config = PipelineConfig()
        detector = CoreDetector(config=config, use_cuda=use_cuda)
        system_info = detector.get_system_info()
        
        logger.info(f"System info: {system_info.to_dict()}")
        
        # 创建测试图像
        import numpy as np
        import cv2
        
        test_image = np.zeros((480, 640, 3), dtype=np.uint8)
        
        # 预热
        logger.info("Warming up...")
        detector.warmup()
        
        # 测试检测
        logger.info("Testing detection...")
        result = detector.detect_face(test_image)
        
        if result is None:
            logger.info("Detection test passed (no face in blank image)")
        else:
            logger.info(f"Detection returned result: {result['confidence']}")
        
        logger.info("All tests completed successfully!")
    
    def visualize_landmarks(
        self,
        image_path: str,
        output_path: Optional[str] = None,
        use_cuda: bool = True
    ) -> None:
        """可视化面部关键点"""
        import cv2
        import numpy as np
        
        from ssp_backend.detector import CoreDetector
        from ssp_backend.ear import EYEIndexConfig, visualize_eye_points
        from ssp_backend.types import PipelineConfig
        
        # 加载图像
        image = cv2.imread(image_path)
        if image is None:
            logger.error(f"Failed to load image: {image_path}")
            return
        
        # 创建检测器
        config = PipelineConfig()
        detector = CoreDetector(config=config, use_cuda=use_cuda)
        
        # 检测人脸
        logger.info("Detecting face...")
        result = detector.detect_face(image)
        
        if result is None:
            logger.error("No face detected")
            return
        
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
            if i % 10 == 0:
                cv2.putText(vis_image, str(i), (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
        
        # 绘制头部姿态信息
        hp = result["head_pose"]
        info = f"Pitch: {hp.pitch:.1f}, Yaw: {hp.yaw:.1f}, Roll: {hp.roll:.1f}"
        cv2.putText(vis_image, info, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        
        # 保存或显示
        if output_path:
            cv2.imwrite(output_path, vis_image)
            logger.info(f"Saved to {output_path}")
        
        cv2.imshow("Landmarks", vis_image)
        cv2.waitKey(0)
        cv2.destroyAllWindows()


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="SSP Backend - Smart Study Spot 多功能人脸识别专注检测后端",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 摄像头模式
  python -m ssp_backend.main --mode camera --camera-id 0

  # 视频文件模式
  python -m ssp_backend.main --mode video --input video.mp4 --output result.mp4

  # 服务器模式
  python -m ssp_backend.main --mode server --ws-port 8765 --api-port 8000

  # 测试模型
  python -m ssp_backend.main --mode test

  # 可视化关键点
  python -m ssp_backend.main --mode visualize --input photo.jpg --output vis.jpg
"""
    )
    
    # 通用参数
    parser.add_argument(
        "--mode",
        type=str,
        choices=["camera", "video", "server", "test", "visualize"],
        default="camera",
        help="运行模式"
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="配置文件路径"
    )
    parser.add_argument(
        "--cuda",
        action="store_true",
        default=True,
        help="使用 CUDA (GPU)"
    )
    parser.add_argument(
        "--no-cuda",
        action="store_true",
        help="不使用 CUDA (仅 CPU)"
    )
    parser.add_argument(
        "--detector",
        type=str,
        choices=["retinaface", "scrfd"],
        default="retinaface",
        help="人脸检测器类型"
    )
    parser.add_argument(
        "--log-level",
        type=str,
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
        help="日志级别"
    )
    
    # 摄像头模式参数
    parser.add_argument(
        "--camera-id",
        type=int,
        default=0,
        help="摄像头 ID"
    )
    parser.add_argument(
        "--no-vis",
        action="store_true",
        help="禁用可视化"
    )
    
    # 视频模式参数
    parser.add_argument(
        "--input",
        type=str,
        help="输入视频文件路径"
    )
    parser.add_argument(
        "--output",
        type=str,
        help="输出视频文件路径"
    )
    
    # 服务器模式参数
    parser.add_argument(
        "--ws-port",
        type=int,
        default=8765,
        help="WebSocket 端口"
    )
    parser.add_argument(
        "--api-port",
        type=int,
        default=8000,
        help="REST API 端口"
    )
    
    args = parser.parse_args()
    
    # 设置日志
    setup_logging(args.log_level)
    
    # 创建 CLI
    cli = SSPBackendCLI()
    
    # 确定是否使用 CUDA
    use_cuda = not args.no_cuda
    
    try:
        if args.mode == "camera":
            cli.run_camera(
                camera_id=args.camera_id,
                config_path=args.config,
                use_cuda=use_cuda,
                detector_type=args.detector,
                enable_vis=not args.no_vis
            )
            
        elif args.mode == "video":
            if not args.input:
                parser.error("--input is required for video mode")
            cli.run_video(
                video_path=args.input,
                output_path=args.output,
                config_path=args.config,
                use_cuda=use_cuda,
                detector_type=args.detector,
                enable_vis=not args.no_vis
            )
            
        elif args.mode == "server":
            cli.run_server(
                config_path=args.config,
                ws_port=args.ws_port,
                api_port=args.api_port,
                use_cuda=use_cuda,
                detector_type=args.detector
            )
            
        elif args.mode == "test":
            cli.test_models(use_cuda=use_cuda)
            
        elif args.mode == "visualize":
            if not args.input:
                parser.error("--input is required for visualize mode")
            cli.visualize_landmarks(
                image_path=args.input,
                output_path=args.output,
                use_cuda=use_cuda
            )
            
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.exception(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
