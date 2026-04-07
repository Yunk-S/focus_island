@echo off
setlocal
REM Script is in script/ folder, need to go up one level to project root
cd /d "%~dp0.." || (echo [ERROR] Cannot cd to project root. & pause & exit /b 1)

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Missing .venv\Scripts\python.exe
    echo Run from project root: python -m venv .venv
    echo Then: .venv\Scripts\activate ^&^& pip install -r requirements.txt
    pause
    exit /b 1
)

set "PYTHONPATH=%CD%\src"
call .venv\Scripts\activate.bat
echo [Backend] PYTHONPATH=%PYTHONPATH%
echo [Backend] REST http://127.0.0.1:8000  WS ws://127.0.0.1:8765
python -m focus_island.main --mode server --ws-port 8765 --api-port 8000
echo.
echo [Backend] Process exited.
pause
