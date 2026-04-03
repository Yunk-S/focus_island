# SSP Backend

Smart Study Spot - 多功能人脸识别专注检测后端系统

## 功能特性

- **人脸检测**: 基于 UniFace 的 RetinaFace/SCRFD 检测器
- **头部姿态估计**: 实时估计 Pitch/Yaw/Roll 角度
- **眼部状态检测**: EAR (Eye Aspect Ratio) 计算
- **专注状态机**: IDLE/FOCUSED/WARNING/INTERRUPTED 状态转换
- **积分系统**: 专注计时、里程碑奖励
- **实时通信**: WebSocket 推送检测结果
- **REST API**: HTTP 接口用于会话管理
- **GPU 加速**: 支持 NVIDIA CUDA

## 快速开始

### 安装

```bash
cd e:\project\SSP\ssp_backend
pip install -r requirements.txt
```

### 使用摄像头

```bash
python -m ssp_backend.main --mode camera
```

### 使用视频文件

```bash
python -m ssp_backend.main --mode video --input video.mp4 --output result.mp4
```

### 启动服务器

```bash
python -m ssp_backend.main --mode server --ws-port 8765 --api-port 8000
```

### 测试模型

```bash
python -m ssp_backend.main --mode test
```

## 配置

编辑 `config/default.yaml` 来自定义参数:

- 头部姿态阈值 (pitch/yaw)
- EAR 阈值
- 宽容时间
- 计分规则

## API 接口

### WebSocket

```
ws://localhost:8765
```

### REST API

```
http://localhost:8000
```

## 项目结构

```
ssp_backend/
├── src/ssp_backend/
│   ├── __init__.py
│   ├── types.py          # 数据类型定义
│   ├── detector.py       # 核心检测模块
│   ├── ear.py           # EAR 计算
│   ├── focus_fsm.py     # 状态机与计分
│   ├── pipeline.py       # 处理管道
│   ├── websocket_server.py  # WebSocket 服务
│   ├── api_server.py    # REST API
│   └── main.py          # CLI 入口
├── config/
│   └── default.yaml     # 配置文件
├── requirements.txt
└── setup.py
```

## 硬件要求

- NVIDIA GPU (RTX 4060 推荐)
- 8GB+ RAM
- Python 3.10+
