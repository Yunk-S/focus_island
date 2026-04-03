@echo off
REM SSP Backend 快速启动脚本
REM Smart Study Spot - 多功能人脸识别专注检测后端

echo ========================================
echo SSP Backend 快速启动
echo ========================================
echo.

cd /d "%~dp0"

echo [1] 检查 Python 环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到 Python，请先安装 Python 3.10+
    pause
    exit /b 1
)

echo [2] 检查依赖...
pip show uniface >nul 2>&1
if errorlevel 1 (
    echo.
    echo 首次运行，需要安装依赖...
    echo.
    pip install -r requirements.txt
    if errorlevel 1 (
        echo 错误: 依赖安装失败
        pause
        exit /b 1
    )
)

echo [3] 检查 GPU 支持...
python -c "import onnxruntime; print('ONNX Runtime providers:', onnxruntime.get_available_providers())" 2>nul

echo.
echo ========================================
echo 请选择运行模式:
echo ========================================
echo.
echo [1] 摄像头模式 - 使用默认摄像头
echo [2] 摄像头模式 - 使用第二个摄像头
echo [3] 视频文件模式 - 需要指定文件
echo [4] 服务器模式 - 启动 WebSocket + REST API
echo [5] 测试模式 - 验证模型加载
echo [6] 关键点可视化 - 需要指定图片
echo [0] 退出
echo.
set /p choice=请输入选项 (0-6):

if "%choice%"=="1" goto camera0
if "%choice%"=="2" goto camera1
if "%choice%"=="3" goto video
if "%choice%"=="4" goto server
if "%choice%"=="5" goto test
if "%choice%"=="6" goto visualize
if "%choice%"=="0" goto end

:camera0
echo.
echo 启动摄像头模式 (camera_id=0)...
echo 按 'q' 键退出
echo.
python -m ssp_backend.main --mode camera --camera-id 0 --cuda
goto end

:camera1
echo.
echo 启动摄像头模式 (camera_id=1)...
echo 按 'q' 键退出
echo.
python -m ssp_backend.main --mode camera --camera-id 1 --cuda
goto end

:video
echo.
set /p video_path=请输入视频文件路径:
if "%video_path%"=="" (
    echo 错误: 未指定视频文件
    goto end
)
echo.
echo 处理视频: %video_path%
echo.
set /p output_path=输出文件路径 (留空跳过):
if not "%output_path%"=="" (
    set OUTPUT_FLAG=--output "%output_path%"
)
python -m ssp_backend.main --mode video --input "%video_path%" %OUTPUT_FLAG% --cuda
goto end

:server
echo.
echo 启动服务器模式...
echo WebSocket: ws://localhost:8765
echo REST API: http://localhost:8000
echo.
echo 按 Ctrl+C 停止服务器
echo.
python -m ssp_backend.main --mode server --ws-port 8765 --api-port 8000 --cuda
goto end

:test
echo.
echo 运行测试...
echo.
python -m ssp_backend.main --mode test --cuda
echo.
pause
goto quick_start

:visualize
echo.
set /p image_path=请输入图片文件路径:
if "%image_path%"=="" (
    echo 错误: 未指定图片文件
    goto end
)
echo.
echo 可视化关键点: %image_path%
echo.
python -m ssp_backend.main --mode visualize --input "%image_path%" --cuda
goto end

:end
echo.
echo ========================================
echo 程序已退出
echo ========================================
pause
