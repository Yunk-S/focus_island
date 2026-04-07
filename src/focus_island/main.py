"""
Focus Island 主程序

支持桌面客户端模式、摄像头模式和服务器模式的多功能人脸识别专注检测后端。

Author: SSP Team
"""

import argparse
import logging
import sys
import cv2


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="Focus Island - 专注检测后端",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--mode", type=str, default="camera",
                       choices=["camera", "server", "desktop"],
                       help="运行模式: camera=本地摄像头, server=服务器模式, desktop=桌面客户端模式")
    parser.add_argument("--camera", type=int, default=0, help="摄像头ID (默认0)")
    parser.add_argument("--fps", type=float, default=4.0, help="目标帧率 (默认4)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="服务器主机")
    parser.add_argument("--ws-port", type=int, default=8765, help="WebSocket端口")
    parser.add_argument("--api-port", type=int, default=8000, help="REST API端口")
    parser.add_argument("--cuda", action="store_true", default=True, help="使用CUDA")
    parser.add_argument("--log-level", type=str, default="INFO",
                       choices=["DEBUG", "INFO", "WARNING", "ERROR"],
                       help="日志级别")
    
    args = parser.parse_args()
    
    # 设置日志
    logging.getLogger().setLevel(getattr(logging, args.log_level.upper(), logging.INFO))
    
    if args.mode == "server":
        # 服务器模式 - 启动WebSocket + REST API服务器
        from focus_island.server import ServerMode
        import asyncio
        
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            stream=sys.stdout,
            force=True,
        )
        logger = logging.getLogger(__name__)
        
        server = ServerMode(
            host=args.host,
            ws_port=args.ws_port,
            api_port=args.api_port,
            camera_id=args.camera,
            use_cuda=args.cuda
        )
        
        async def run_server():
            if not await server.initialize():
                logger.error("Failed to initialize server")
                return 1
            
            await server.start_websocket_server()
            return 0
        
        try:
            exit_code = asyncio.run(run_server())
            sys.exit(exit_code)
        except KeyboardInterrupt:
            server.cleanup()
            sys.exit(0)
    
    elif args.mode == "desktop":
        # 桌面客户端模式 - 启动后端并打开桌面窗口
        from focus_island.server import ServerMode
        import asyncio
        import threading
        
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            stream=sys.stdout,
            force=True,
        )
        logger = logging.getLogger(__name__)
        
        server = ServerMode(
            host="127.0.0.1",
            ws_port=args.ws_port,
            api_port=args.api_port,
            camera_id=args.camera,
            use_cuda=args.cuda
        )
        
        async def run_server():
            if not await server.initialize():
                logger.error("Failed to initialize server")
                return 1
            
            logger.info("Backend server ready - waiting for frontend connection")
            await server.start_websocket_server()
            return 0
        
        # 在后台线程运行服务器
        server_thread = threading.Thread(target=lambda: asyncio.run(run_server()), daemon=True)
        server_thread.start()
        
        logger.info("Backend server started in background")
        logger.info("WebSocket: ws://127.0.0.1:%s", args.ws_port)
        logger.info("REST API: http://127.0.0.1:%s", args.api_port)
        logger.info("Press Ctrl+C to stop")
        
        try:
            while True:
                import time
                time.sleep(1)
        except KeyboardInterrupt:
            server.cleanup()
            sys.exit(0)
    
    else:
        # 摄像头模式 - 原始逻辑
        run_camera_mode(args)


