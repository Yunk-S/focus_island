# Focus Island

Modern Desktop Focus Application with Real-time Face Detection and Attention Tracking.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Focus Island Desktop App                  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐ │
│  │   Electron   │───▶│    React    │───▶│   TailwindCSS   │ │
│  │   (Shell)    │    │  Frontend   │    │   (UI/UX)       │ │
│  └──────┬──────┘    └─────────────┘    └─────────────────┘ │
│         │                                                    │
│         │ IPC                                               │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Python Backend (FastAPI + WebSockets)       ││
│  ├─────────────────────────────────────────────────────────┤│
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ ││
│  │  │RetinaFace│  │ ArcFace  │  │Landmark106│ │ HeadPose │ ││
│  │  │ (Detect) │  │ (Embed)  │  │ (106pts)  │ │ (Euler)  │ ││
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘ ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
focus_island/
├── src/focus_island/          # Python backend source
│   ├── main.py                # Main entry point
│   ├── server.py              # Server mode
│   ├── workflow.py            # Focus workflow
│   ├── types.py               # Data types
│   ├── auth.py                # Face authentication
│   ├── model_manager.py       # Model management
│   └── ...
├── frontend/                  # Electron + React Frontend
│   ├── electron/              # Electron main process
│   │   ├── main.js           # Main entry point
│   │   └── preload.js        # Preload scripts
│   ├── src/                   # React application
│   │   ├── components/        # React components
│   │   ├── screens/          # Screen components
│   │   ├── hooks/            # Custom React hooks
│   │   └── utils/            # Utility functions
│   └── package.json
├── models/                    # ONNX model files
├── user_faces/                # User face data (email prefix folders)
├── config/                    # Configuration files
├── examples/                  # Example scripts
└── README.md
```

## Features

### Desktop Client
- Beautiful glassmorphism UI with dark mode
- Real-time camera feed with face detection overlay
- Animated login page with island theme
- Focus timer with circular progress indicator
- Live leaderboard showing online students
- Privacy mode toggle
- Face binding and verification

### Backend
- Face detection (RetinaFace)
- Face recognition (ArcFace)
- 106-point facial landmarks
- Head pose estimation
- Eye blink detection (EAR)
- Focus scoring system
- WebSocket real-time communication
- MJPEG video streaming

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+
- NVIDIA GPU with CUDA support (optional)

### Backend Setup

```bash
cd e:\project\SSP\focus_island

# Install Python dependencies
pip install -r requirements.txt

# Download models (if not present)
# Models will be stored in focus_island/models/
```

### Frontend Setup

```bash
cd focus_island/frontend

# Install dependencies
npm install

# Development mode
npm run electron:dev

# Production build
npm run electron:build
```

### Running the Application

1. **Quick Start (PowerShell)**:
   ```bash
   .\start.ps1
   ```

2. **Development Mode**:
   ```bash
   npm run electron:dev
   ```
   This starts the Vite dev server and Electron together.

3. **Production Mode**:
   ```bash
   npm run electron:build
   ```
   This creates a portable executable in `dist-electron/`.

4. **Backend Only (No GUI)**:
   ```bash
   cd focus_island
   python -m focus_island.main --mode server
   ```
   Then connect with any WebSocket client to `ws://localhost:8765`.

## User Face Data

- Face data is stored locally per user account
- Each user has a folder named after their email prefix
- Example: `user_faces/user_john_doe/` for `john.doe@example.com`
- Contains: `metadata.json`, `embedding.npy`

## API Endpoints

### REST API (http://localhost:8000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/status` | System status |
| GET | `/api/video/stream` | MJPEG video stream |
| POST | `/api/session/start` | Start focus session |
| POST | `/api/session/stop` | Stop focus session |
| GET | `/api/session/status` | Session status |

### WebSocket (ws://localhost:8765)

**Client Messages:**
- `start_session` - Start focus session
- `stop_session` - Stop focus session
- `pause_session` - Pause session
- `resume_session` - Resume session
- `get_system_info` - Request system info

**Server Messages:**
- `system_info` - System information
- `frame_result` - Real-time detection results
- `state_change` - Focus state changes
- `score_update` - Points update
- `milestone` - Milestone reached

## UI Design

### Loading Screen
- Animated island with floating elements
- Progress bar with loading stages
- Backend status indicators
- GPU information display

### Login Screen
- Animated island illustration
- Glassmorphism form card
- Demo account quick login
- Email/password authentication

### Dashboard
- Left: Camera feed with face detection
- Center: Focus timer with progress ring
- Right: Live leaderboard and stats

## Tech Stack

### Frontend
- **Electron** - Desktop application framework
- **React 18** - UI library
- **Vite** - Build tool
- **TailwindCSS** - Styling
- **Framer Motion** - Animations
- **Lucide React** - Icons

### Backend
- **Python 3.10+** - Backend language
- **FastAPI** - REST API
- **WebSockets** - Real-time communication
- **OpenCV** - Camera capture
- **UniFace** - Face analysis models
- **ONNX Runtime** - Model inference

## License

MIT License
