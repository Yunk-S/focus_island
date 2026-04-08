import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

// WebSocket connection state
const WS_STATE = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error'
};

// Backend context
const BackendContext = createContext(null);

// Default system info
const defaultSystemInfo = {
  status: 'initializing',
  gpu_available: false,
  gpu_name: 'Unknown',
  version: '1.0.0',
  backend_ready: false
};

export function BackendProvider({ children }) {
  // State
  const [connectionState, setConnectionState] = useState(WS_STATE.DISCONNECTED);
  const [systemInfo, setSystemInfo] = useState(defaultSystemInfo);
  const [backendLogs, setBackendLogs] = useState([]);
  const [error, setError] = useState(null);
  /** Last start_session (focus) error from backend; cleared on success */
  const [focusSessionError, setFocusSessionError] = useState(null);
  
  // WebSocket ref
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // Frame data (latest from backend)
  const [frameData, setFrameData] = useState(null);
  
  // Session state
  const [sessionState, setSessionState] = useState({
    active: false,
    session_id: null,
    total_points: 0,
    focus_time: 0,
    current_state: 'idle',
    has_face: false,
    head_pose: { pitch: 0, yaw: 0, roll: 0 },
    eye_data: { ear_avg: 0 },
    identity: { verified: false, similarity: 0 },
    // 人脸状态
    face_status: {
      is_bound: false,      // 是否已绑定人脸
      is_verified: false,   // 最后一次验证是否通过
      last_similarity: 0,   // 最后一次相似度
      last_check: null       // 上次检查时间
    }
  });

  // Connect to WebSocket
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionState(WS_STATE.CONNECTING);
    setError(null);

    let wsPort = 8765;
    try {
      if (window.electronAPI?.getBackendPorts) {
        const p = await window.electronAPI.getBackendPorts();
        if (p?.wsPort != null) wsPort = Number(p.wsPort) || 8765;
      } else if (typeof __FOCUS_ISLAND_WS_PORT__ !== 'undefined') {
        wsPort = Number(__FOCUS_ISLAND_WS_PORT__) || 8765;
      } else if (import.meta.env.VITE_BACKEND_WS_PORT) {
        wsPort = Number(import.meta.env.VITE_BACKEND_WS_PORT) || 8765;
      }
    } catch {
      /* keep default */
    }

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to backend');
        setConnectionState(WS_STATE.CONNECTED);
        setSystemInfo(prev => ({ ...prev, backend_ready: true }));
        reconnectAttempts.current = 0;
        
        // Request system info
        sendMessage({ type: 'get_system_info' });
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('[WS] WebSocket error:', err);
        setConnectionState(WS_STATE.ERROR);
        setError('Connection error');
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected from backend');
        setConnectionState(WS_STATE.DISCONNECTED);
        setSystemInfo(prev => ({ ...prev, backend_ready: false }));
        
        // Attempt reconnection
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        }
      };
    } catch (err) {
      console.error('[WS] Failed to create WebSocket:', err);
      setConnectionState(WS_STATE.ERROR);
      setError(err.message);
    }
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback((message) => {
    const { type, data } = message;

    switch (type) {
      case 'system_info':
        setSystemInfo({
          ...data,
          status: 'running',
          backend_ready: true
        });
        break;

      case 'session_started':
        if (data) {
          if (data.success) {
            setFocusSessionError(null);
          } else {
            const msg =
              typeof data.error === 'string'
                ? data.error
                : data.message || 'Failed to start focus session';
            setFocusSessionError(msg);
          }
          setSessionState((prev) => ({
            ...prev,
            active: !!data.success,
            session_id: data.session_id ?? prev.session_id,
            current_state: data.success ? prev.current_state : 'idle',
          }));
        }
        break;

      case 'frame_result':
        if (data) {
          setFrameData(data);
          // Update session state from frame result
          // Backend returns: data.session.state, data.session.stats.focus_time_min, data.session.stats.total_points
          if (data.session) {
            setSessionState(prev => ({
              ...prev,
              session_id: data.workflow?.session_id ?? prev.session_id,
              total_points: data.session.stats?.total_points ?? prev.total_points,
              focus_time: data.session.stats?.focus_time_min ?? prev.focus_time,
              current_state: data.session.state || prev.current_state
            }));
          }
          if (data.perception) {
            setSessionState(prev => ({
              ...prev,
              has_face: data.perception.has_face,
              head_pose: data.perception.head_pose || prev.head_pose,
              eye_data: data.perception.eye || prev.eye_data,
              identity: data.perception.identity || prev.identity
            }));
          }
        }
        break;

      case 'state_change':
        if (data) {
          setSessionState(prev => ({
            ...prev,
            current_state: data.new_state
          }));
        }
        break;

      case 'score_update':
        if (data) {
          setSessionState(prev => ({
            ...prev,
            total_points: data.total_points || prev.total_points
          }));
        }
        break;

      case 'milestone':
        console.log('[WS] Milestone reached:', data);
        break;

      case 'heartbeat':
        // Connection is alive
        break;

      case 'face_bound':
        if (data) {
          setSessionState(prev => ({
            ...prev,
            face_status: {
              ...prev.face_status,
              is_bound: data.is_bound ?? false,
              last_check: Date.now()
            }
          }));
        }
        break;

      case 'face_verified':
        if (data) {
          setSessionState(prev => ({
            ...prev,
            face_status: {
              ...prev.face_status,
              is_verified: data.is_verified ?? false,
              is_bound: data.is_bound ?? prev.face_status.is_bound,
              last_similarity: data.similarity ?? 0,
              last_check: Date.now()
            }
          }));
        }
        break;

      case 'face_status':
        if (data) {
          setSessionState(prev => ({
            ...prev,
            face_status: {
              ...prev.face_status,
              is_bound: data.is_bound ?? false,
              last_check: Date.now()
            }
          }));
        }
        break;

      case 'error':
        console.error('[WS] Server error:', data);
        setError(data);
        break;

      default:
        console.log('[WS] Unknown message type:', type);
    }
  }, []);

  const getApiBaseUrl = useCallback(async () => {
    let port = 8000;
    try {
      if (window.electronAPI?.getBackendPorts) {
        const p = await window.electronAPI.getBackendPorts();
        if (p?.apiPort != null) port = Number(p.apiPort) || 8000;
      } else if (import.meta.env.VITE_BACKEND_API_PORT) {
        port = Number(import.meta.env.VITE_BACKEND_API_PORT) || 8000;
      }
    } catch {
      /* default */
    }
    return `http://127.0.0.1:${port}`;
  }, []);

  // Send message to backend
  const sendMessage = useCallback((message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  // Start session
  const startSession = useCallback((userId) => {
    return sendMessage({
      type: 'start_session',
      data: { user_id: userId }
    });
  }, [sendMessage]);

  // Stop session
  const stopSession = useCallback(() => {
    return sendMessage({
      type: 'stop_session'
    });
  }, [sendMessage]);

  // Pause session
  const pauseSession = useCallback(() => {
    return sendMessage({
      type: 'pause_session'
    });
  }, [sendMessage]);

  // Resume session
  const resumeSession = useCallback(() => {
    return sendMessage({
      type: 'resume_session'
    });
  }, [sendMessage]);

  // Bind face
  const bindFace = useCallback((userId, language = 'zh') => {
    return sendMessage({
      type: 'bind_face',
      data: { user_id: userId, language }
    });
  }, [sendMessage]);

  // Verify face
  const verifyFace = useCallback((userId, language = 'zh') => {
    return sendMessage({
      type: 'verify_face',
      data: { user_id: userId, language }
    });
  }, [sendMessage]);

  // Check face status
  const checkFaceStatus = useCallback((userId) => {
    return sendMessage({
      type: 'check_face_status',
      data: { user_id: userId }
    });
  }, [sendMessage]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState(WS_STATE.DISCONNECTED);
  }, []);

  // Log backend output (for loading screen)
  const addLog = useCallback((log) => {
    setBackendLogs(prev => [...prev.slice(-100), {
      ...log,
      timestamp: Date.now()
    }]);
  }, []);

  // Listen to Electron main process logs
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onBackendLog((data) => {
        addLog({ type: 'log', message: data.data });
      });
      window.electronAPI.onBackendError((data) => {
        addLog({ type: 'error', message: data.message });
        setError(data.message);
      });
      window.electronAPI.onBackendExit((data) => {
        addLog({ type: 'exit', message: `Backend exited with code: ${data.code}` });
      });
    }

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeAllListeners('backend-log');
        window.electronAPI.removeAllListeners('backend-error');
        window.electronAPI.removeAllListeners('backend-exit');
      }
    };
  }, [addLog]);

  // Auto-connect on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      void connect();
    }, 1000);

    return () => {
      clearTimeout(timer);
      disconnect();
    };
  }, [connect, disconnect]);

  // Value object
  const value = {
    // Connection
    connectionState,
    isConnected: connectionState === WS_STATE.CONNECTED,
    isConnecting: connectionState === WS_STATE.CONNECTING,
    
    // System info
    systemInfo,
    
    // Session
    sessionState,
    frameData,
    
    // Actions
    connect,
    disconnect,
    sendMessage,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
    bindFace,
    verifyFace,
    checkFaceStatus,
    getApiBaseUrl,
    focusSessionError,
    
    // Logs
    backendLogs,
    addLog,
    error
  };

  return (
    <BackendContext.Provider value={value}>
      {children}
    </BackendContext.Provider>
  );
}

// Hook to use backend
export function useBackend() {
  const context = useContext(BackendContext);
  if (!context) {
    throw new Error('useBackend must be used within a BackendProvider');
  }
  return context;
}

export { WS_STATE };
