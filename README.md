# Focus Island

> **v2.0** · Focus Detection · Face Recognition · Pomodoro · WebRTC Collaboration
>
> 🌐 [中文](./README.md) | 📖 Current: English

**Focus Island** is a desktop focus application based on facial vision analysis. By real-time detection of eye opening and closing ratio (EAR), head posture, and facial feature vectors, we provide users with verifiable records of focus duration.

---

## Core Features

| Feature | Description |
|------|------|
| **Face Auth** | First-time use binds personal facial features, with periodic automatic re-verification to prevent impersonation |
| **Focus Detection** | EAR + head posture dual-dimension, auto-distinguishes focused / distracted / interrupted |
| **Points System** | Accumulate points based on focus time, milestone rewards trigger on achievement |
| **WebRTC Collaboration Room** | Real-time video room, see other members' focus status at a glance |
| **i18n** | Chinese / English built-in multi-language support |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (Electron)               │
│  React 18 + Vite + TailwindCSS + Framer Motion     │
│  ws://127.0.0.1:8765  ←── WebSocket  frame/status   │
│  http://127.0.0.1:8000 ←── REST API  bind/session  │
└────────────────────────┬────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │   Backend  (Python 3.10+)   │
          │  FastAPI + websockets       │
          │  UniFace (yakhyo/uniface)   │
          │  ONNX Runtime (GPU/CPU)     │
          └───────────────────────────────┘

              ┌──────────────────────┐
              │  Room Server (WS :8766) │  WebRTC signaling
              └──────────────────────┘
```

### Frontend Stack

| Category | Tech | Purpose |
|------|------|------|
| Runtime | Electron 29 | Desktop window, IPC, native interaction |
| Build | Vite 5 + React 18 | Fast HMR development experience |
| Styling | Tailwind CSS 3 + Radix UI | Modern dark UI component system |
| Animation | Framer Motion 11 | State transitions & micro-interaction effects |

### Backend Stack

| Category | Tech | Purpose |
|------|------|------|
| HTTP API | FastAPI + Uvicorn | Identity binding / verification / session REST API |
| Real-time | Python `websockets` | Frame streaming, focus state push |
| Face Analysis | **UniFace** (PyPI ≥3.0) | RetinaFace / SCRFD / ArcFace / Landmark106 / HeadPose |
| Inference | ONNX Runtime ≥1.16 | GPU (CUDA) or CPU execution |

### UniFace Model Reference

| Model | Type | Usage |
|------|------|------|
| **RetinaFace / SCRFD** | Face Detection | Locate face bbox + 5 keypoints in frame |
| **ArcFace (512d)** | Face Recognition | Generate 512-dim embedding for identity comparison |
| **Landmark106** | Landmark Detection | 106-point refined face mesh, EAR eye metric |
| **HeadPose (ResNet18)** | Head Pose Estimation | Pitch / Yaw / Roll three-axis rotation |

> Models auto-download from PyPI cache on first run (`~/.uniface/models/`), ~70 MB ONNX files total.

---

## 4-Stage Focus Workflow

```
[1. AUTH]    Load models → Read stored face embedding → Wait for camera
[2. PERCEPT] Sample frames → EAR + head pose + periodic face re-verification
[3. EVALUATE] FSM decision → FOCUSED / WARNING / INTERRUPTED
[4. REWARD]   Points accumulation → Milestone reward → Push to frontend
```

---

## Quick Start

### Requirements

- Windows 10/11
- Python 3.10 ~ 3.14
- NVIDIA GPU (recommended RTX 4060+ for CUDA acceleration)
- Camera (built-in or USB)

### 1. Create venv

```bash
cd e:/project/SSP/focus_island
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

> For GPU acceleration:
> ```bash
> pip install onnxruntime-gpu
> ```

### 2. One-click start

Double-click or run in project root:

```bash
start.bat
```

Or:

```powershell
.\start.ps1
```

The script starts in order:

| Window | Port | Description |
|------|------|------|
| FocusIsland-Backend | :8000 / :8765 | REST API + WebSocket backend |
| FocusIsland-Room | :8766 | WebRTC signaling server |
| FocusIsland-Frontend | :5173 | Electron desktop window |

### 3. Manual step-by-step

