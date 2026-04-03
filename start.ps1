# Focus Island - start backend, room signaling, frontend (same behavior as start.bat)
# Usage: right-click -> Run with PowerShell

param(
    [switch]$BackendOnly,
    [switch]$RoomOnly,
    [switch]$FrontendOnly
)

$ErrorActionPreference = "Stop"

$here = $PSScriptRoot
if (-not $here) {
    Write-Host "[ERROR] PSScriptRoot is empty. Run this script from its saved location." -ForegroundColor Red
    exit 1
}

$FrontendDir = Join-Path $here "frontend"

function Write-ColorOutput {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
}

Write-ColorOutput "========================================" "Cyan"
Write-ColorOutput "  Focus Island" "Cyan"
Write-ColorOutput "  Root: $here" "Cyan"
Write-ColorOutput "========================================" "Cyan"
Write-ColorOutput ""

$venvPy = Join-Path $here ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-ColorOutput "[ERROR] Python venv not found. Run setup_venv.bat once, or:" "Red"
    Write-ColorOutput "  cd `"$here`"" "Yellow"
    Write-ColorOutput "  python -m venv .venv" "Yellow"
    Write-ColorOutput "  .\.venv\Scripts\pip install -r requirements.txt" "Yellow"
    exit 1
}

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-ColorOutput "[WARNING] Installing frontend dependencies..." "Yellow"
    Push-Location $FrontendDir
    try {
        & npm install
    } finally {
        Pop-Location
    }
}

Write-ColorOutput "[OK] Backend venv and frontend deps" "Green"
Write-ColorOutput ""
Write-ColorOutput "  Backend API/WS:  http://127.0.0.1:8000  ws://127.0.0.1:8765" "DarkGray"
Write-ColorOutput "  Room signaling:  ws://127.0.0.1:8766/ws/room" "DarkGray"
Write-ColorOutput "  Frontend:        http://127.0.0.1:5173 (Electron)" "DarkGray"
Write-ColorOutput ""

$backendCmd = Join-Path $here "backend_server.cmd"
$roomCmd = Join-Path $here "room_server.cmd"
$frontendCmd = Join-Path $here "frontend_dev.cmd"

if ($BackendOnly) {
    Write-ColorOutput ">>> Backend only" "Cyan"
    Set-Location $here
    $env:PYTHONPATH = Join-Path $here "src"
    & $venvPy -m focus_island.main --mode server --ws-port 8765 --api-port 8000
    return
}
if ($RoomOnly) {
    Write-ColorOutput ">>> Room server only" "Cyan"
    Set-Location $here
    $env:PYTHONPATH = Join-Path $here "src"
    & $venvPy -m focus_island.room_server --port 8766
    return
}
if ($FrontendOnly) {
    Write-ColorOutput ">>> Frontend only" "Cyan"
    Set-Location $FrontendDir
    & npm run electron:dev
    return
}

Write-ColorOutput "Launching windows (same .cmd as start.bat)..." "Green"
Start-Process cmd.exe -ArgumentList @('/k', "`"$backendCmd`"")
Start-Sleep -Seconds 2
Start-Process cmd.exe -ArgumentList @('/k', "`"$roomCmd`"")
Start-Sleep -Seconds 2
Start-Process cmd.exe -ArgumentList @('/k', "`"$frontendCmd`"")

Write-ColorOutput ""
Write-ColorOutput "Started. Close each window to stop that service." "Green"
Write-ColorOutput "========================================" "Cyan"
pause
