# Focus Island 专注岛屿

> **v2.0** · 专注检测 · 人脸识别 · 番茄钟 · WebRTC 协作
>
> 🌐 [English](./README.md) | 📖 当前：中文

**Focus Island** 是一款基于人脸视觉分析的桌面专注应用。通过实时检测眼部开合度（EAR）、头部姿态和面部特征向量，为用户提供可验证的专注时长记录。

---

## 核心功能 / Core Features

| 功能 Feature | 说明 Description |
|------|------|
| **人脸身份验证 Face Auth** | 首次使用绑定个人面部特征，后续定期自动复核，防止代挂 |
| **专注状态判断 Focus Detection** | EAR + 头部姿态双维度，自动区分专注/分心/中断 |
| **积分激励系统 Points System** | 按专注时长累积积分，达里程碑触发奖励提示 |
| **WebRTC 协作房间 Collaboration Room** | 实时视频房间，可看到其他成员的专注状态 |
| **国际化 i18n** | 中文 / English 内置多语言支持 |

---

## 技术架构 / Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (Electron)               │
│  React 18 + Vite + TailwindCSS + Framer Motion     │
│  ws://127.0.0.1:8765  ←── WebSocket 实时帧/状态    │
│  http://127.0.0.1:8000 ←── REST API 绑定/会话      │
└────────────────────────┬────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │   Backend  (Python 3.10+)   │
          │  FastAPI + websockets       │
          │  UniFace (yakhyo/uniface)   │
          │  ONNX Runtime (GPU/CPU)     │
          └───────────────────────────────┘

              ┌──────────────────────┐
              │  Room Server (WS :8766) │  WebRTC 信令
              └──────────────────────┘
```

### 前端技术栈 / Frontend Stack

| 类别 | 技术 | 作用 |
|------|------|------|
| 运行时 | Electron 29 | 桌面窗口、IPC 与原生交互 |
| 构建 | Vite 5 + React 18 | 极速 HMR 开发体验 |
| 样式 | Tailwind CSS 3 + Radix UI | 现代暗色 UI 组件体系 |
| 动画 | Framer Motion 11 | 状态切换与微交互动效 |

### 后端技术栈 / Backend Stack

| 类别 | 技术 | 作用 |
|------|------|------|
| HTTP API | FastAPI + Uvicorn | 身份绑定 / 验证 / 会话 REST 接口 |
| 实时通信 | Python `websockets` | 帧流推送、专注状态推送 |
| 人脸分析 | **UniFace** (PyPI ≥3.0) | RetinaFace / SCRFD / ArcFace / Landmark106 / HeadPose |
| 推理引擎 | ONNX Runtime ≥1.16 | GPU（CUDA）或 CPU 执行 |

### UniFace 模型说明 / Model Reference

| 模型 Model | 类型 Type | 用途 Usage |
|------|------|------|
| **RetinaFace / SCRFD** | 人脸检测 Face Detection | 定位画面中人脸 bbox + 5 点关键点 |
| **ArcFace (512d)** | 人脸识别 Face Recognition | 生成 512 维特征向量用于身份比对 |
| **Landmark106** | 关键点检测 Landmark Detection | 106 点精细人脸网格，计算 EAR 眼部指标 |
| **HeadPose (ResNet18)** | 头部姿态估计 Head Pose Estimation | Pitch / Yaw / Roll 三轴旋转角度 |

> 模型首次运行自动从 PyPI 缓存下载（`~/.uniface/models/`），ONNX 文件约 70 MB。

---

## 四阶段专注工作流 / 4-Stage Focus Workflow

```
[1. AUTH]    加载模型 → 读取本地绑定特征 → 等待用户进入摄像头
[2. PERCEPT] 抽帧检测 → EAR 计算 + 头部姿态 + 定期身份验证
[3. EVALUATE] 状态机裁决 → FOCUSED / WARNING / INTERRUPTED
[4. REWARD]   积分计算 → milestone 里程碑奖励 → 推送至前端

[1. AUTH]    Load models → Read stored face embedding → Wait for camera
[2. PERCEPT] Sample frames → EAR + head pose + periodic face re-verification
[3. EVALUATE] FSM decision → FOCUSED / WARNING / INTERRUPTED
[4. REWARD]   Points accumulation → Milestone reward → Push to frontend
```

---

## 快速启动 / Quick Start

### 环境要求 / Requirements

- Windows 10/11
- Python 3.10 ~ 3.14
- NVIDIA GPU（推荐 RTX 4060+，支持 CUDA 加速 / recommended RTX 4060+ for CUDA）
- 摄像头（内置或 USB / built-in or USB camera）

### 1. 创建虚拟环境 / Create venv

```bash
cd e:/project/SSP/focus_island
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

> 需要 GPU 加速时 / For GPU acceleration:
> ```bash
> pip install onnxruntime-gpu
> ```

### 2. 一键启动 / Start all services

在项目根目录下双击或运行 / Double-click or run in project root:

```bash
start.bat
```

或 / Or:

```powershell
.\start.ps1
```

脚本将依次启动 / Script starts these in order:

| 窗口 Window | 端口 Port | 说明 Description |
|------|------|------|
| FocusIsland-Backend | :8000 / :8765 | REST API + WebSocket 后端 |
| FocusIsland-Room | :8766 | WebRTC 信令服务器 |
| FocusIsland-Frontend | :5173 | Electron 桌面窗口 |

