@echo off
REM ASCII-only: avoids GBK cmd mis-reading UTF-8 BOM in REM lines.
cd /d "%~dp0." || (
    echo [ERROR] Cannot cd to project folder.
    pause
    exit /b 1
)
python start.py
pause
