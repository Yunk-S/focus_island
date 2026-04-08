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

# Windows default locale (e.g. GBK) breaks when merging Node/Vite logs (UTF-8).
SUBPROC_TEXT_ENCODING = "utf-8"
SUBPROC_TEXT_ERRORS = "replace"


def resolve_py() -> Path:
    """Return the virtual-environment Python, falling back to system python."""
    if VENV_PY.is_file():
        return VENV_PY
    warn(f".venv not found at {VENV}; using system Python")
    return Path(sys.executable)


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

    def add(
        self,
        label: str,
        colour: str,
        argv: list[str],
        cwd: Path | None = None,
        env: dict | None = None,
        set_pythonpath: bool = True,
    ) -> subprocess.Popen | None:
        full_env = dict(os.environ)
        if set_pythonpath:
            full_env["PYTHONPATH"] = str(ROOT / "src")
        # Align Python child processes with pipe decoding (avoids mixed encodings on Windows).
        full_env.setdefault("PYTHONUTF8", "1")
        full_env.setdefault("PYTHONIOENCODING", "utf-8")
        if env:
            full_env.update(env)

        try:
            proc = subprocess.Popen(
                argv,
                cwd=str(cwd or ROOT),
                env=full_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding=SUBPROC_TEXT_ENCODING,
                errors=SUBPROC_TEXT_ERRORS,
                bufsize=1,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
                if os.name == "nt"
                else 0,
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
        print(f"\n{Col.YELLOW}[{ts()}]  Stopping all processes...{Col.RESET}")
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
    py = str(resolve_py())
    p.add(
        label="Backend",
        colour=Col.GREEN,
        argv=[
            py,
            "-m",
            "focus_island.main",
            "--mode",
            "server",
            "--ws-port",
            "8765",
            "--api-port",
            "8000",
        ],
    )


def start_room(p: Processes) -> None:
    py = str(resolve_py())
    p.add(
        label="Room",
        colour=Col.CYAN,
        argv=[py, "-m", "focus_island.room_server", "--port", "8766"],
    )


def start_frontend(p: Processes) -> None:
    nm = FRONTEND / "node_modules"
    if not nm.is_dir():
        warn("frontend/node_modules missing; running npm install...")
        if os.name == "nt":
            r = subprocess.run(
                "npm install",
                cwd=str(FRONTEND),
                shell=True,
                text=True,
                encoding=SUBPROC_TEXT_ENCODING,
                errors=SUBPROC_TEXT_ERRORS,
            )
        else:
            r = subprocess.run(
                ["npm", "install"],
                cwd=str(FRONTEND),
                text=True,
                encoding=SUBPROC_TEXT_ENCODING,
                errors=SUBPROC_TEXT_ERRORS,
            )
        if r.returncode != 0:
            warn("npm install failed; check Node.js and network.")
        else:
            ok("npm install complete")
    # Windows: Popen(["npm", ...]) often raises WinError 2 — npm is a .cmd, not an .exe.
    # cmd.exe applies PATHEXT and finds npm.cmd on PATH.
    if os.name == "nt":
        frontend_argv = ["cmd", "/c", "npm run electron:dev"]
    else:
        frontend_argv = ["npm", "run", "electron:dev"]
    p.add(
        label="Frontend",
        colour=Col.YELLOW,
        argv=frontend_argv,
        cwd=FRONTEND,
        set_pythonpath=False,
    )


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    print(f"""
{Col.BOLD}{'='*60}
   Focus Island - starting all services
{'='*60}{Col.RESET}
  Project root : {ROOT}
  Python       : {resolve_py()}
  Ports        : API=8000  Backend WS=8765  Room WS=8766
{Col.BOLD}{'-'*60}{Col.RESET}
""")

    procs = Processes()

    # Catch Ctrl+C gracefully
    def signal_handler(sig, frame):
        print()   # newline after ^C
        procs.terminate_all()
        sys.exit(0)
    signal.signal(signal.SIGINT, signal_handler)
    if os.name == "nt" and hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, signal_handler)

    # Start backend first — give it a moment to bind ports
    start_backend(procs)
    time.sleep(2)

    # Start room server — live mode needs this
    start_room(procs)
    time.sleep(2)

    # Start frontend last
    start_frontend(procs)

    print(f"""
{Col.BOLD}{'-'*60}
  All services launched.
  Live / host room needs Room signaling on port 8766.
  If "Failed to connect to signaling server": check Room logs above;
  run: netstat -ano | findstr :8766
{Col.BOLD}{'-'*60}{Col.RESET}
""")

    # Block — keep the main thread alive while children run
    while True:
        time.sleep(60)


if __name__ == "__main__":
    main()
