# 跨机器 WebRTC 房间互联测试指南

## 问题背景

Focus Island 的 WebRTC 实时通信房间功能依赖于 **Signaling Server** (`room_server.py`) 进行信令交换。默认配置下，Signaling Server 仅监听 `127.0.0.1:8766`，客户端也默认连接 `127.0.0.1:8766`，这导致不同机器之间无法互联。

## 解决方案

### 方法一：使用环境变量配置 Room Server URL（推荐）

#### 步骤 1：主机 A 启动 Room Server 并开放监听

编辑 `src/focus_island/room_server.py`，将默认 host 从 `127.0.0.1` 改为 `0.0.0.0`：

```python
# 在 room_server.py 的入口处（约第443行）
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Focus Island — Room Signaling Server")
    parser.add_argument("--host", type=str, default="0.0.0.0")  # 改为 0.0.0.0
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()

    logger.info(f"Starting Room Signaling Server on ws://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
```

#### 步骤 2：主机 A 启动 Room Server

```bash
cd e:\project\SSP\focus_island
python -m focus_island.room_server --host 0.0.0.0 --port 8766
```

或使用 Electron 自动启动 Room Server（默认会监听 `0.0.0.0:8766`）。

#### 步骤 3：客户端机器 B 配置自定义 Room Server URL

在终端中设置环境变量后再启动 Vite 开发服务器：

**Windows CMD:**
```cmd
set VITE_ROOM_SERVER_URL=ws://192.168.x.x:8766/ws/room
npm run dev
```

**Windows PowerShell:**
```powershell
$env:VITE_ROOM_SERVER_URL="ws://192.168.x.x:8766/ws/room"
npm run dev
```

**Linux/macOS:**
```bash
export VITE_ROOM_SERVER_URL="ws://192.168.x.x:8766/ws/room"
npm run dev
```

#### 步骤 4：验证连接

1. 主机 A 创建房间，获取邀请码
2. 客户端 B 输入邀请码尝试加入
3. 观察浏览器控制台 `[WebRTC]` 日志，确认 WebSocket 连接成功

---

### 方法二：修改 Vite 配置（持久化配置）

如果你需要持久化配置，可以直接修改 `vite.config.js`：

```javascript
// 将 focusIslandRoomWsUrl 设置为实际主机地址
const focusIslandRoomWsUrl = 'ws://192.168.1.100:8766/ws/room';
```

**注意：** 这种方式会将 URL 硬编码，每次更换网络环境都需要修改。

---

### 方法三：使用 Electron 构建版本

Electron 版本的 Focus Island 会自动启动 Room Server，且默认监听 `0.0.0.0:8766`。

1. 在主机 A 上运行 Electron 应用
2. 客户端 B 同样使用 Electron 版本
3. 客户端 B 需要通过 IPC 设置自定义 Room Server URL

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

应返回类似：
```json
{"status": "ok", "timestamp": 1234567890, "rooms": 0}
```

---

## 排查连接问题

1. **WebSocket 连接失败**
   - 检查防火墙设置
   - 确认 Room Server 已启动且监听 `0.0.0.0:8766`
   - 查看浏览器控制台 `[WebRTC]` 日志

2. **房间不存在**
   - 确认邀请码输入正确（区分大小写）
   - 确认主机 A 的房间仍在线（房间无参与者时会被清理）

3. **STUN/TURN 连接问题**
   - WebRTC 需要 STUN 服务器帮助 NAT 穿透
   - 检查 `useWebRTC.jsx` 中的 `RTC_CONFIG`
   - 可以添加免费 STUN 服务器：`stun:stun.l.google.com:19302`

---

## 网络架构图

```
主机 A (主持会议)                    客户端 B (加入房间)
┌─────────────────┐                  ┌─────────────────┐
│  Room Server    │                  │  WebSocket      │
│  ws://:8766     │◄── WebSocket ────│  Client        │
│  (0.0.0.0:8766) │                  │                 │
└────────┬────────┘                  └────────┬────────┘
         │                                    │
         │         STUN Server                │
         └──────────► stun.l.google.com:19302 │
                            │                 │
                            ▼                 ▼
                      ┌─────────────────┐
                      │   P2P Direct    │
                      │   Video/Audio  │
                      └─────────────────┘
```

---

## 附录：本地测试替代方案

如果你只是想在同一局域网内进行测试，可以考虑：

1. **使用 ngrok/frp**：将本地端口暴露到公网
2. **配置 TURN 服务器**：用于对称型 NAT 环境下的连接
3. **修改 hosts 文件**：测试多机器场景（不推荐）

---

作者：SSP Team
日期：2026-04-10