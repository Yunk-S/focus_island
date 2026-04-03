/**
 * useWebRTC — WebRTC Mesh peer connection hook for Focus Island Live Mode.
 *
 * Architecture:
 *   - Connects to the room signaling server via WebSocket.
 *   - Manages N peer connections (Mesh / Full-Mesh).
 *   - All video is sent P2P — the signaling server only brokers SDP / ICE.
 *
 * Signaling server: ws://localhost:8766/ws/room
 *
 * Message protocol:
 *   send  { type: 'create_room' | 'join_room' | 'leave_room',
 *           room_id?, user_name? }
 *   recv  { type: 'connected',  client_id }
 *   recv  { type: 'room_created' | 'room_joined', room_id, participants? }
 *   recv  { type: 'participant_joined' | 'participant_left', client_id }
 *   send/recv { type: 'offer' | 'answer', from, sdp }
 *   send/recv { type: 'ice_candidate', from, candidate }
 *   recv  { type: 'room_not_found' | 'room_full' | 'error', message }
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
} from 'react';

// ─── WebRTC config (STUN only; add TURN for NAT traversal if needed) ───────────
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// ─── Signaling URL ─────────────────────────────────────────────────────────────
const SIGNAL_URL = 'ws://localhost:8766/ws/room';

// ─── Context ───────────────────────────────────────────────────────────────────
const WebRTCContext = createContext(null);

export function WebRTCProvider({ children }) {
  // Signaling socket
  const wsRef = useRef(null);
  const wsAlive = useRef(false);

  // My identity
  const [myClientId, setMyClientId] = useState(null);
  const [myRoomId, setMyRoomId] = useState(null);
  const [userName, setUserName] = useState('');

  // Room participants (excluding self)
  const [participants, setParticipants] = useState([]);

  // Remote video streams  { clientId: MediaStream }
  const [remoteStreams, setRemoteStreams] = useState({});

  // Local camera stream (activated after permission grant)
  const [localStream, setLocalStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);

  // Connection / room state
  const [signalingState, setSignalingState] = useState('disconnected'); // disconnected | connecting | in_room
  const [roomError, setRoomError] = useState(null);

  // Peer connections  { clientId: RTCPeerConnection }
  const peersRef = useRef({});

  // ─── Utility ────────────────────────────────────────────────────────────────
  const sendWs = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // ─── Media ──────────────────────────────────────────────────────────────────
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
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }
  }, [localStream]);

  // Attach a remote stream to a video element (keyed by clientId)
  const attachStream = useCallback((clientId, stream) => {
    setRemoteStreams((prev) => ({ ...prev, [clientId]: stream }));
  }, []);

  // Remove a remote stream
  const detachStream = useCallback((clientId) => {
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
  }, []);

  // ─── Peer connection factory ────────────────────────────────────────────────
  const createPeerConnection = useCallback(
    (targetClientId) => {
      if (peersRef.current[targetClientId]) {
        return peersRef.current[targetClientId]; // reuse
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peersRef.current[targetClientId] = pc;

      // Add local tracks whenever we get a local stream
      if (localStream) {
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
      }

      // ICE candidate → send to signaling server
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          sendWs({ type: 'ice_candidate', target: targetClientId, candidate });
        }
      };

      // Remote track arrived → attach stream
      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteStream) attachStream(targetClientId, remoteStream);
      };

      // ICE connection state change
      pc.oniceconnectionstatechange = () => {
        if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
          closePeerConnection(targetClientId);
          detachStream(targetClientId);
        }
      };

      return pc;
    },
    [localStream, sendWs, attachStream, detachStream]
  );

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

  // ─── Signaling message handler ───────────────────────────────────────────────
  const handleSignalingMessage = useCallback(
    async (msg) => {
      const { type } = msg;

      // ── connected → store my client ID ──────────────────────────────────
      if (type === 'connected') {
        setMyClientId(msg.client_id);
        return;
      }

      // ── room_created / room_joined ───────────────────────────────────────
      if (type === 'room_created' || type === 'room_joined') {
        setMyRoomId(msg.room_id);
        setSignalingState('in_room');
        setRoomError(null);

        // Create peer connections with existing participants
        const existing = msg.participants || [];
        for (const p of existing) {
          if (p.client_id === myClientId) continue;
          createPeerConnection(p.client_id);
        }
        setParticipants(existing.filter((p) => p.client_id !== myClientId));
        return;
      }

      // ── participant_joined ────────────────────────────────────────────────
      if (type === 'participant_joined') {
        const { client_id, user_name } = msg;

        // Create peer connection; wait for caller to send offer
        const pc = createPeerConnection(client_id);

        // If we already have a local stream, add tracks now
        if (localStream) {
          localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
        }

        // Become the offerer ( initiator sends offer to new joiner )
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

      // ── participant_left ─────────────────────────────────────────────────
      if (type === 'participant_left') {
        const { client_id } = msg;
        closePeerConnection(client_id);
        detachStream(client_id);
        setParticipants((prev) => prev.filter((p) => p.client_id !== client_id));
        return;
      }

      // ── offer → create answer ─────────────────────────────────────────────
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

      // ── answer → set remote description ───────────────────────────────────
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

      // ── ice_candidate → add ICE candidate ──────────────────────────────────
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

      // ── room_not_found ─────────────────────────────────────────────────────
      if (type === 'room_not_found') {
        setRoomError(`Room "${msg.room_id}" does not exist.`);
        setSignalingState('disconnected');
        return;
      }

      // ── error ─────────────────────────────────────────────────────────────
      if (type === 'error') {
        setRoomError(msg.message);
      }
    },
    [
      myClientId,
      localStream,
      createPeerConnection,
      closePeerConnection,
      detachStream,
      sendWs,
    ]
  );

  // ─── Signaling WebSocket ───────────────────────────────────────────────────
  const connectSignaling = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setSignalingState('connecting');
    const ws = new WebSocket(SIGNAL_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      wsAlive.current = true;
      console.log('[WebRTC] Signaling connected');
    };

    ws.onmessage = (event) => {
      try {
        handleSignalingMessage(JSON.parse(event.data));
      } catch (err) {
        console.error('[WebRTC] Failed to parse signaling message:', err);
      }
    };

    ws.onerror = () => {
      console.error('[WebRTC] Signaling WebSocket error');
      setRoomError('Failed to connect to signaling server.');
    };

    ws.onclose = () => {
      wsAlive.current = false;
      console.log('[WebRTC] Signaling disconnected');
      setSignalingState('disconnected');
    };
  }, [handleSignalingMessage]);

  // ─── Public actions ──────────────────────────────────────────────────────────
  const createRoom = useCallback(
    (name) => {
      setUserName(name || 'Host');
      connectSignaling();
      // Wait for 'connected' then send create_room
      const tryCreate = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          sendWs({ type: 'create_room', user_name: name || 'Host' });
        } else {
          setTimeout(tryCreate, 100);
        }
      };
      tryCreate();
    },
    [connectSignaling, sendWs]
  );

  const joinRoom = useCallback(
    (roomId, name) => {
      setUserName(name || 'Guest');
      connectSignaling();
      const tryJoin = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          sendWs({ type: 'join_room', room_id: roomId, user_name: name || 'Guest' });
        } else {
          setTimeout(tryJoin, 100);
        }
      };
      tryJoin();
    },
    [connectSignaling, sendWs]
  );

  const leaveRoom = useCallback(() => {
    sendWs({ type: 'leave_room' });
    // Close all peer connections
    Object.keys(peersRef.current).forEach((cid) => {
      closePeerConnection(cid);
      detachStream(cid);
    });
    setParticipants([]);
    setMyRoomId(null);
    setSignalingState('disconnected');
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    releaseCamera();
  }, [sendWs, closePeerConnection, detachStream, releaseCamera]);

  // When local stream becomes available, add tracks to existing peer connections
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

  // ─── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      leaveRoom();
    };
  }, []);

  const value = {
    // Identity
    myClientId,
    myRoomId,
    userName,
    participants,

    // Media
    localStream,
    remoteStreams,
    cameraError,

    // State
    signalingState,
    roomError,

    // Actions
    requestCamera,
    releaseCamera,
    createRoom,
    joinRoom,
    leaveRoom,
  };

  return <WebRTCContext.Provider value={value}>{children}</WebRTCContext.Provider>;
}

export function useWebRTC() {
  const ctx = useContext(WebRTCContext);
  if (!ctx) throw new Error('useWebRTC must be used within WebRTCProvider');
  return ctx;
}
