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
    identity: { verified: false, similarity: 0 }
  });

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionState(WS_STATE.CONNECTING);
    setError(null);

    try {
      const ws = new WebSocket('ws://localhost:8765');
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

      case 'frame_result':
        if (data) {
          setFrameData(data);
          // Update session state from frame result
          if (data.session) {
            setSessionState(prev => ({
              ...prev,
              session_id: data.workflow?.session_id,
              total_points: data.session.stats?.total_points || prev.total_points,
              focus_time: data.session.stats?.total_focus_time || prev.focus_time,
              current_state: data.session.stats?.current_state || prev.current_state
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

      case 'error':
        console.error('[WS] Server error:', data);
        setError(data);
        break;

      default:
        console.log('[WS] Unknown message type:', type);
    }
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
    // Try to connect after a short delay
    const timer = setTimeout(() => {
      connect();
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
