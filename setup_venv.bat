@echo off
setlocal
cd /d "%~dp0." || (echo [ERROR] Cannot cd to script folder. & pause & exit /b 1)

echo Creating venv in: %CD%\.venv
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] python not in PATH. Install Python 3.10+ and retry.
    pause
    exit /b 1
)

python -m venv .venv
if errorlevel 1 (
    echo [ERROR] python -m venv failed.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] pip install failed.
    pause
    exit /b 1
)

echo.
echo [OK] Virtual env ready. Run start.bat
pause
