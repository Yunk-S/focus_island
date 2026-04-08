"""
WebSocket Real-time Communication Service Module

Provides WebSocket service for real-time focus detection results push.

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
    """WebSocket message types"""
    # Server push
    FRAME_RESULT = "frame_result"       # Frame processing result
    STATE_CHANGE = "state_change"      # State change
    SESSION_SUMMARY = "session_summary" # Session summary
    SCORE_UPDATE = "score_update"       # Score update
    MILESTONE = "milestone"             # Milestone reached
    SYSTEM_INFO = "system_info"         # System info
    HEARTBEAT = "heartbeat"             # Heartbeat
    ERROR = "error"                     # Error message
    
    # Client request
    START_SESSION = "start_session"     # Start session
    STOP_SESSION = "stop_session"       # Stop session
    PAUSE_SESSION = "pause_session"    # Pause session
    RESUME_SESSION = "resume_session"  # Resume session
    RESET_SESSION = "reset_session"     # Reset session
    GET_SUMMARY = "get_summary"         # Get summary
    SET_CONFIG = "set_config"           # Set config
    PING = "ping"                       # Ping


class WSMessage:
    """WebSocket message wrapper"""
    
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
    """Client connection"""
    
    def __init__(self, websocket: WebSocketServerProtocol, client_id: str):
        self.websocket = websocket
        self.client_id = client_id
        self.connected_at = time.time()
        self.last_ping = time.time()
        self.is_alive = True
    
    async def send(self, message: WSMessage) -> bool:
        """Send message"""
        try:
            await self.websocket.send(message.to_json())
            return True
        except Exception as e:
            logger.error(f"Failed to send message to {self.client_id}: {e}")
            self.is_alive = False
            return False
    
    async def receive(self) -> Optional[WSMessage]:
        """Receive message"""
        try:
            data = await self.websocket.recv()
            return WSMessage.from_json(data)
        except Exception as e:
            logger.error(f"Failed to receive from {self.client_id}: {e}")
            self.is_alive = False
            return None


class WebSocketServer:
    """WebSocket Server"""
    
    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8765,
        max_connections: int = 10,
        heartbeat_interval: int = 30
    ):
        """
        Initialize WebSocket Server
        
        Args:
            host: Listen address
            port: Listen port
            max_connections: Max connections
            heartbeat_interval: Heartbeat interval (seconds)
        """
        self.host = host
        self.port = port
        self.max_connections = max_connections
        self.heartbeat_interval = heartbeat_interval
        
        # Connection management
        self._clients: dict[str, ClientConnection] = {}
        self._client_counter = 0
        self._server = None
        
        # Callbacks
        self._handlers: dict[str, Callable] = {}
        self._event_handlers: dict[str, list[Callable]] = {
            "state_change": [],
            "milestone": [],
            "session_start": [],
            "session_stop": []
        }
        
        # Tasks
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._running = False
        
        logger.info(f"WebSocketServer initialized: {host}:{port}")
    
    def register_handler(self, msg_type: str, handler: Callable) -> None:
        """Register message handler"""
        self._handlers[msg_type] = handler
        logger.debug(f"Registered handler for {msg_type}")
    
    def register_event_handler(self, event: str, handler: Callable) -> None:
        """Register event handler"""
        if event in self._event_handlers:
            self._event_handlers[event].append(handler)
    
    def on_frame_result(self, handler: Callable) -> None:
        """Frame result callback"""
        self._handlers[WSMessageType.FRAME_RESULT] = handler
    
    def emit_event(self, event: str, data: dict) -> None:
        """Emit event (async)"""
        if event in self._event_handlers:
            for handler in self._event_handlers[event]:
                try:
                    handler(data)
                except Exception as e:
                    logger.error(f"Event handler error for {event}: {e}")
    
    async def _handle_client(self, websocket: WebSocketServerProtocol) -> None:
        """Handle client connection"""
        # Generate client ID
        self._client_counter += 1
        client_id = f"client_{self._client_counter}"
        
        # Check connection count
        if len(self._clients) >= self.max_connections:
            logger.warning(f"Max connections reached, rejecting {client_id}")
            await websocket.close(1001, "Max connections reached")
            return
        
        # Create connection object
        client = ClientConnection(websocket, client_id)
        self._clients[client_id] = client
        
        logger.info(f"Client connected: {client_id}, total: {len(self._clients)}")
        
        # Send welcome message
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
        """Process message"""
        msg_type = message.type
        
        # Update heartbeat
        client.last_ping = time.time()
        
        # Find handler
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
            # Unknown message type
            logger.warning(f"Unknown message type: {msg_type}")
    
    async def _heartbeat(self) -> None:
        """Heartbeat task"""
        while self._running:
            await asyncio.sleep(self.heartbeat_interval)
            
            # Check all clients
            dead_clients = []
            for client_id, client in self._clients.items():
                if time.time() - client.last_ping > self.heartbeat_interval * 2:
                    logger.warning(f"Client {client_id} heartbeat timeout")
                    dead_clients.append(client_id)
            
            # Remove timeout clients
            for client_id in dead_clients:
                try:
                    await self._clients[client_id].websocket.close()
                except:
                    pass
                if client_id in self._clients:
                    del self._clients[client_id]
            
            # Send heartbeat
            heartbeat = WSMessage(WSMessageType.HEARTBEAT, data={
                "server_time": time.time(),
                "connected_clients": len(self._clients)
            })
            
            await self.broadcast(heartbeat)
    
    async def broadcast(self, message: WSMessage) -> int:
        """Broadcast message to all clients"""
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
        """Send to specific client"""
        client = self._clients.get(client_id)
        if client:
            return await client.send(message)
        return False
    
    async def broadcast_frame_result(self, result: dict) -> int:
        """Broadcast frame result"""
        message = WSMessage(WSMessageType.FRAME_RESULT, data=result)
        return await self.broadcast(message)
    
    async def broadcast_state_change(self, old_state: str, new_state: str, reason: str) -> int:
        """Broadcast state change"""
        message = WSMessage(WSMessageType.STATE_CHANGE, data={
            "old_state": old_state,
            "new_state": new_state,
            "reason": reason
        })
        return await self.broadcast(message)
    
    async def broadcast_milestone(self, milestone: dict) -> int:
        """Broadcast milestone"""
        message = WSMessage(WSMessageType.MILESTONE, data=milestone)
        return await self.broadcast(message)
    
    async def start(self) -> None:
        """Start server"""
        if self._running:
            logger.warning("Server already running")
            return
        
        self._running = True
        
        # Start heartbeat task
        self._heartbeat_task = asyncio.create_task(self._heartbeat())
        
        # Start server
        self._server = await serve(
            self._handle_client,
            self.host,
            self.port,
            ping_interval=None  # Disable auto-ping, use custom heartbeat
        )
        
        logger.info(f"WebSocket server started: ws://{self.host}:{self.port}")
    
    async def stop(self) -> None:
        """Stop server"""
        if not self._running:
            return
        
        self._running = False
        
        # Stop heartbeat
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        
        # Close server
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        
        # Close all clients
        for client_id, client in list(self._clients.items()):
            try:
                await client.websocket.close()
            except:
                pass
        
        self._clients.clear()
        
        logger.info("WebSocket server stopped")
    
    @property
    def is_running(self) -> bool:
        """Server running status"""
        return self._running
    
    @property
    def client_count(self) -> int:
        """Current connection count"""
        return len(self._clients)


class WebSocketClient:
    """WebSocket Client (for testing or connecting to other servers)"""
    
    def __init__(
        self,
        url: str,
        on_message: Optional[Callable[[WSMessage], None]] = None,
        on_connect: Optional[Callable[[], None]] = None,
        on_disconnect: Optional[Callable[[], None]] = None
    ):
        """
        Initialize client
        
        Args:
            url: Server URL
            on_message: Message callback
            on_connect: Connect callback
            on_disconnect: Disconnect callback
        """
        self.url = url
        self.on_message = on_message
        self.on_connect = on_connect
        self.on_disconnect = on_disconnect
        
        self._websocket: Optional[WebSocketServerProtocol] = None
        self._running = False
        self._receive_task: Optional[asyncio.Task] = None
    
    async def connect(self) -> bool:
        """Connect to server"""
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
        """Disconnect"""
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
        """Send message"""
        if self._websocket:
            try:
                await self._websocket.send(message.to_json())
                return True
            except Exception as e:
                logger.error(f"Failed to send message: {e}")
        return False
    
    async def send_command(self, command: str, data: Optional[dict] = None) -> bool:
        """Send command"""
        message = WSMessage(command, data=data)
        return await self.send(message)
    
    async def _receive_loop(self) -> None:
        """Receive message loop"""
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
        """Start receiving messages"""
        self._receive_task = asyncio.create_task(self._receive_loop())
    
    @property
    def is_connected(self) -> bool:
        """Connection status"""
        return self._websocket is not None and self._running
