@echo off
setlocal
REM Script is in script/ folder, need to go up one level to project root
cd /d "%~dp0.." || (echo [ERROR] Cannot cd to project root. & pause & exit /b 1)

if not exist "frontend\package.json" (
    echo [ERROR] frontend\package.json not found.
    pause
    exit /b 1
)

cd frontend || (echo [ERROR] Cannot cd to frontend. & pause & exit /b 1)
echo [Frontend] Vite + Electron  (expects backend on :8000 and WS :8765^)
call npm run electron:dev
echo.
echo [Frontend] Process exited.
pause
