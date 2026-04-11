"""
Focus Island — Room Signaling Server (Room-based WebSocket Signaling Server)
For WebRTC P2P handshake signaling, does not forward video streams.

Architecture:
  FastAPI ASGI (Uvicorn) + WebSocket routing
  In-memory dict rooms = { room_id: [client_ws, ...] }
  When receiving SDP / ICE messages, only broadcast to other clients in the same room.

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
from websockets.exceptions import ConnectionClosed, ConnectionClosedOK

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
focus_data: dict[str, dict] = {}  # room_id → { client_id: {ear, state, focus_time, points, hand_up} }
chat_history: dict[str, list[dict]] = {}  # room_id → [{from, user_name, text, ts}]
# Only keep last 200 messages per room
MAX_CHAT_HISTORY = 200

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
            # Use websockets-friendly check before sending
            if ws.client_state == ws.CLIENT_CONNECTED:
                asyncio.create_task(ws.send_json(payload))
        except (ConnectionClosedOK, ConnectionClosed):
            dead.append(ws)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _disconnect(ws)


def _send_to(ws: WebSocket, payload: dict) -> None:
    """Send JSON payload to a single client."""
    try:
        if ws.client_state == ws.CLIENT_CONNECTED:
            asyncio.create_task(ws.send_json(payload))
    except (ConnectionClosedOK, ConnectionClosed):
        _disconnect(ws)
    except Exception:
        pass


def _disconnect(ws: WebSocket) -> None:
    """Remove a client from its room and clean up empty rooms."""
    meta = user_meta.pop(ws, {})
    room_id = meta.get("room_id")
    cid = meta.get("client_id")
    if room_id and room_id in rooms:
        try:
            rooms[room_id].remove(ws)
        except ValueError:
            pass
        # Broadcast hand_down when participant leaves
        if cid and room_id in rooms:
            for peer in rooms[room_id]:
                _send_to(peer, {
                    "type": "hand_raise",
                    "from": cid,
                    "user_name": meta.get("user_name", "?"),
                    "raised": False,
                })
        if not rooms[room_id]:
            del rooms[room_id]
            if room_id in chat_history:
                del chat_history[room_id]
            if room_id in focus_data:
                del focus_data[room_id]
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


@app.get("/api/room/server-info")
async def get_server_info():
    """Return server info for clients to configure signaling connection."""
    import socket
    hostname = socket.gethostname()
    try:
        # 获取本机局域网 IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "127.0.0.1"
    
    return {
        "status": "ok",
        "hostname": hostname,
        "local_ip": local_ip,
        "default_port": 8766,
        "ws_path": "/ws/room",
        "ws_url_template": f"ws://{{host}}:{8766}/ws/room"
    }


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
#  Client → Server message types:
#    { "type": "create_room",   "user_name": "Alex" }
#    { "type": "join_room",     "room_id": "ABC123", "user_name": "Emma" }
#    { "type": "leave_room" }
#    { "type": "offer",         "target": "client_id", "sdp": {...} }
#    { "type": "answer",        "target": "client_id", "sdp": {...} }
#    { "type": "ice_candidate", "target": "client_id", "candidate": {...} }
#    { "type": "chat",          "text": "hello" }
#    { "type": "reaction",       "reaction": "thumbsup" | "clap" | "heart" | "hand" }
#    { "type": "hand_raise",     "raised": true | false }
#    { "type": "focus_update",    "focus_state": "focused"|"warning"|"idle", "ear": 0.28, "focus_time": 120, "points": 50 }
#    { "type": "get_chat_history" }
#    { "type": "get_focus_data" }
#
#  Server → Client message types:
#    { "type": "room_created",  "room_id": "ABC123", "participants": [...], "is_host": bool }
#    { "type": "room_joined",   "room_id": "ABC123", "participants": [...], "is_host": bool }
#    { "type": "participant_joined",  "user_name": "Emma", "client_id": "..." }
#    { "type": "participant_left",    "client_id": "..." }
#    { "type": "offer"|"answer"|"ice_candidate", "from": "client_id", ... }
#    { "type": "chat",  "from": "client_id", "user_name": "?", "text": "...", "ts": float }
#    { "type": "reaction", "from": "client_id", "user_name": "?", "reaction": "thumbsup" }
#    { "type": "hand_raise", "from": "client_id", "user_name": "?", "raised": true }
#    { "type": "focus_update", "from": "client_id", "user_name": "?", "focus_state": "...", "ear": 0.28, "focus_time": 120, "points": 50 }
#    { "type": "chat_history", "messages": [...] }
#    { "type": "focus_data", "data": { "client_id": {focus_state,ear,focus_time,points,hand_up} } }
#    { "type": "room_not_found"|"error", "message": "..." }
# ──────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/room")
async def room_ws(websocket: WebSocket):
    client_id: str = f"c_{secrets.token_hex(4)}"
    await websocket.accept()
    logger.info(f"[WS] Client connected: {client_id}")

    meta: dict[str, Any] = {"client_id": client_id, "joined_at": time.time()}
    user_meta[websocket] = meta

    # Helper to safely send JSON, catching connection closed errors
    async def safe_send(msg: dict) -> bool:
        try:
            await websocket.send_json(msg)
            return True
        except WebSocketDisconnect:
            logger.info(f"[Room] Client {client_id} disconnected during send")
            raise  # Re-raise so the outer handler can clean up
        except Exception as e:
            logger.warning(f"[Room] Failed to send to {client_id}: {e}")
            return False

    try:
        # Send client their own ID
        await websocket.send_json({"type": "connected", "client_id": client_id})

        async for raw in websocket.iter_text():
            try:
                msg: dict = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(f"[Room] Received invalid JSON from {client_id}: {raw}")
                await safe_send({"type": "error", "message": "Invalid JSON"})
                continue

            logger.info(f"[Room] Message from {client_id}: type={msg.get('type')}, msg={msg}")
            msg_type = msg.get("type", "")
            room_id = meta.get("room_id")

            # ── create_room ──────────────────────────────────────────────────
            if msg_type == "create_room":
                logger.info(f"[Room] Received create_room from {client_id}: {msg}")
                user_name = msg.get("user_name", "Host")
                new_room = _generate_room_id()
                _ensure_room(new_room)
                rooms[new_room].append(websocket)
                meta["room_id"] = new_room
                meta["user_name"] = user_name
                meta["is_host"] = True
                logger.info(f"[Room] {client_id} created room {new_room}")
                await safe_send({
                    "type": "room_created",
                    "room_id": new_room,
                    "participants": [
                        {"client_id": client_id, "user_name": user_name},
                    ],
                    "is_host": True,
                })
                logger.info(f"[Room] Sent room_created response to {client_id}")

            # ── join_room ─────────────────────────────────────────────────────
            elif msg_type == "join_room":
                target_room = msg.get("room_id", "").strip().upper()
                user_name = msg.get("user_name", "Guest")
                if not target_room:
                    await safe_send({"type": "error", "message": "room_id is required"})
                    continue

                if target_room not in rooms:
                    await safe_send({"type": "room_not_found", "room_id": target_room})
                    continue

                # Leave previous room if any (re-register websocket in user_meta after _disconnect)
                if room_id:
                    _disconnect(websocket)
                    user_meta[websocket] = meta

                if websocket not in rooms[target_room]:
                    rooms[target_room].append(websocket)
                meta["room_id"] = target_room
                meta["user_name"] = user_name
                meta["is_host"] = False

                participants = [
                    {"client_id": user_meta[w].get("client_id"), "user_name": user_meta[w].get("user_name", "?")}
                    for w in rooms.get(target_room, [])
                    if w in user_meta
                ]
                logger.info(f"[Room] {client_id} ('{user_name}') joined {target_room} ({len(participants)} participants)")

                # Confirm to joiner
                await safe_send({
                    "type": "room_joined",
                    "room_id": target_room,
                    "participants": participants,
                    "is_host": False,
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
                    await safe_send({"type": "error", "message": "target is required"})
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
                    chat_entry = {
                        "type": "chat",
                        "from": client_id,
                        "user_name": meta.get("user_name", "?"),
                        "text": text,
                        "ts": time.time(),
                    }
                    # Store in history (up to MAX_CHAT_HISTORY per room)
                    if room_id not in chat_history:
                        chat_history[room_id] = []
                    chat_history[room_id].append(chat_entry)
                    if len(chat_history[room_id]) > MAX_CHAT_HISTORY:
                        chat_history[room_id] = chat_history[room_id][-MAX_CHAT_HISTORY:]
                    # Echo to sender + broadcast to others
                    _send_to(websocket, chat_entry)
                    _broadcast(room_id, chat_entry, exclude=websocket)

            # ── reaction ──────────────────────────────────────────────────────
            elif msg_type == "reaction":
                reaction = str(msg.get("reaction", ""))[:20]
                if room_id and reaction in ("thumbsup", "clap", "heart", "laugh"):
                    payload = {
                        "type": "reaction",
                        "from": client_id,
                        "user_name": meta.get("user_name", "?"),
                        "reaction": reaction,
                        "ts": time.time(),
                    }
                    # Broadcast to all including sender so they see their own reaction
                    if room_id in rooms:
                        for ws in rooms[room_id]:
                            _send_to(ws, payload)

            # ── hand_raise ───────────────────────────────────────────────────
            elif msg_type == "hand_raise":
                raised = bool(msg.get("raised", False))
                if room_id:
                    # Update focus_data for this room/client
                    if room_id not in focus_data:
                        focus_data[room_id] = {}
                    if client_id not in focus_data[room_id]:
                        focus_data[room_id][client_id] = {}
                    focus_data[room_id][client_id]["hand_up"] = raised
                    focus_data[room_id][client_id]["user_name"] = meta.get("user_name", "?")
                    payload = {
                        "type": "hand_raise",
                        "from": client_id,
                        "user_name": meta.get("user_name", "?"),
                        "raised": raised,
                    }
                    if room_id in rooms:
                        for ws in rooms[room_id]:
                            _send_to(ws, payload)

            # ── focus_update ─────────────────────────────────────────────────
            elif msg_type == "focus_update":
                if room_id:
                    focus_state_val = str(msg.get("focus_state", "idle"))[:20]
                    ear = float(msg.get("ear", 0))
                    focus_time = int(msg.get("focus_time", 0))
                    points = int(msg.get("points", 0))
                    if room_id not in focus_data:
                        focus_data[room_id] = {}
                    focus_data[room_id][client_id] = {
                        "focus_state": focus_state_val,
                        "ear": ear,
                        "focus_time": focus_time,
                        "points": points,
                        "hand_up": focus_data[room_id].get(client_id, {}).get("hand_up", False),
                        "user_name": meta.get("user_name", "?"),
                        "last_update": time.time(),
                    }
                    payload = {
                        "type": "focus_update",
                        "from": client_id,
                        "user_name": meta.get("user_name", "?"),
                        "focus_state": focus_state_val,
                        "ear": ear,
                        "focus_time": focus_time,
                        "points": points,
                    }
                    if room_id in rooms:
                        for ws in rooms[room_id]:
                            _send_to(ws, payload)

            # ── get_chat_history ──────────────────────────────────────────────
            elif msg_type == "get_chat_history":
                if room_id:
                    history = list(chat_history.get(room_id, []))
                    await websocket.send_json({"type": "chat_history", "messages": history})

            # ── get_focus_data ────────────────────────────────────────────────
            elif msg_type == "get_focus_data":
                if room_id:
                    data = dict(focus_data.get(room_id, {}))
                    await websocket.send_json({"type": "focus_data", "data": data})

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
