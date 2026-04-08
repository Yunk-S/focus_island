/**
 * useWebRTC — WebRTC Mesh peer connection hook for Focus Island Live Mode.
 *
 * Signaling URL from Vite: __FOCUS_ISLAND_ROOM_WS_URL__ (default ws://127.0.0.1:8766/ws/room)
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

export function WebRTCProvider({ children }) {
  const wsRef = useRef(null);
  const myClientIdRef = useRef(null);
  /** After server sends `connected`, send create_room / join_room (avoids racing OPEN vs connected). */
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
      try {
        pc.close();
      } catch {
        /* ignore */
      }
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

      if (type === 'room_not_found') {
        setRoomError(`Room "${msg.room_id}" does not exist.`);
        setSignalingState('disconnected');
        return;
      }

      if (type === 'error') {
        setRoomError(msg.message || 'Signaling error');
      }
    },
    [localStream, createPeerConnection, closePeerConnection, detachStream, sendWs]
  );

  const handlerRef = useRef(handleSignalingMessage);
  handlerRef.current = handleSignalingMessage;

  const connectSignaling = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }

    setSignalingState('connecting');
    setRoomError(null);

    const url = getSignalUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    connectTimeoutRef.current = setTimeout(() => {
      if (wsRef.current === ws && ws.readyState !== WebSocket.OPEN) {
        setRoomError(
          'Signaling server unreachable. Start the room server (port 8766) or check firewall.'
        );
        setSignalingState('disconnected');
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    }, 12000);

    ws.onopen = () => {
      console.log('[WebRTC] Signaling connected', url);
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
      setRoomError('Failed to connect to signaling server.');
    };

    ws.onclose = () => {
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      console.log('[WebRTC] Signaling disconnected');
      setSignalingState((s) => (s === 'in_room' ? s : 'disconnected'));
    };
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

  useEffect(
    () => () => {
      sendWs({ type: 'leave_room' });
      Object.keys(peersRef.current).forEach((cid) => {
        const pc = peersRef.current[cid];
        if (pc) {
          try {
            pc.close();
          } catch {
            /* ignore */
          }
          delete peersRef.current[cid];
        }
      });
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
      }
    },
    [sendWs]
  );

  const value = {
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
