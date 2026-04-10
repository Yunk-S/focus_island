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
  const isSocketReadyRef = useRef(false);  // Track if socket is truly ready to send
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
    const ws = wsRef.current;
    // Use isSocketReadyRef or check readyState to ensure socket is ready
    if (ws && (isSocketReadyRef.current || ws.readyState === WebSocket.OPEN)) {
      console.log('[WebRTC] sendWs:', JSON.stringify(msg));
      try {
        ws.send(JSON.stringify(msg));
        return;
      } catch (e) {
        console.error('[WebRTC] sendWs error:', e);
      }
    }
    console.warn('[WebRTC] sendWs failed: WebSocket not available, readyState:', ws?.readyState, 'isSocketReady:', isSocketReadyRef.current);
  }, []);

  const localStreamRef = useRef(null);
  
  const requestCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
        audio: true,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraError(null);
      return stream;
    } catch (err) {
      setCameraError(err.message || 'Camera access denied');
      return null;
    }
  }, []);

  const releaseCamera = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
  }, []);

  // Toggle camera: enable=true turns on, enable=false turns off
  const toggleCamera = useCallback(async (enable) => {
    const currentStream = localStreamRef.current;
    console.log('[WebRTC] toggleCamera:', enable, 'currentStream:', !!currentStream);
    
    if (enable) {
      // Turn camera ON
      if (!currentStream) {
        // Need to get camera permission
        const stream = await requestCamera();
        console.log('[WebRTC] toggleCamera: got new stream', !!stream);
        return stream;
      }
      // Re-enable existing video track
      const videoTrack = currentStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = true;
        console.log('[WebRTC] toggleCamera: enabled existing video track');
      }
    } else {
      // Turn camera OFF - disable video tracks (don't stop them)
      if (currentStream) {
        const videoTrack = currentStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = false;
          console.log('[WebRTC] toggleCamera: disabled video track');
        }
      }
    }
    return currentStream;
  }, [requestCamera]);

  // Keep localStreamRef in sync with localStream state
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

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

  // ── Signaling handler ──────────────────────────────────────────────────────
  // Note: We use refs to avoid stale closure issues in WebSocket callbacks
  const handleSignalingMessage = useCallback(
    async (msg) => {
      const { type } = msg;

      // Handle system_info from room server (convert to connected format)
      if (type === 'system_info' && msg.data?.client_id) {
        console.log('[WebRTC] Received system_info (room server), treating as connected');
        myClientIdRef.current = msg.data.client_id;
        setMyClientId(msg.data.client_id);
        
        // Clear the connection timeout since we got a response
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        
        // Try to send pending intent (may already be sent via onopen)
        const pending = pendingIntentRef.current;
        console.log('[WebRTC] system_info: pendingIntent =', pending);
        
        const ws = wsRef.current;
        if (pending && ws && ws.readyState === WebSocket.OPEN) {
          if (pending.kind === 'create') {
            ws.send(JSON.stringify({ type: 'create_room', user_name: pending.userName }));
            console.log('[WebRTC] system_info: sent create_room');
          } else if (pending.kind === 'join') {
            ws.send(JSON.stringify({ type: 'join_room', room_id: pending.roomId, user_name: pending.userName }));
            console.log('[WebRTC] system_info: sent join_room');
          }
          pendingIntentRef.current = null;
        }
        return;
      }

      if (type === 'connected') {
        myClientIdRef.current = msg.client_id;
        setMyClientId(msg.client_id);
        console.log('[WebRTC] Received connected');
        
        // Clear the connection timeout since we got a response
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        
        // Try to send pending intent (may already be sent via onopen)
        const pending = pendingIntentRef.current;
        const ws = wsRef.current;
        if (pending && ws && ws.readyState === WebSocket.OPEN) {
          if (pending.kind === 'create') {
            ws.send(JSON.stringify({ type: 'create_room', user_name: pending.userName }));
            console.log('[WebRTC] connected: sent create_room');
          } else if (pending.kind === 'join') {
            ws.send(JSON.stringify({ type: 'join_room', room_id: pending.roomId, user_name: pending.userName }));
            console.log('[WebRTC] connected: sent join_room');
          }
          pendingIntentRef.current = null;
        }
        return;
      }

      if (type === 'room_created' || type === 'room_joined') {
        console.log('[WebRTC] Received room response:', type, msg);
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
        const currentStream = localStreamRef.current;

        if (currentStream) {
          currentStream.getTracks().forEach((track) => pc.addTrack(track, currentStream));
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
        const currentStream = localStreamRef.current;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          if (currentStream) {
            currentStream.getTracks().forEach((track) => pc.addTrack(track, currentStream));
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

      // ── Room data ───────────────────────────────────────────────────
      if (type === 'chat') {
        console.log('[WebRTC] Received chat message:', msg);
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
        console.log('[WebRTC] Received reaction:', msg);
        // Use refs for reaction handling to avoid stale closure
        setReactions((prev) => {
          const next = [...prev, msg];
          return next.length > 30 ? next.slice(-30) : next;
        });
        // Remove after 4s
        const id = msg.ts;
        if (reactionTimeoutsRef.current[id]) clearTimeout(reactionTimeoutsRef.current[id]);
        reactionTimeoutsRef.current[id] = setTimeout(() => {
          setReactions((prev) => prev.filter((r) => r.ts !== id));
          delete reactionTimeoutsRef.current[id];
        }, 4000);
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
    [createPeerConnection, closePeerConnection, detachStream, sendWs]
  );

  // Keep handlerRef updated
  const handlerRef = useRef(handleSignalingMessage);
  handlerRef.current = handleSignalingMessage;

  const connectSignaling = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    isSocketReadyRef.current = false;  // Reset ready flag on new connection
    
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }

    setSignalingState('connecting');
    setRoomError(null);

    void (async () => {
      let url = getSignalUrl();
      console.log('[WebRTC] Connecting to signaling server...');
      try {
        if (typeof window !== 'undefined' && window.electronAPI?.getRoomSignaling) {
          const r = await window.electronAPI.getRoomSignaling();
          console.log('[WebRTC] getRoomSignaling response:', r);
          if (r?.url && typeof r.url === 'string') {
            url = r.url;
          }
        }
      } catch (e) {
        console.warn('[WebRTC] getRoomSignaling IPC failed, using build-time URL', e);
      }
      
      console.log('[WebRTC] Final URL:', url);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.log('[WebRTC] Already connected');
        return;
      }

      const ws = new WebSocket(url);
      wsRef.current = ws;
      
      console.log('[WebRTC] WebSocket created, state:', ws.readyState);
      
      // Flag to track if pending intent was already sent (via onopen or message handler)
      let pendingIntentSent = false;
      
      const sendPendingIntent = () => {
        // Prevent duplicate sends
        if (pendingIntentSent) {
          console.log('[WebRTC] sendPendingIntent: already sent, skipping');
          return;
        }
        
        const pending = pendingIntentRef.current;
        if (!pending) {
          console.log('[WebRTC] sendPendingIntent: no pending intent');
          return;
        }
        
        if (ws.readyState !== WebSocket.OPEN) {
          console.log('[WebRTC] sendPendingIntent: socket not open yet, readyState:', ws.readyState);
          return;
        }
        
        pendingIntentSent = true;
        console.log('[WebRTC] sendPendingIntent:', pending);
        
        try {
          if (pending.kind === 'create') {
            ws.send(JSON.stringify({ type: 'create_room', user_name: pending.userName }));
            console.log('[WebRTC] sendPendingIntent: create_room sent');
          } else if (pending.kind === 'join') {
            ws.send(JSON.stringify({ type: 'join_room', room_id: pending.roomId, user_name: pending.userName }));
            console.log('[WebRTC] sendPendingIntent: join_room sent');
          }
          pendingIntentRef.current = null;
        } catch (e) {
          console.error('[WebRTC] sendPendingIntent error:', e);
          pendingIntentSent = false;  // Reset on error to allow retry
        }
      };
      
      ws.onopen = () => {
        console.log('[WebRTC] WebSocket opened successfully, readyState:', ws.readyState);
        isSocketReadyRef.current = true;  // Mark socket as ready to send
        reconnectAttemptsRef.current = 0; // Reset on successful connection
        sendPendingIntent();
      };

      ws.onmessage = (event) => {
        console.log('[WebRTC] Message received:', event.data);
        try {
          handlerRef.current(JSON.parse(event.data));
        } catch (err) {
          console.error('[WebRTC] Failed to parse signaling message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebRTC] WebSocket error:', error);
        // Let the timeout handle retry logic
      };

      ws.onclose = (event) => {
        console.log('[WebRTC] WebSocket closed, code:', event.code, 'reason:', event.reason);
        isSocketReadyRef.current = false;  // Reset ready flag
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        console.log('[WebRTC] Signaling disconnected');
        setSignalingState((s) => (s === 'in_room' ? s : 'disconnected'));
      };

      // Connection timeout handler with retry logic
      connectTimeoutRef.current = setTimeout(() => {
        if (wsRef.current === ws && ws.readyState !== WebSocket.OPEN) {
          console.log('[WebRTC] Connection timeout, readyState:', ws.readyState);
          // Attempt to retry connection if we haven't exceeded max attempts
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current += 1;
            console.log(`[WebRTC] Connection attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS} failed, retrying in ${RECONNECT_DELAY_MS}ms...`);
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
      console.log('[WebRTC] sendChatMessage:', text.trim());
      sendWs({ type: 'chat', text: text.trim() });
    },
    [sendWs]
  );

  const sendReaction = useCallback(
    (reaction) => {
      console.log('[WebRTC] sendReaction:', reaction, 'signalingState:', signalingState);
      sendWs({ type: 'reaction', reaction });
    },
    [sendWs, signalingState]
  );

  const sendHandRaise = useCallback(
    (raised) => {
      console.log('[WebRTC] sendHandRaise:', raised);
      sendWs({ type: 'hand_raise', raised });
    },
    [sendWs]
  );

  const sendFocusUpdate = useCallback(
    (focus_state, ear, focus_time, points) => {
      console.log('[WebRTC] sendFocusUpdate:', { focus_state, ear, focus_time, points });
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

  // ── Listen for room server logs from Electron main process ─────────────────
  useEffect(() => {
    if (window.electronAPI) {
      // Listen for room server logs
      const handleRoomLog = (data) => {
        console.log('[Room Server]', data.data || data.message || data);
      };
      const handleRoomError = (data) => {
        console.error('[Room Server Error]', data.message || data);
        setRoomError((prev) => prev || `Room server error: ${data.message}`);
      };
      const handleRoomExit = (data) => {
        console.warn('[Room Server Exit]', data);
      };
      
      window.electronAPI.onRoomLog(handleRoomLog);
      window.electronAPI.onRoomError(handleRoomError);
      window.electronAPI.onRoomExit(handleRoomExit);
      
      return () => {
        window.electronAPI.removeAllListeners('room-log');
        window.electronAPI.removeAllListeners('room-error');
        window.electronAPI.removeAllListeners('room-exit');
      };
    }
  }, []);

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
    toggleCamera,
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
