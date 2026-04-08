"""
Focus Island — One-click launcher

Starts all three processes in parallel:
  1. Backend  (FastAPI + WebSocket)  — REST http://127.0.0.1:8000  WS ws://127.0.0.1:8765
  2. Room    (WebRTC signaling)       — WS ws://127.0.0.1:8766
  3. Frontend (Vite + Electron)

All output streams to this terminal with timestamps.
Press Ctrl+C to stop all processes.

Usage:
    python start.py
"""

from __future__ import annotations

import os
import sys
import time
import signal
import subprocess
import threading
from pathlib import Path

# ─── Colour helpers ────────────────────────────────────────────────────────────

class Col:
    RESET   = "\033[0m"
    RED     = "\033[31m"
    GREEN   = "\033[32m"
    YELLOW  = "\033[33m"
    CYAN    = "\033[36m"
    WHITE   = "\033[37m"
    BOLD    = "\033[1m"


def ts() -> str:
    """HH:MM:SS timestamp."""
    return time.strftime("%H:%M:%S")


def log(pid: int | None, label: str, line: str, colour: str = Col.WHITE) -> None:
    prefix = f"{colour}[{ts()}]"
    if pid:
        print(f"{prefix}  [{label} pid={pid}]{Col.RESET}  {line}")
    else:
        print(f"{prefix}  {colour}{label}{Col.RESET}  {line}")


def ok(msg: str) -> None:
    print(f"{Col.GREEN}[{ts()}]  OK{Col.RESET}  {msg}")


def warn(msg: str) -> None:
    print(f"{Col.YELLOW}[{ts()}]  WARN{Col.RESET}  {msg}", file=sys.stderr)


def info(msg: str) -> None:
    print(f"{Col.CYAN}[{ts()}]{Col.RESET}  {msg}")


# ─── Project layout helpers ────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent   # e:\project\SSP\focus_island
VENV = ROOT / ".venv"
VENV_PY = VENV / "Scripts" / "python.exe"
FRONTEND = ROOT / "frontend"


def resolve_py() -> Path:
    """Return the virtual-environment Python, falling back to system python."""
    if VENV_PY.is_file():
        return VENV_PY
    warn(f".venv not found at {VENV}; using system Python")
    return Path(sys.executable)


def pip_install(packages: list[str]) -> None:
    """Install missing packages into the venv."""
    py = resolve_py()
    for pkg in packages:
        r = subprocess.run([str(py), "-m", "pip", "install", pkg],
                          capture_output=True, text=True)
        if r.returncode != 0:
            warn(f"pip install {pkg} failed:\n  {r.stderr[:300]}")


# ─── Process collector ─────────────────────────────────────────────────────────

class Processes:
    def __init__(self) -> None:
        self.procs: list[subprocess.Popen] = []
        self._lock = threading.Lock()

    def _stream(self, proc: subprocess.Popen, label: str, colour: str) -> None:
        """Forward stdout/stderr of one process to this terminal."""
        pid = proc.pid
        colour_inner = colour
        for line in iter(proc.stdout.readline, ""):
            if not line:
                break
            log(pid, label, line.rstrip(), colour_inner)
        # stderr merged into stdout already; just log exit
        code = proc.wait()
        log(pid, label, f"exited with code {code}", Col.YELLOW)

    def add(self, label: str, colour: str, args: list[str],
            cwd: Path | None = None, env: dict | None = None) -> subprocess.Popen | None:
        py = resolve_py()
        full_env = dict(os.environ)
        full_env["PYTHONPATH"] = str(ROOT / "src")
        if env:
            full_env.update(env)

        try:
            proc = subprocess.Popen(
                [str(py] + args,
                cwd=str(cwd or ROOT),
                env=full_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
                    if os.name == "nt" else 0,
            )
        except OSError as e:
            warn(f"Failed to start {label}: {e}")
            return None

        with self._lock:
            self.procs.append(proc)

        threading.Thread(
            target=self._stream,
            args=(proc, label, colour),
            daemon=True,
        ).start()

        ok(f"{label} started  (pid={proc.pid})")
        return proc

    def terminate_all(self) -> None:
        """Send SIGTERM / CTRL_BREAK to every managed process."""
        print(f"\n{Col.YELLOW}[{ts()}]  Stopping all processes…{Col.RESET}")
        with self._lock:
            for p in self.procs:
                try:
                    if os.name == "nt":
                        # CTRL_BREAK — equivalent of SIGTERM on Windows
                        p.send_signal(signal.CTRL_BREAK_EVENT)
                    else:
                        p.terminate()
                except OSError:
                    pass
        # Give processes a moment to flush
        time.sleep(1.5)
        with self._lock:
            still_live = [p for p in self.procs if p.poll() is None]
            for p in still_live:
                try:
                    p.kill()
                except OSError:
                    pass
        print(f"{Col.RED}[{ts()}]  All processes stopped.{Col.RESET}")


# ─── Service definitions ───────────────────────────────────────────────────────

def start_backend(p: Processes) -> None:
    p.add(
        label="Backend",
        colour=Col.GREEN,
        args=[
            "-m", "focus_island.main",
            "--mode", "server",
            "--ws-port", "8765",
            "--api-port", "8000",
        ],
    )


def start_room(p: Processes) -> None:
    p.add(
        label="Room",
        colour=Col.CYAN,
        args=[
            "-m", "focus_island.room_server",
            "--port", "8766",
        ],
    )


def start_frontend(p: Processes) -> None:
    # Check node_modules
    nm = FRONTEND / "node_modules"
    if not nm.is_dir():
        warn("frontend/node_modules not found — running npm install first…")
        r = subprocess.run(["npm", "install"], cwd=str(FRONTEND), text=True)
        if r.returncode != 0:
            warn(f"npm install failed:\n  {r.stderr[:300]}")
        else:
            ok("npm install complete")
    p.add(
        label="Frontend",
        colour=Col.YELLOW,
        args=["npm", "run", "electron:dev"],
        cwd=FRONTEND,
    )


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    print(f"""
{Col.BOLD}{'='*60}
   Focus Island  —  starting all services
{'='*60}{Col.RESET}
  Project root : {ROOT}
  Python       : {resolve_py()}
  Ports         : API=8000  Backend WS=8765  Room WS=8766
{Col.BOLD}{'─'*60}{Col.RESET}
""")

    procs = Processes()

    # Catch Ctrl+C gracefully
    def signal_handler(sig, frame):
        print()   # newline after ^C
        procs.terminate_all()
        sys.exit(0)
    signal.signal(signal.SIGINT, signal_handler)
    if os.name == "nt":
        signal.signal(signal.CTRL_BREAK_EVENT, signal_handler)

    # Start backend first — give it a moment to bind ports
    start_backend(procs)
    time.sleep(2)

    # Start room server — live mode needs this
    start_room(procs)
    time.sleep(2)

    # Start frontend last
    start_frontend(procs)

    print(f"""
{Col.BOLD}{'─'*60}
  All services launched.
  Live mode / 主持房间 requires the Room service (port 8766).
  If you see "Failed to connect to signaling server":
    • confirm FocusIsland window says "Room" and shows no errors
    • run:  netstat -ano | findstr :8766
{Col.BOLD}{'─'*60}{Col.RESET}
""")

    # Block — keep the main thread alive while children run
    while True:
        time.sleep(60)


if __name__ == "__main__":
    main()