def run_camera_mode(args):
    """运行摄像头模式"""
    logger = logging.getLogger(__name__)
    
    try:
        # 导入工作流
        from focus_island.workflow import FocusWorkFlow
        from focus_island.types import PipelineConfig
        
        # 创建配置
        config = PipelineConfig()
        
        # 创建工作流
        workflow = FocusWorkFlow(
            config=config,
            use_cuda=args.cuda,
            target_fps=args.fps,
            enable_visualization=True
        )
        
        # ===== 阶段一：初始化 =====
        logger.info("=" * 60)
        logger.info("Focus Island 启动中...")
        logger.info("=" * 60)
        
        system_info = workflow.initialize()
        logger.info(f"系统就绪 | GPU: {system_info.gpu_available}")
        
        # 打开摄像头
        cap = cv2.VideoCapture(args.camera)
        if not cap.isOpened():
            logger.error(f"无法打开摄像头 {args.camera}")
            sys.exit(1)
        
        logger.info(f"摄像头已打开 (ID: {args.camera})")
        logger.info("按 's' 开始专注会话 | 按 'q' 退出")
        
        session_started = False
        
        # ===== 主循环 =====
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            frame = cv2.flip(frame, 1)  # 镜像
            
            if not session_started:
                # 预览模式
                cv2.putText(frame, "按 'S' 开始专注", (200, 300),
                           cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
                cv2.putText(frame, "按 'Q' 退出", (200, 360),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                
                # 检测人脸预览
                if workflow.model_manager:
                    faces = workflow.model_manager.detect_faces(frame)
                    for face in faces:
                        x1, y1, x2, y2 = map(int, face.bbox[:4])
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(frame, f"检测到: {len(faces)} 张人脸", (10, 30),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                
                cv2.imshow("SSP - Smart Study Spot", frame)
                key = cv2.waitKey(1) & 0xFF
                
                if key == ord('q') or key == 27:
                    break
                elif key == ord('s'):
                    # ===== 开始专注会话 =====
                    # 新流程: 先验证人脸，再开始专注
                    
                    # 1. 检查用户是否已绑定人脸
                    has_bound = workflow.authenticator.has_bound_face("user_001")
                    
                    if not has_bound:
                        # 未绑定，先绑定人脸
                        logger.info("用户未绑定人脸，正在绑定...")
                        bind_result = workflow.bind_face(
                            image=frame,
                            user_id="user_001"
                        )
                        if not bind_result.get("success"):
                            logger.error(f"绑定人脸失败: {bind_result.get('error')}")
                            continue
                        logger.info(f"人脸绑定成功: {bind_result.get('message')}")
                    
                    # 2. 验证人脸
                    logger.info("验证人脸...")
                    verify_result = workflow.verify_face(
                        image=frame,
                        user_id="user_001"
                    )
                    
                    if not verify_result.get("is_verified"):
                        if not verify_result.get("is_bound"):
                            logger.error("用户未绑定人脸，请先绑定")
                        else:
                            logger.error(f"人脸验证失败: {verify_result.get('message')}")
                        continue
                    
                    logger.info("人脸验证成功！")
                    
                    # 3. 开始专注会话
                    focus_result = workflow.start_focus(
                        image=frame,
                        user_id="user_001",
                        seat_id="desk_001"
                    )
                    
                    if focus_result.get("success"):
                        session_started = True
                        logger.info(f"专注会话开始! 会话ID: {focus_result['session_id']}")
                    else:
                        logger.error(f"启动失败: {focus_result.get('error')}")
            else:
                # ===== 专注会话模式 =====
                result = workflow.process_frame(frame)
                
                if result:
                    vis = workflow.visualize_frame(frame, result)
                    cv2.imshow("SSP - Smart Study Spot", vis)
                
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q') or key == 27:
                    # ===== 结束会话 =====
                    summary = workflow.end_session()
                    logger.info("=" * 60)
                    logger.info("专注会话结束")
                    logger.info(f"总积分: {summary.get('score_summary', {}).get('total_points', 0)}")
                    logger.info(f"专注时长: {summary.get('score_summary', {}).get('total_focus_time_min', 0):.2f} 分钟")
                    logger.info("=" * 60)
                    session_started = False
                elif key == ord('e'):
                    # 提前结束
                    workflow.end_session()
                    logger.info("会话已结束")
                    session_started = False
        
        # 清理
        cap.release()
        cv2.destroyAllWindows()
        workflow.release()
        logger.info("系统已退出")
        
    except KeyboardInterrupt:
        logger.info("被用户中断")
        sys.exit(0)
    except Exception as e:
        logger.exception(f"错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
