@echo off
setlocal
REM Safe cd: trailing backslash before quote breaks cmd. "%~dp0." avoids that.
cd /d "%~dp0." || (
    echo [ERROR] Cannot change to folder containing this script.
    pause
    exit /b 1
)

echo ========================================
echo   Focus Island
echo   Root: %CD%
echo ========================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Python venv not found:
    echo   %CD%\.venv\Scripts\python.exe
    echo.
    echo Run once: setup_venv.bat
    echo   or: python -m venv .venv
    echo        .venv\Scripts\activate
    echo        pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)
echo [1/3] Backend venv: OK

if not exist "frontend\node_modules" (
    echo [2/3] Installing frontend dependencies...
    pushd frontend
    call npm install
    if errorlevel 1 (
        popd
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    popd
) else (
    echo [2/3] Frontend node_modules: OK
)

echo [3/3] Starting backend, room server, frontend...
echo.
echo   Order: Backend -^> Room signaling -^> Frontend
echo   Live mode / 主持房间 needs BOTH backend AND room server (port 8766).
echo.

REM Launch separate .cmd files from script/ folder
set "_ROOT=%~dp0"
start "FocusIsland-Backend" cmd.exe /k call "%_ROOT%script\backend_server.cmd"
REM Give Python time to bind API/WS before starting the next service
timeout /t 3 /nobreak >nul
start "FocusIsland-Room" cmd.exe /k call "%_ROOT%script\room_server.cmd"
REM Room server must be listening before opening the app (live WebRTC signaling)
timeout /t 4 /nobreak >nul
start "FocusIsland-Frontend" cmd.exe /k call "%_ROOT%script\frontend_dev.cmd"

echo Opened 3 windows: Backend, Room, Frontend.
echo.
echo   API (REST)     http://127.0.0.1:8000
echo   Backend WS     ws://127.0.0.1:8765   (focus / frames)
echo   Room signaling ws://127.0.0.1:8766   (REQUIRED for 直播 / 主持房间)
echo.
echo If "Failed to connect to signaling server": check FocusIsland-Room window
echo for Python errors; ensure port 8766 is not used by another program.
echo ========================================
pause
