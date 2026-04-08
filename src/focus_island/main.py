"""
Focus Island Main Entry Point

Multi-mode face-recognition focus detection backend supporting
desktop client mode, camera mode, and server mode.

Author: SSP Team
"""

import argparse
import logging
import sys
import cv2


def main():
    """Main function"""
    parser = argparse.ArgumentParser(
        description="Focus Island - Focus Detection Backend",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--mode", type=str, default="camera",
                       choices=["camera", "server", "desktop"],
                       help="Run mode: camera=local camera, server=server mode, desktop=desktop client mode")
    parser.add_argument("--camera", type=int, default=0, help="Camera ID (default 0)")
    parser.add_argument("--fps", type=float, default=4.0, help="Target frame rate (default 4)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Server host")
    parser.add_argument("--ws-port", type=int, default=8765, help="WebSocket port")
    parser.add_argument("--api-port", type=int, default=8000, help="REST API port")
    parser.add_argument("--cuda", action="store_true", default=True, help="Use CUDA")
    parser.add_argument("--log-level", type=str, default="INFO",
                       choices=["DEBUG", "INFO", "WARNING", "ERROR"],
                       help="Log level")
    
    args = parser.parse_args()
    
    # Setup logging
    logging.getLogger().setLevel(getattr(logging, args.log_level.upper(), logging.INFO))
    
    if args.mode == "server":
        # Server mode - start WebSocket + REST API server
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
        # Desktop client mode - start backend and open desktop window
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
        
        # ===== Main loop =====
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            frame = cv2.flip(frame, 1)  # Mirror
            
            if not session_started:
                # Preview mode
                cv2.putText(frame, "Press 'S' to Start Focus", (200, 300),
                           cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
                cv2.putText(frame, "Press 'Q' to Quit", (200, 360),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                
                # Face detection preview
                if workflow.model_manager:
                    faces = workflow.model_manager.detect_faces(frame)
                    for face in faces:
                        x1, y1, x2, y2 = map(int, face.bbox[:4])
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(frame, f"Detected: {len(faces)} face(s)", (10, 30),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                
                cv2.imshow("SSP - Smart Study Spot", frame)
                key = cv2.waitKey(1) & 0xFF
                
                if key == ord('q') or key == 27:
                    break
                elif key == ord('s'):
                    # ===== Start focus session =====
                    # New flow: verify face first, then start focus
                    
                    # 1. Check if user has bound face
                    has_bound = workflow.authenticator.has_bound_face("user_001")
                    
                    if not has_bound:
                        # Not bound, bind face first
                        logger.info("User has not bound face, binding...")
                        bind_result = workflow.bind_face(
                            image=frame,
                            user_id="user_001"
                        )
                        if not bind_result.get("success"):
                            logger.error(f"Failed to bind face: {bind_result.get('error')}")
                            continue
                        logger.info(f"Face bound successfully: {bind_result.get('message')}")
                    
                    # 2. Verify face
                    logger.info("Verifying face...")
                    verify_result = workflow.verify_face(
                        image=frame,
                        user_id="user_001"
                    )
                    
                    if not verify_result.get("is_verified"):
                        if not verify_result.get("is_bound"):
                            logger.error("User has not bound face, please bind first")
                        else:
                            logger.error(f"Face verification failed: {verify_result.get('message')}")
                        continue
                    
                    logger.info("Face verified successfully!")
                    
                    # 3. Start focus session
                    focus_result = workflow.start_focus(
                        image=frame,
                        user_id="user_001",
                        seat_id="desk_001"
                    )
                    
                    if focus_result.get("success"):
                        session_started = True
                        logger.info(f"Focus session started! Session ID: {focus_result['session_id']}")
                    else:
                        logger.error(f"Start failed: {focus_result.get('error')}")
            else:
                # ===== Focus session mode =====
                result = workflow.process_frame(frame)
                
                if result:
                    vis = workflow.visualize_frame(frame, result)
                    cv2.imshow("SSP - Smart Study Spot", vis)
                
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q') or key == 27:
                    # ===== End session =====
                    summary = workflow.end_session()
                    logger.info("=" * 60)
                    logger.info("Focus session ended")
                    logger.info(f"Total points: {summary.get('score_summary', {}).get('total_points', 0)}")
                    logger.info(f"Focus duration: {summary.get('score_summary', {}).get('total_focus_time_min', 0):.2f} minutes")
                    logger.info("=" * 60)
                    session_started = False
                elif key == ord('e'):
                    # Early end
                    workflow.end_session()
                    logger.info("Session ended")
                    session_started = False
        
        # Cleanup
        cap.release()
        cv2.destroyAllWindows()
        workflow.release()
        logger.info("System exited")
        
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.exception(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
