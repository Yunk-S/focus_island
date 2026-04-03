@echo off
setlocal
cd /d "%~dp0." || (echo [ERROR] Cannot cd to project root. & pause & exit /b 1)

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Missing .venv
    pause
    exit /b 1
)

set "PYTHONPATH=%CD%\src"
call .venv\Scripts\activate.bat
echo [Room] WebRTC signaling ws://127.0.0.1:8766/ws/room
python -m focus_island.room_server --port 8766
echo.
pause