### 3. 手动分步启动 / Manual step-by-step

```bash
# 后端 / Backend
python -m focus_island.main --mode server --ws-port 8765 --api-port 8000

# 前端（在 frontend/ 目录）/ Frontend (in frontend/ dir)
cd frontend
npm run electron:dev
```

---

## API 与通信 / API & Communication

### REST API  (`http://127.0.0.1:8000`)

| 方法 Method | 路径 Path | 说明 Description |
|------|------|------|
| `GET` | `/api/camera/frame` | 获取当前摄像头帧（Base64） |
| `POST` | `/api/face/verify` | 验证当前人脸是否匹配已绑定用户 |
| `POST` | `/api/face/bind` | 绑定当前人脸特征到指定账户 |
| `POST` | `/api/session/start` | 开始一次专注会话 |
| `GET` | `/api/system/info` | 获取后端状态、GPU 信息、版本 |

### WebSocket  (`ws://127.0.0.1:8765`)

客户端发送 / Client sends:

```json
{ "type": "get_system_info" }
{ "type": "start_session", "user_id": "alice" }
{ "type": "stop_session" }
```

服务端推送（示例）/ Server pushes (example):

```json
{ "type": "system_info", "backend_ready": true, "gpu_available": true }
{ "type": "frame_data", "has_face": true, "ear_avg": 0.28, "identity": { "verified": true } }
{ "type": "state_change", "state": "FOCUSED", "focus_time": 120 }
```

---

## 项目结构 / Project Structure

```
focus_island/                     ← 项目根目录 / Project root
├── src/focus_island/             ← Python 后端 / Python backend
│   ├── main.py                   ← 程序入口（三模式）/ Entry: camera/server/desktop
│   ├── server.py                ← FastAPI + WebSocket 服务端
│   ├── api_server.py            ← REST API 服务端
│   ├── websocket_server.py      ← WebSocket 服务端
│   ├── room_server.py           ← WebRTC 信令服务器
│   ├── stream_controller.py     ← 摄像头流控制器 / Camera stream controller
│   ├── pipeline.py              ← 帧处理流水线 / Frame processing pipeline
│   ├── auth.py                  ← 人脸绑定/验证（ArcFace）/ Face binding & verification
│   ├── model_manager.py         ← UniFace 模型加载与推理 / Model loading & inference
│   ├── detector.py             ← RetinaFace / HeadPose 封装
│   ├── ear.py                   ← EAR 眼部开合度计算 / Eye Aspect Ratio
│   ├── focus_fsm.py            ← 专注状态机与积��计算 / Focus FSM & scoring
│   ├── onnx_util.py            ← ONNX 工具函数
│   └── types.py                ← Pydantic 数据类型定义
├── frontend/                    ← Electron + React 前端
│   ├── src/
│   │   ├── App.tsx             ← 根组件 / Root component
│   │   ├── main.tsx           ← React 入口
│   │   ├── components/         ← UI 组件 / UI components
│   │   ├── hooks/
│   │   │   ├── useBackend.tsx  ← WebSocket 连接管理
│   │   │   └── useWebRTC.tsx   ← 协作房间 WebRTC
│   │   └── pages/             ← 页面级组件 / Page components
│   ├── electron/
│   │   ├── main.js            ← Electron 主进程
│   │   └── preload.js         ← 预加载脚本（安全 IPC 桥接）
│   └── package.json
├── config/                     ← YAML 配置文件
├── examples/                   ← 示例文件
├── models/                     ← ONNX 模型缓存（首次自动下载）
├── script/                     ← 辅助脚本
├── tests/                      ← 测试文件
├── user_faces/                ← 用户人脸数据（勿提交）
├── requirements.txt           ← Python 依赖（含 uniface）
├── setup.py                   ← pip install -e . 入口
├── start.bat                  ← Windows 一键启动
├── start.ps1                  ← PowerShell 版
├── setup_venv.bat            ← 初始化虚拟环境
├── fix_venv.bat              ← 修复损坏的 venv
├── README.md                  ← 英文版 / English version
└── README_CN.md               ← 中文版（此文件）
```

---

## 硬件要求 / Hardware Requirements

| 组件 Component | 最低 Minimum | 推荐 Recommended |
|------|------|------|
| CPU | 4 核 | 6 核以上 |
| 内存 RAM | 8 GB | 16 GB |
| GPU | — | NVIDIA RTX 3060+（8 GB） |
| 摄像头 Camera | 720p | 1080p |

---

## 常见问题 / FAQ

**Q: `ModuleNotFoundError: No module named 'uniface'`**

> 虚拟环境中的 `uniface` 可编辑安装路径失效。运行 `fix_venv.bat` 修复，或删除 `.venv` 后重新 `pip install -r requirements.txt`。

**Q: 后端无法启动，显示 `[ERROR] Python venv not found`**

> 先运行 `setup_venv.bat` 创建虚拟环境并安装依赖。

**Q: 前端显示 `WebSocket connection failed`**

> 确认后端窗口已正常打印 `WebSocket server started on ws://...`，且前端与后端在同一台机器上运行。

**Q: CUDA 未检测到，使用 CPU 推理**

> 确认 NVIDIA 驱动已安装，并执行 `pip install onnxruntime-gpu` 替换 `onnxruntime`。

---

## License

MIT License · SSP Team