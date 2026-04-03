"""
Focus Island — 房间信令服务器 (Room-based WebSocket Signaling Server)
用于 WebRTC P2P 握手的牵线搭桥，不转发视频流。

架构：
  FastAPI ASGI (Uvicorn) + WebSocket 路由
  内存字典 rooms = { room_id: [client_ws, ...] }
  当收到 SDP / ICE 消息时，只广播给同房间的其他客户端。

Author: SSP Team
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import sys
import time
from typing import Any

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
#  FastAPI App
# ──────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Focus Island — Room Signaling Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────────────
#  In-memory room state
# ──────────────────────────────────────────────────────────────────────────────

# rooms: dict[str, list[WebSocket]]
# user_meta: dict[WebSocket, dict]   — stores { "room_id", "user_name", "joined_at" }
rooms: dict[str, list[WebSocket]] = {}
user_meta: dict[WebSocket, dict] = {}

# ──────────────────────────────────────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _ensure_room(room_id: str) -> list[WebSocket]:
    if room_id not in rooms:
        rooms[room_id] = []
        logger.info(f"[Room] Created room: {room_id}")
    return rooms[room_id]


def _broadcast(room_id: str, payload: dict, exclude: WebSocket | None = None) -> None:
    """Send JSON payload to every client in the room except `exclude`."""
    if room_id not in rooms:
        return
    dead = []
    for ws in rooms[room_id]:
        if ws is exclude:
            continue
        try:
            asyncio.create_task(ws.send_json(payload))
        except Exception:
            dead.append(ws)
    # prune dead connections
    for ws in dead:
        _disconnect(ws)


def _disconnect(ws: WebSocket) -> None:
    """Remove a client from its room and clean up empty rooms."""
    meta = user_meta.pop(ws, {})
    room_id = meta.get("room_id")
    if room_id and room_id in rooms:
        try:
            rooms[room_id].remove(ws)
        except ValueError:
            pass
        if not rooms[room_id]:
            del rooms[room_id]
            logger.info(f"[Room] Deleted empty room: {room_id}")


def _generate_room_id(length: int = 6) -> str:
    """Generate a human-friendly alphanumeric invite code."""
    return secrets.token_urlsafe(length)[:length].upper()


# ──────────────────────────────────────────────────────────────────────────────
#  REST endpoints (info / invite-code generation)
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": time.time(), "rooms": len(rooms)}


@app.get("/api/room/new")
async def create_room(user_name: str = "Host"):
    """Create a new private room and return its invite code (room_id)."""
    room_id = _generate_room_id()
    _ensure_room(room_id)
    logger.info(f"[Room] Created by '{user_name}': {room_id}")
    return {"room_id": room_id, "user_name": user_name}


@app.get("/api/room/{room_id}/info")
async def room_info(room_id: str):
    """Return participant count for a room."""
    count = len(rooms.get(room_id, []))
    return {"room_id": room_id, "participant_count": count, "exists": room_id in rooms}


# ──────────────────────────────────────────────────────────────────────────────
#  WebSocket endpoint  /ws/room
#
#  Client message protocol (client → server):
#    { "type": "create_room",   "user_name": "Alex" }
#    { "type": "join_room",     "room_id": "ABC123", "user_name": "Emma" }
#    { "type": "leave_room" }
#    { "type": "offer",         "target": "client_id", "sdp": {...} }
#    { "type": "answer",        "target": "client_id", "sdp": {...} }
#    { "type": "ice_candidate", "target": "client_id", "candidate": {...} }
#    { "type": "chat",          "text": "hello" }
#
#  Server message protocol (server → client):
#    { "type": "room_created",  "room_id": "ABC123" }
#    { "type": "room_joined",   "room_id": "ABC123", "participants": [...] }
#    { "type": "participant_joined",  "user_name": "Emma", "client_id": "..." }
#    { "type": "participant_left",    "client_id": "..." }
#    { "type": "offer",         "from": "client_id", "sdp": {...} }
#    { "type": "answer",        "from": "client_id", "sdp": {...} }
#    { "type": "ice_candidate", "from": "client_id", "candidate": {...} }
#    { "type": "chat",          "from": "client_id", "text": "hello", "ts": 123 }
#    { "type": "room_full" | "room_not_found" | "error", "message": "..." }
# ──────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/room")
async def room_ws(websocket: WebSocket):
    client_id: str = f"c_{secrets.token_hex(4)}"
    await websocket.accept()
    logger.info(f"[WS] Client connected: {client_id}")

    meta: dict[str, Any] = {"client_id": client_id, "joined_at": time.time()}
    user_meta[websocket] = meta

    try:
        # Send client their own ID
        await websocket.send_json({"type": "connected", "client_id": client_id})

        async for raw in websocket.iter_text():
            try:
                msg: dict = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type", "")
            room_id = meta.get("room_id")

            # ── create_room ──────────────────────────────────────────────────
            if msg_type == "create_room":
                user_name = msg.get("user_name", "Host")
                new_room = _generate_room_id()
                _ensure_room(new_room)
                rooms[new_room].append(websocket)
                meta["room_id"] = new_room
                meta["user_name"] = user_name
                logger.info(f"[Room] {client_id} created room {new_room}")
                await websocket.send_json({
                    "type": "room_created",
                    "room_id": new_room,
                })

            # ── join_room ─────────────────────────────────────────────────────
            elif msg_type == "join_room":
                target_room = msg.get("room_id", "").strip().upper()
                user_name = msg.get("user_name", "Guest")
                if not target_room:
                    await websocket.send_json({"type": "error", "message": "room_id is required"})
                    continue

                if target_room not in rooms:
                    await websocket.send_json({"type": "room_not_found", "room_id": target_room})
                    continue

                # Leave previous room if any
                if room_id:
                    _disconnect(websocket)
                    # Re-fetch list after disconnect
                    if target_room in rooms:
                        rooms[target_room].append(websocket)

                rooms[target_room].append(websocket)
                meta["room_id"] = target_room
                meta["user_name"] = user_name

                participants = [
                    {"client_id": user_meta[w].get("client_id"), "user_name": user_meta[w].get("user_name", "?")}
                    for w in rooms.get(target_room, [])
                    if w in user_meta
                ]
                logger.info(f"[Room] {client_id} ('{user_name}') joined {target_room} ({len(participants)} participants)")

                # Confirm to joiner
                await websocket.send_json({
                    "type": "room_joined",
                    "room_id": target_room,
                    "participants": participants,
                })
                # Notify others
                _broadcast(target_room, {
                    "type": "participant_joined",
                    "client_id": client_id,
                    "user_name": user_name,
                }, exclude=websocket)

            # ── leave_room ─────────────────────────────────────────────────────
            elif msg_type == "leave_room":
                if room_id:
                    _broadcast(room_id, {
                        "type": "participant_left",
                        "client_id": client_id,
                    })
                    _disconnect(websocket)
                    meta["room_id"] = None
                    logger.info(f"[Room] {client_id} left room")

            # ── offer / answer / ice_candidate ────────────────────────────────
            elif msg_type in ("offer", "answer", "ice_candidate"):
                target = msg.get("target", "")
                if not target:
                    await websocket.send_json({"type": "error", "message": "target is required"})
                    continue
                # Forward to the specific client
                if room_id and room_id in rooms:
                    for peer in rooms[room_id]:
                        if user_meta.get(peer, {}).get("client_id") == target:
                            try:
                                await peer.send_json({
                                    "type": msg_type,
                                    "from": client_id,
                                    **({k: v for k, v in msg.items() if k not in ("type", "target")}),
                                })
                            except Exception:
                                pass
                            break

            # ── chat ──────────────────────────────────────────────────────────
            elif msg_type == "chat":
                text = str(msg.get("text", ""))[:500]
                if room_id and text:
                    _broadcast(room_id, {
                        "type": "chat",
                        "from": client_id,
                        "user_name": meta.get("user_name", "?"),
                        "text": text,
                        "ts": time.time(),
                    }, exclude=websocket)

            # ── ping / pong ───────────────────────────────────────────────────
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            else:
                await websocket.send_json({"type": "error", "message": f"Unknown type: {msg_type}"})

    except WebSocketDisconnect:
        logger.info(f"[WS] Client disconnected: {client_id}")
    except Exception as e:
        logger.exception(f"[WS] Error from {client_id}: {e}")
    finally:
        _disconnect(websocket)


# ──────────────────────────────────────────────────────────────────────────────
#  Entry point
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Focus Island — Room Signaling Server")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()

    logger.info(f"Starting Room Signaling Server on ws://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
