@echo off
REM Single entry-point — launches the Python launcher.
REM Requirements:
REM   • Python 3.10+ in PATH  (or .venv with python.exe)
REM   • Node.js 18+ in PATH
REM   • Windows 10/11
cd /d "%~dp0." || (
    echo [ERROR] Cannot change to folder containing this script.
    pause
    exit /b 1
)
python start.py
pause
