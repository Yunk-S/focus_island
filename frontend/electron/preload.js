const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Backend control
  startBackend: () => ipcRenderer.invoke('start-backend'),
  stopBackend: () => ipcRenderer.invoke('stop-backend'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  getBackendPorts: () => ipcRenderer.invoke('get-backend-ports'),
  /** Live mode WebRTC signaling URL (room_server); use when Electron spawns room. */
  getRoomSignaling: () => ipcRenderer.invoke('get-room-signaling'),
  
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Event listeners
  onBackendLog: (callback) => {
    ipcRenderer.on('backend-log', (_, data) => callback(data));
  },
  onBackendError: (callback) => {
    ipcRenderer.on('backend-error', (_, data) => callback(data));
  },
  onBackendExit: (callback) => {
    ipcRenderer.on('backend-exit', (_, data) => callback(data));
  },
  
  // Room server log listeners (for debugging)
  onRoomLog: (callback) => {
    ipcRenderer.on('room-log', (_, data) => callback(data));
  },
  onRoomError: (callback) => {
    ipcRenderer.on('room-error', (_, data) => callback(data));
  },
  onRoomExit: (callback) => {
    ipcRenderer.on('room-exit', (_, data) => callback(data));
  },
  
  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
