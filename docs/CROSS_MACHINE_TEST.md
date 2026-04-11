# 跨机器 WebRTC 房间互联测试指南

## 问题背景

Focus Island 的 WebRTC 实时通信房间功能依赖于 **Signaling Server** (`room_server.py`) 进行信令交换。默认配置下，Signaling Server 监听 `0.0.0.0:8766`，支持跨机器访问。

## 解决方案

### 新增功能：自动发现房间服务

前端现在支持**自动发现**同一局域网内的房间服务器：

1. 首先尝试连接本机 `127.0.0.1:8766`
2. 如果本机没有服务器，会查询 `/api/room/server-info` 获取房间服务器的本机 IP
3. 使用获取到的 IP 自动构建 WebSocket URL

这意味着在**同一 WiFi 网络下**：
- 主持人的机器启动 room_server (默认监听 `0.0.0.0:8766`)
- 参与者直接使用前端，**无需手动配置服务器地址**
- 前端会自动发现并连接到主持人的房间服务

---

### 方法一：自动发现（推荐，最简单）

#### 步骤 1：主机 A 启动 Room Server

```bash
cd e:\project\SSP\focus_island
python -m focus_island.room_server --host 0.0.0.0 --port 8766
```

或使用 Electron 自动启动（默认监听 `0.0.0.0:8766`）。

#### 步骤 2：客户端 B 直接使用前端

**不需要任何配置！** 前端会自动发现房间服务：
1. 客户端 B 打开前端，进入 Live 模式
2. 输入主持人提供的邀请码
3. 前端会自动连接到主机 A 的房间服务

#### 步骤 3：验证连接

观察浏览器控制台日志：
```
[WebRTC] Trying local room server: ws://127.0.0.1:8766/ws/room
[WebRTC] Checking server-info at: http://127.0.0.1:8766/api/room/server-info
[WebRTC] Got server-info: {"status":"ok","local_ip":"192.168.x.x",...}
[WebRTC] Derived WS URL from server-info: ws://192.168.x.x:8766/ws/room
[WebRTC] Connecting to signaling server: ws://192.168.x.x:8766/ws/room
```

---

### 方法二：手动配置 Room Server URL

如果自动发现失败，可以使用环境变量手动配置。

#### Windows PowerShell:
```powershell
$env:VITE_ROOM_SERVER_URL="ws://192.168.x.x:8766/ws/room"
npm run dev
```

#### Windows CMD:
```cmd
set VITE_ROOM_SERVER_URL=ws://192.168.x.x:8766/ws/room
npm run dev
```

#### Linux/macOS:
```bash
export VITE_ROOM_SERVER_URL="ws://192.168.x.x:8766/ws/room"
npm run dev
```

---

### 方法三：修改 Vite 配置（持久化）

直接修改 `vite.config.js`：
```javascript
const focusIslandRoomWsUrl = 'ws://192.168.1.100:8766/ws/room';
```

---

### 方法四：使用 Electron 构建版本

Electron 版本的 Focus Island 会自动启动 Room Server，且默认监听 `0.0.0.0:8766`。

1. 在主机 A 上运行 Electron 应用
2. 客户端 B 同样使用 Electron 版本
3. 客户端 B 会自动发现主机 A 的房间服务

---

## 防火墙设置

确保以下端口已开放：

| 端口 | 协议 | 用途 |
|------|------|------|
| 8766 | TCP | Room Server WebSocket |
| 8765 | TCP | 主后端 WebSocket |
| 8000 | TCP | 主后端 REST API |

---

## 验证 Room Server 是否可达

在客户端机器 B 上测试：

```bash
curl http://192.168.x.x:8766/health
```

应返回：
```json
{"status": "ok", "timestamp": 1234567890, "rooms": 0}
```

获取服务器详细信息：
```bash
curl http://192.168.x.x:8766/api/room/server-info
```

应返回：
```json
{
  "status": "ok",
  "hostname": "HOST-PC",
  "local_ip": "192.168.x.x",
  "default_port": 8766,
  "ws_path": "/ws/room",
  "ws_url_template": "ws://{host}:8766/ws/room"
}
```

---

## 排查连接问题

1. **WebSocket 连接失败**
   - 检查防火墙设置
   - 确认 Room Server 已启动：`python -m focus_island.room_server --host 0.0.0.0`
   - 查看浏览器控制台 `[WebRTC]` 日志
   - 使用 `curl http://192.168.x.x:8766/health` 测试连通性

2. **房间不存在**
   - 确认邀请码输入正确（区分大小写）
   - 确认主机 A 的房间仍在线

3. **自动发现失败**
   - 使用方法二手动配置服务器 URL
   - 检查两台机器是否在同一 WiFi 网络

---

## 网络架构图

```
主机 A (主持会议)                    客户端 B (加入房间)
┌─────────────────┐                  ┌─────────────────┐
│  Room Server   │                  │  WebSocket      │
│  0.0.0.0:8766 │◄─── Discovery ───│  Auto-Find     │
│                 │◄── WebSocket ───│  Client        │
└────────┬────────┘                  └────────┬────────┘
         │                                    │
         │         STUN Server                │
         └──────────► stun.l.google.com:19302 │
                            │                 │
                            ▼                 ▼
                      ┌─────────────────┐
                      │   P2P Direct    │
                      │   Video/Audio   │
                      └─────────────────┘
```

---

## 附录：本地测试替代方案

1. **使用 ngrok/frp**：将本地端口暴露到公网
2. **配置 TURN 服务器**：用于对称型 NAT 环境
3. **手动配置 URL**：使用方法二或方法三

---

作者：SSP Team
日期：2026-04-11