```bash
# Backend
python -m focus_island.main --mode server --ws-port 8765 --api-port 8000

# Frontend (in frontend/ dir)
cd frontend
npm run electron:dev
```

---

## API & Communication

### REST API  (`http://127.0.0.1:8000`)

| Method | Path | Description |
|------|------|------|
| `GET` | `/api/camera/frame` | Get current camera frame (Base64) |
| `POST` | `/api/face/verify` | Verify if current face matches bound user |
| `POST` | `/api/face/bind` | Bind current face embedding to account |
| `POST` | `/api/session/start` | Start a focus session |
| `GET` | `/api/system/info` | Get backend status, GPU info, version |

### WebSocket  (`ws://127.0.0.1:8765`)

Client sends:

```json
{ "type": "get_system_info" }
{ "type": "start_session", "user_id": "alice" }
{ "type": "stop_session" }
```

Server pushes (example):

```json
{ "type": "system_info", "backend_ready": true, "gpu_available": true }
{ "type": "frame_data", "has_face": true, "ear_avg": 0.28, "identity": { "verified": true } }
{ "type": "state_change", "state": "FOCUSED", "focus_time": 120 }
```

---

## Project Structure

```
focus_island/                     ← Project root
├── src/focus_island/             ← Python backend
│   ├── main.py                   ← Entry: camera/server/desktop
│   ├── server.py                 ← FastAPI + WebSocket server
│   ├── room_server.py            ← WebRTC signaling server
│   ├── pipeline.py               ← Frame processing pipeline
│   ├── auth.py                   ← Face binding & verification (ArcFace)
│   ├── model_manager.py           ← UniFace model loading & inference
│   ├── detector.py               ← RetinaFace / HeadPose wrapper
│   ├── ear.py                    ← Eye Aspect Ratio calculation
│   ├── focus_fsm.py              ← Focus FSM & scoring
│   ├── workflow.py               ← 4-stage workflow orchestration
│   └── types.py                  ← Pydantic data models
├── frontend/                      ← Electron + React frontend
│   ├── src/
│   │   ├── App.tsx               ← Root component
│   │   ├── main.tsx              ← React entry
│   │   ├── components/            ← UI components
│   │   ├── hooks/
│   │   │   ├── useBackend.tsx    ← WebSocket connection management
│   │   │   └── useWebRTC.tsx     ← Collaboration room WebRTC
│   │   └── pages/                ← Page-level components
│   ├── electron/
│   │   ├── main.js               ← Electron main process
│   │   └── preload.js            ← Preload script (secure IPC bridge)
│   └── package.json
├── config/                       ← YAML config files
├── models/                       ← ONNX model cache (auto-downloaded)
├── user_faces/                   ← User face data (do not commit)
├── requirements.txt              ← Python deps (includes uniface)
├── setup.py                      ← pip install -e . entry
├── start.bat                     ← Windows one-click start
├── start.ps1                     ← PowerShell version
├── setup_venv.bat                ← Initialize venv
├── fix_venv.bat                  ← Fix broken venv
├── README.md                     ← Chinese version
├── README_EN.md                  ← English version
└── LICENSE                      ← MIT License
```

---

## Hardware Requirements

| Component | Minimum | Recommended |
|------|------|------|
| CPU | 4 cores | 6+ cores |
| RAM | 8 GB | 16 GB |
| GPU | — | NVIDIA RTX 3060+ (8 GB) |
| Camera | 720p | 1080p |

---

## FAQ

**Q: `ModuleNotFoundError: No module named 'uniface'`**

> The editable install path of `uniface` in the venv is broken. Run `fix_venv.bat` to fix, or delete `.venv` and re-run `pip install -r requirements.txt`.

**Q: Backend fails to start, shows `[ERROR] Python venv not found`**

> Run `setup_venv.bat` first to create the venv and install dependencies.

**Q: Frontend shows `WebSocket connection failed`**

> Confirm the backend window has printed `WebSocket server started on ws://...`, and frontend and backend are running on the same machine.

**Q: CUDA not detected, using CPU inference**

> Confirm NVIDIA driver is installed, then run `pip install onnxruntime-gpu` to replace `onnxruntime`.

---

## License

MIT License · SSP Team
