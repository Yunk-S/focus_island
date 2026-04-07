"""
WebSocket 实时通信服务模块

提供 WebSocket 服务，支持实时推送专注检测结果。

Author: SSP Team
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional, Callable, Any
from dataclasses import asdict
from datetime import datetime

import websockets
from websockets.server import WebSocketServerProtocol, serve

from .types import FocusState, WarningReason


logger = logging.getLogger(__name__)


class WSMessageType:
    """WebSocket 消息类型"""
    # 服务端推送
    FRAME_RESULT = "frame_result"       # 帧处理结果
    STATE_CHANGE = "state_change"      # 状态变化
    SESSION_SUMMARY = "session_summary" # 会话摘要
    SCORE_UPDATE = "score_update"       # 积分更新
    MILESTONE = "milestone"             # 里程碑达成
    SYSTEM_INFO = "system_info"         # 系统信息
    HEARTBEAT = "heartbeat"             # 心跳
    ERROR = "error"                     # 错误信息
    
    # 客户端请求
    START_SESSION = "start_session"     # 开始会话
    STOP_SESSION = "stop_session"       # 停止会话
    PAUSE_SESSION = "pause_session"     # 暂停会话
    RESUME_SESSION = "resume_session"   # 恢复会话
    RESET_SESSION = "reset_session"      # 重置会话
    GET_SUMMARY = "get_summary"         # 获取摘要
    SET_CONFIG = "set_config"           # 设置配置
    PING = "ping"                      # Ping


class WSMessage:
    """WebSocket 消息封装"""
    
    def __init__(
        self,
        msg_type: str,
        data: Optional[dict] = None,
        error: Optional[str] = None,
        timestamp: Optional[float] = None
    ):
        self.type = msg_type
        self.data = data or {}
        self.error = error
        self.timestamp = timestamp or time.time()
    
    def to_dict(self) -> dict:
        result = {
            "type": self.type,
            "timestamp": self.timestamp
        }
        if self.data:
            result["data"] = self.data
        if self.error:
            result["error"] = self.error
        return result
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)
    
    @classmethod
    def from_json(cls, json_str: str) -> "WSMessage":
        data = json.loads(json_str)
        return cls(
            msg_type=data.get("type", ""),
            data=data.get("data", {}),
            error=data.get("error"),
            timestamp=data.get("timestamp", time.time())
        )


class ClientConnection:
    """客户端连接"""
    
    def __init__(self, websocket: WebSocketServerProtocol, client_id: str):
        self.websocket = websocket
        self.client_id = client_id
        self.connected_at = time.time()
        self.last_ping = time.time()
        self.is_alive = True
    
    async def send(self, message: WSMessage) -> bool:
        """发送消息"""
        try:
            await self.websocket.send(message.to_json())
            return True
        except Exception as e:
            logger.error(f"Failed to send message to {self.client_id}: {e}")
            self.is_alive = False
            return False
    
    async def receive(self) -> Optional[WSMessage]:
        """接收消息"""
        try:
            data = await self.websocket.recv()
            return WSMessage.from_json(data)
        except Exception as e:
            logger.error(f"Failed to receive from {self.client_id}: {e}")
            self.is_alive = False
            return None


class WebSocketServer:
    """WebSocket 服务器"""
    
    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8765,
        max_connections: int = 10,
        heartbeat_interval: int = 30
    ):
        """
        初始化 WebSocket 服务器
        
        Args:
            host: 监听地址
            port: 监听端口
            max_connections: 最大连接数
            heartbeat_interval: 心跳间隔 (秒)
        """
        self.host = host
        self.port = port
        self.max_connections = max_connections
        self.heartbeat_interval = heartbeat_interval
        
        # 连接管理
        self._clients: dict[str, ClientConnection] = {}
        self._client_counter = 0
        self._server = None
        
        # 回调
        self._handlers: dict[str, Callable] = {}
        self._event_handlers: dict[str, list[Callable]] = {
            "state_change": [],
            "milestone": [],
            "session_start": [],
            "session_stop": []
        }
        
        # 任务
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._running = False
        
        logger.info(f"WebSocketServer initialized: {host}:{port}")
    
    def register_handler(self, msg_type: str, handler: Callable) -> None:
        """注册消息处理器"""
        self._handlers[msg_type] = handler
        logger.debug(f"Registered handler for {msg_type}")
    
    def register_event_handler(self, event: str, handler: Callable) -> None:
        """注册事件处理器"""
        if event in self._event_handlers:
            self._event_handlers[event].append(handler)
    
    def on_frame_result(self, handler: Callable) -> None:
        """帧结果回调"""
        self._handlers[WSMessageType.FRAME_RESULT] = handler
    
    def emit_event(self, event: str, data: dict) -> None:
        """触发事件 (异步)"""
        if event in self._event_handlers:
            for handler in self._event_handlers[event]:
                try:
                    handler(data)
                except Exception as e:
                    logger.error(f"Event handler error for {event}: {e}")
    
    async def _handle_client(self, websocket: WebSocketServerProtocol) -> None:
        """处理客户端连接"""
        # 生成客户端 ID
        self._client_counter += 1
        client_id = f"client_{self._client_counter}"
        
        # 检查连接数
        if len(self._clients) >= self.max_connections:
            logger.warning(f"Max connections reached, rejecting {client_id}")
            await websocket.close(1001, "Max connections reached")
            return
        
        # 创建连接对象
        client = ClientConnection(websocket, client_id)
        self._clients[client_id] = client
        
        logger.info(f"Client connected: {client_id}, total: {len(self._clients)}")
        
        # 发送欢迎消息
        welcome = WSMessage(
            WSMessageType.SYSTEM_INFO,
            data={
                "client_id": client_id,
                "server_time": datetime.now().isoformat(),
                "connected_clients": len(self._clients)
            }
        )
        await client.send(welcome)
        
        try:
            async for raw_message in websocket:
                try:
                    message = WSMessage.from_json(raw_message)
                    await self._process_message(client, message)
                except json.JSONDecodeError:
                    error = WSMessage(WSMessageType.ERROR, error="Invalid JSON")
                    await client.send(error)
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client disconnected: {client_id}")
        finally:
            del self._clients[client_id]
            logger.info(f"Client removed: {client_id}, remaining: {len(self._clients)}")
    
    async def _process_message(self, client: ClientConnection, message: WSMessage) -> None:
        """处理消息"""
        msg_type = message.type
        
        # 更新心跳
        client.last_ping = time.time()
        
        # 查找处理器
        handler = self._handlers.get(msg_type)
        if handler:
            try:
                response = await handler(client, message)
                if response:
                    await client.send(response)
            except Exception as e:
                logger.error(f"Handler error for {msg_type}: {e}")
                error = WSMessage(WSMessageType.ERROR, error=str(e))
                await client.send(error)
        else:
            # 未知消息类型
            logger.warning(f"Unknown message type: {msg_type}")
    
    async def _heartbeat(self) -> None:
        """心跳任务"""
        while self._running:
            await asyncio.sleep(self.heartbeat_interval)
            
            # 检查所有客户端
            dead_clients = []
            for client_id, client in self._clients.items():
                if time.time() - client.last_ping > self.heartbeat_interval * 2:
                    logger.warning(f"Client {client_id} heartbeat timeout")
                    dead_clients.append(client_id)
            
            # 移除超时客户端
            for client_id in dead_clients:
                try:
                    await self._clients[client_id].websocket.close()
                except:
                    pass
                if client_id in self._clients:
                    del self._clients[client_id]
            
            # 发送心跳
            heartbeat = WSMessage(WSMessageType.HEARTBEAT, data={
                "server_time": time.time(),
                "connected_clients": len(self._clients)
            })
            
            await self.broadcast(heartbeat)
    
    async def broadcast(self, message: WSMessage) -> int:
        """广播消息给所有客户端"""
        sent_count = 0
        dead_clients: list[str] = []
        for client_id, client in list(self._clients.items()):
            try:
                await client.send(message)
                sent_count += 1
            except Exception as e:
                logger.error(f"Failed to broadcast to {client_id}: {e}")
                dead_clients.append(client_id)
        for client_id in dead_clients:
            self._clients.pop(client_id, None)
        return sent_count
    
    async def send_to(self, client_id: str, message: WSMessage) -> bool:
        """发送给指定客户端"""
        client = self._clients.get(client_id)
        if client:
            return await client.send(message)
        return False
    
    async def broadcast_frame_result(self, result: dict) -> int:
        """广播帧结果"""
        message = WSMessage(WSMessageType.FRAME_RESULT, data=result)
        return await self.broadcast(message)
    
    async def broadcast_state_change(self, old_state: str, new_state: str, reason: str) -> int:
        """广播状态变化"""
        message = WSMessage(WSMessageType.STATE_CHANGE, data={
            "old_state": old_state,
            "new_state": new_state,
            "reason": reason
        })
        return await self.broadcast(message)
    
    async def broadcast_milestone(self, milestone: dict) -> int:
        """广播里程碑"""
        message = WSMessage(WSMessageType.MILESTONE, data=milestone)
        return await self.broadcast(message)
    
    async def start(self) -> None:
        """启动服务器"""
        if self._running:
            logger.warning("Server already running")
            return
        
        self._running = True
        
        # 启动心跳任务
        self._heartbeat_task = asyncio.create_task(self._heartbeat())
        
        # 启动服务器
        self._server = await serve(
            self._handle_client,
            self.host,
            self.port,
            ping_interval=None  # 禁用自动ping，使用自定义心跳
        )
        
        logger.info(f"WebSocket server started: ws://{self.host}:{self.port}")
    
    async def stop(self) -> None:
        """停止服务器"""
        if not self._running:
            return
        
        self._running = False
        
        # 停止心跳
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        
        # 关闭服务器
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        
        # 关闭所有客户端
        for client_id, client in list(self._clients.items()):
            try:
                await client.websocket.close()
            except:
                pass
        
        self._clients.clear()
        
        logger.info("WebSocket server stopped")
    
    @property
    def is_running(self) -> bool:
        """服务器是否运行中"""
        return self._running
    
    @property
    def client_count(self) -> int:
        """当前连接数"""
        return len(self._clients)


class WebSocketClient:
    """WebSocket 客户端 (用于测试或连接到其他服务器)"""
    
    def __init__(
        self,
        url: str,
        on_message: Optional[Callable[[WSMessage], None]] = None,
        on_connect: Optional[Callable[[], None]] = None,
        on_disconnect: Optional[Callable[[], None]] = None
    ):
        """
        初始化客户端
        
        Args:
            url: 服务器 URL
            on_message: 消息回调
            on_connect: 连接回调
            on_disconnect: 断开回调
        """
        self.url = url
        self.on_message = on_message
        self.on_connect = on_connect
        self.on_disconnect = on_disconnect
        
        self._websocket: Optional[WebSocketServerProtocol] = None
        self._running = False
        self._receive_task: Optional[asyncio.Task] = None
    
    async def connect(self) -> bool:
        """连接服务器"""
        try:
            self._websocket = await websockets.connect(self.url)
            self._running = True
            
            if self.on_connect:
                self.on_connect()
            
            logger.info(f"Connected to {self.url}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to {self.url}: {e}")
            return False
    
    async def disconnect(self) -> None:
        """断开连接"""
        self._running = False
        
        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
        
        if self._websocket:
            await self._websocket.close()
            self._websocket = None
        
        if self.on_disconnect:
            self.on_disconnect()
        
        logger.info(f"Disconnected from {self.url}")
    
    async def send(self, message: WSMessage) -> bool:
        """发送消息"""
        if self._websocket:
            try:
                await self._websocket.send(message.to_json())
                return True
            except Exception as e:
                logger.error(f"Failed to send message: {e}")
        return False
    
    async def send_command(self, command: str, data: Optional[dict] = None) -> bool:
        """发送命令"""
        message = WSMessage(command, data=data)
        return await self.send(message)
    
    async def _receive_loop(self) -> None:
        """接收消息循环"""
        while self._running and self._websocket:
            try:
                raw_message = await self._websocket.recv()
                message = WSMessage.from_json(raw_message)
                
                if self.on_message:
                    self.on_message(message)
                    
            except websockets.exceptions.ConnectionClosed:
                logger.info("Connection closed by server")
                break
            except Exception as e:
                logger.error(f"Receive error: {e}")
                break
        
        self._running = False
        if self.on_disconnect:
            self.on_disconnect()
    
    async def start_receiving(self) -> None:
        """开始接收消息"""
        self._receive_task = asyncio.create_task(self._receive_loop())
    
    @property
    def is_connected(self) -> bool:
        """是否已连接"""
        return self._websocket is not None and self._running
