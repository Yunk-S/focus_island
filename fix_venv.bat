@echo off
setlocal
cd /d "%~dp0." || exit /b 1
if not exist ".venv\Scripts\python.exe" (
    echo [.venv missing] Run setup_venv.bat first.
    pause
    exit /b 1
)

echo.
echo Repairing venv: remove broken editable uniface / old ssp_backend path hooks, reinstall uniface from PyPI.
echo.

REM Stale .pth from renamed project or pip -e from wrong folder
for %%F in (
    ".venv\Lib\site-packages\__editable__.ssp_backend-1.0.0.pth"
    ".venv\Lib\site-packages\__editable__.uniface-3.3.0.pth"
    ".venv\Lib\site-packages\__editable___uniface_3_3_0_finder.py"
) do if exist %%~F (
    echo Removing stale: %%~F
    del /f /q %%~F
)

call .venv\Scripts\activate.bat
python -m pip install --force-reinstall "uniface>=3.0.0,<4"
if errorlevel 1 (
    echo [ERROR] pip install uniface failed.
    pause
    exit /b 1
)

python -m pip install -e .
if errorlevel 1 (
    echo [WARN] pip install -e . failed; run with PYTHONPATH=src via start.bat
)

echo.
python -c "import uniface; from uniface.detection import RetinaFace; print('[OK] uniface import works')"
if errorlevel 1 (
    echo [ERROR] Import check failed.
    pause
    exit /b 1
)

echo.
echo [OK] Run start.bat again.
pause
