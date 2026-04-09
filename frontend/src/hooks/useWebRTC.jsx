/**
 * useWebRTC — WebRTC Mesh peer connection + Focus Island room signaling hook.
 *
 * Handles: WebRTC mesh peer connections (video/audio P2P) via signaling server,
 *          and room-level data: chat, reactions, hand-raise, focus scores.
 *
 * Signaling server: read from Vite define: __FOCUS_ISLAND_ROOM_WS_URL__
 *  (falls back to ws://127.0.0.1:8766/ws/room)
 *
 * Message protocol:
 *  send  create_room / join_room / leave_room / offer / answer / ice_candidate
 *        chat / reaction / hand_raise / focus_update / get_chat_history / get_focus_data
 *  recv  connected / room_created / room_joined / participant_joined / participant_left /
 *        offer / answer / ice_candidate / chat / chat_history /
 *        reaction / hand_raise / focus_update / focus_data / room_not_found / error
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
} from 'react';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function getSignalUrl() {
  if (typeof __FOCUS_ISLAND_ROOM_WS_URL__ !== 'undefined') {
    return String(__FOCUS_ISLAND_ROOM_WS_URL__);
  }
  const p =
    typeof __FOCUS_ISLAND_ROOM_WS_PORT__ !== 'undefined'
      ? Number(__FOCUS_ISLAND_ROOM_WS_PORT__)
      : 8766;
  return `ws://127.0.0.1:${p}/ws/room`;
}

const WebRTCContext = createContext(null);

// Reconnect attempt settings
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 3000;

export function WebRTCProvider({ children }) {
  const wsRef = useRef(null);
  const myClientIdRef = useRef(null);
  const pendingIntentRef = useRef(null);
  const connectTimeoutRef = useRef(null);

  const [myClientId, setMyClientId] = useState(null);
  const [myRoomId, setMyRoomId] = useState(null);
  const [userName, setUserName] = useState('');
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [signalingState, setSignalingState] = useState('disconnected');
  const [roomError, setRoomError] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const reconnectAttemptsRef = useRef(0);

  // ── Room data ────────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState([]);
  const [reactions, setReactions] = useState([]); // [{from, user_name, reaction, ts}]
  const [focusData, setFocusData] = useState({}); // { clientId: {focus_state, ear, focus_time, points, hand_up, user_name} }

  const peersRef = useRef({});

  const sendWs = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const requestCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
        audio: true,
      });
      setLocalStream(stream);
      setCameraError(null);
      return stream;
    } catch (err) {
      setCameraError(err.message || 'Camera access denied');
      return null;
    }
  }, []);

  const releaseCamera = useCallback(() => {
    setLocalStream((prev) => {
      if (prev) prev.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const attachStream = useCallback((clientId, stream) => {
    setRemoteStreams((prev) => ({ ...prev, [clientId]: stream }));
  }, []);

  const detachStream = useCallback((clientId) => {
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
  }, []);

  const closePeerConnection = useCallback((targetClientId) => {
    const pc = peersRef.current[targetClientId];
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange = null;
      try { pc.close(); } catch { /* ignore */ }
      delete peersRef.current[targetClientId];
    }
  }, []);

  const createPeerConnection = useCallback(
    (targetClientId) => {
      if (peersRef.current[targetClientId]) {
        return peersRef.current[targetClientId];
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peersRef.current[targetClientId] = pc;

      if (localStream) {
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
      }

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          sendWs({ type: 'ice_candidate', target: targetClientId, candidate });
        }
      };

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteStream) attachStream(targetClientId, remoteStream);
      };

      pc.oniceconnectionstatechange = () => {
        if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
          closePeerConnection(targetClientId);
          detachStream(targetClientId);
        }
      };

      return pc;
    },
    [localStream, sendWs, attachStream, detachStream, closePeerConnection]
  );

  // ── Reaction auto-cleanup ─────────────────────────────────────────────────
  const reactionTimeoutsRef = useRef({});
  const addReaction = useCallback((entry) => {
    setReactions((prev) => {
      const next = [...prev, entry];
      return next.length > 30 ? next.slice(-30) : next;
    });
    // Remove after 4 s
    const id = entry.ts;
    if (reactionTimeoutsRef.current[id]) clearTimeout(reactionTimeoutsRef.current[id]);
    reactionTimeoutsRef.current[id] = setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.ts !== id));
      delete reactionTimeoutsRef.current[id];
    }, 4000);
  }, []);

  // ── Signaling handler ──────────────────────────────────────────────────────
  const handleSignalingMessage = useCallback(
    async (msg) => {
      const { type } = msg;

      if (type === 'connected') {
        myClientIdRef.current = msg.client_id;
        setMyClientId(msg.client_id);

        const pending = pendingIntentRef.current;
        pendingIntentRef.current = null;
        if (pending?.kind === 'create') {
          sendWs({ type: 'create_room', user_name: pending.userName });
        } else if (pending?.kind === 'join') {
          sendWs({
            type: 'join_room',
            room_id: pending.roomId,
            user_name: pending.userName,
          });
        }
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        return;
      }

      if (type === 'room_created' || type === 'room_joined') {
        setMyRoomId(msg.room_id);
        setSignalingState('in_room');
        setRoomError(null);
        if (typeof msg.is_host === 'boolean') {
          setIsHost(msg.is_host);
        }

        const existing = msg.participants || [];
        const sid = myClientIdRef.current;
        for (const p of existing) {
          if (p.client_id === sid) continue;
          createPeerConnection(p.client_id);
        }
        setParticipants(existing.filter((p) => p.client_id !== sid));
        return;
      }

      if (type === 'participant_joined') {
        const { client_id, user_name } = msg;
        if (client_id === myClientIdRef.current) return;

        const pc = createPeerConnection(client_id);

        if (localStream) {
          localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
        }

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendWs({ type: 'offer', target: client_id, sdp: pc.localDescription });
        } catch (err) {
          console.error('[WebRTC] offer error:', err);
        }

        setParticipants((prev) => {
          if (prev.find((p) => p.client_id === client_id)) return prev;
          return [...prev, { client_id, user_name }];
        });
        return;
      }

      if (type === 'participant_left') {
        const { client_id } = msg;
        closePeerConnection(client_id);
        detachStream(client_id);
        setParticipants((prev) => prev.filter((p) => p.client_id !== client_id));
        setFocusData((prev) => {
          const next = { ...prev };
          delete next[client_id];
          return next;
        });
        return;
      }

      if (type === 'offer') {
        const { from, sdp } = msg;
        const pc = createPeerConnection(from);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          if (localStream) {
            localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWs({ type: 'answer', target: from, sdp: pc.localDescription });
        } catch (err) {
          console.error('[WebRTC] answer error:', err);
        }
        return;
      }

      if (type === 'answer') {
        const { from, sdp } = msg;
        const pc = peersRef.current[from];
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          } catch (err) {
            console.error('[WebRTC] remote description error:', err);
          }
        }
        return;
      }

      if (type === 'ice_candidate') {
        const { from, candidate } = msg;
        const pc = peersRef.current[from];
        if (pc && candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error('[WebRTC] addIceCandidate error:', err);
          }
        }
        return;
      }

      // ── Room data ────────────────────────────────────────────��───────────
      if (type === 'chat') {
        setChatMessages((prev) => {
          const next = [...prev, msg];
          return next.length > 200 ? next.slice(-200) : next;
        });
        return;
      }

      if (type === 'chat_history') {
        setChatMessages(Array.isArray(msg.messages) ? msg.messages : []);
        return;
      }

      if (type === 'reaction') {
        addReaction(msg);
        return;
      }

      if (type === 'hand_raise') {
        const { from, user_name, raised } = msg;
        setFocusData((prev) => ({
          ...prev,
          [from]: {
            ...(prev[from] || {}),
            hand_up: raised,
            user_name: user_name || prev[from]?.user_name,
          },
        }));
        return;
      }

      if (type === 'focus_update') {
        const { from, user_name, focus_state, ear, focus_time, points } = msg;
        setFocusData((prev) => ({
          ...prev,
          [from]: {
            ...(prev[from] || {}),
            focus_state: focus_state || 'idle',
            ear: ear || 0,
            focus_time: focus_time || 0,
            points: points || 0,
            user_name: user_name || prev[from]?.user_name,
          },
        }));
        return;
      }

      if (type === 'focus_data') {
        setFocusData(typeof msg.data === 'object' && msg.data ? msg.data : {});
        return;
      }

      if (type === 'room_not_found') {
        setRoomError(`Room "${msg.room_id}" does not exist.`);
        setSignalingState('disconnected');
        return;
      }

      if (type === 'error') {
        setRoomError(msg.message || 'Signaling error');
      }
    },
    [
      localStream,
      createPeerConnection,
      closePeerConnection,
      detachStream,
      sendWs,
      addReaction,
    ]
  );

  const handlerRef = useRef(handleSignalingMessage);
  handlerRef.current = handleSignalingMessage;

  const connectSignaling = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }

    setSignalingState('connecting');
    setRoomError(null);

    void (async () => {
      let url = getSignalUrl();
      try {
        if (typeof window !== 'undefined' && window.electronAPI?.getRoomSignaling) {
          const r = await window.electronAPI.getRoomSignaling();
          if (r?.url && typeof r.url === 'string') {
            url = r.url;
          }
        }
      } catch (e) {
        console.warn('[WebRTC] getRoomSignaling IPC failed, using build-time URL', e);
      }

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        return;
      }

      const ws = new WebSocket(url);
      wsRef.current = ws;

      connectTimeoutRef.current = setTimeout(() => {
        if (wsRef.current === ws && ws.readyState !== WebSocket.OPEN) {
          // Attempt to retry connection if we haven't exceeded max attempts
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current += 1;
            console.log(`[WebRTC] Connection attempt ${reconnectAttemptsRef.current} failed, retrying in ${RECONNECT_DELAY_MS}ms...`);
            ws.close();
            setTimeout(() => {
              reconnectAttemptsRef.current = 0; // Reset for next attempt
              connectSignaling();
            }, RECONNECT_DELAY_MS);
          } else {
            setRoomError(
              'Signaling server unreachable. Start the room server (port 8766) or check firewall.'
            );
            setSignalingState('disconnected');
            reconnectAttemptsRef.current = 0;
            try { ws.close(); } catch { /* ignore */ }
          }
        }
      }, 12000);

      ws.onopen = () => {
        console.log('[WebRTC] Signaling connected', url);
        reconnectAttemptsRef.current = 0; // Reset on successful connection
      };

      ws.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data));
        } catch (err) {
          console.error('[WebRTC] Failed to parse signaling message:', err);
        }
      };

      ws.onerror = () => {
        console.error('[WebRTC] Signaling WebSocket error');
        // Let the timeout handle retry logic
      };

      ws.onclose = () => {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        console.log('[WebRTC] Signaling disconnected');
        setSignalingState((s) => (s === 'in_room' ? s : 'disconnected'));
      };
    })();
  }, []);

  const createRoom = useCallback(
    (name) => {
      const uname = name || 'Host';
      setUserName(uname);
      pendingIntentRef.current = { kind: 'create', userName: uname };
      setIsHost(true);
      connectSignaling();
    },
    [connectSignaling]
  );

  const joinRoom = useCallback(
    (roomId, name) => {
      const uname = name || 'Guest';
      setUserName(uname);
      pendingIntentRef.current = {
        kind: 'join',
        roomId: String(roomId || '').trim().toUpperCase(),
        userName: uname,
      };
      setIsHost(false);
      connectSignaling();
    },
    [connectSignaling]
  );

  const leaveRoom = useCallback(() => {
    sendWs({ type: 'leave_room' });
    Object.keys(peersRef.current).forEach((cid) => {
      closePeerConnection(cid);
      detachStream(cid);
    });
    setParticipants([]);
    setMyRoomId(null);
    myClientIdRef.current = null;
    setMyClientId(null);
    setIsHost(false);
    setSignalingState('disconnected');
    pendingIntentRef.current = null;
    setChatMessages([]);
    setReactions([]);
    setFocusData({});
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    releaseCamera();
  }, [sendWs, closePeerConnection, detachStream, releaseCamera]);

  // ── Room data actions ──────────────────────────────────────────────────────
  const sendChatMessage = useCallback(
    (text) => {
      if (!text?.trim()) return;
      sendWs({ type: 'chat', text: text.trim() });
    },
    [sendWs]
  );

  const sendReaction = useCallback(
    (reaction) => {
      sendWs({ type: 'reaction', reaction });
    },
    [sendWs]
  );

  const sendHandRaise = useCallback(
    (raised) => {
      sendWs({ type: 'hand_raise', raised });
    },
    [sendWs]
  );

  const sendFocusUpdate = useCallback(
    (focus_state, ear, focus_time, points) => {
      sendWs({
        type: 'focus_update',
        focus_state: String(focus_state || 'idle'),
        ear: Number(ear || 0),
        focus_time: Number(focus_time || 0),
        points: Number(points || 0),
      });
    },
    [sendWs]
  );

  const getChatHistory = useCallback(() => {
    sendWs({ type: 'get_chat_history' });
  }, [sendWs]);

  const getFocusData = useCallback(() => {
    sendWs({ type: 'get_focus_data' });
  }, [sendWs]);

  // ── When local stream becomes available ─────────────────────────────────
  useEffect(() => {
    if (!localStream) return;
    Object.values(peersRef.current).forEach((pc) => {
      localStream.getTracks().forEach((track) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch(() => {});
        } else {
          pc.addTrack(track, localStream).catch(() => {});
        }
      });
    });
  }, [localStream]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(
    () => () => {
      sendWs({ type: 'leave_room' });
      Object.keys(peersRef.current).forEach((cid) => {
        const pc = peersRef.current[cid];
        if (pc) {
          try { pc.close(); } catch { /* ignore */ }
          delete peersRef.current[cid];
        }
      });
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    },
    [sendWs]
  );

  // ── On entering room: request history + focus data ─────────────────────────
  useEffect(() => {
    if (signalingState === 'in_room') {
      getChatHistory();
      getFocusData();
    }
  }, [signalingState]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    // Identity
    myClientId,
    myRoomId,
    userName,
    participants,
    localStream,
    remoteStreams,
    cameraError,
    signalingState,
    roomError,
    isHost,

    // Room data
    chatMessages,
    reactions,
    focusData,

    // Actions
    requestCamera,
    releaseCamera,
    createRoom,
    joinRoom,
    leaveRoom,
    sendChatMessage,
    sendReaction,
    sendHandRaise,
    sendFocusUpdate,
    getChatHistory,
    getFocusData,
  };

  return <WebRTCContext.Provider value={value}>{children}</WebRTCContext.Provider>;
}

export function useWebRTC() {
  const ctx = useContext(WebRTCContext);
  if (!ctx) throw new Error('useWebRTC must be used within WebRTCProvider');
  return ctx;
}
