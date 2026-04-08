const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

/** Ports passed to renderer (IPC) and to Python; defaults until allocateBackendPorts runs. */
let backendPorts = { wsPort: 8765, apiPort: 8000 };

/** WebRTC room signaling (must match frontend useWebRTC / Vite default 8766). */
const DEFAULT_ROOM_WS_PORT = 8766;
let roomProcess = null;
let roomWsPort = DEFAULT_ROOM_WS_PORT;

function readPortsFromRoot(backendDir) {
  try {
    const p = path.join(backendDir, '.focus_island_ports.json');
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return {
        wsPort: Number(j.ws_port) || 8765,
        apiPort: Number(j.api_port) || 8000,
      };
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

function checkPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host }, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function allocateBackendPorts(baseWs = 8765, baseApi = 8000, host = '127.0.0.1', maxTries = 64) {
  for (let i = 0; i < maxTries; i++) {
    const ws = baseWs + i;
    const api = baseApi + i;
    if ((await checkPortFree(ws, host)) && (await checkPortFree(api, host))) {
      return { wsPort: ws, apiPort: api };
    }
  }
  return { wsPort: baseWs, apiPort: baseApi };
}

// Development mode check
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Global references
let mainWindow = null;
let backendProcess = null;

function stopRoomServer() {
  if (roomProcess) {
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', roomProcess.pid, '/f', '/t']);
      } catch (_) {
        /* ignore */
      }
    } else {
      try {
        roomProcess.kill('SIGTERM');
      } catch (_) {
        /* ignore */
      }
    }
    roomProcess = null;
  }
}

/**
 * Start room_server on 8766 if the port is free; otherwise assume another process
 * (e.g. python start.py) already serves signaling.
 */
function startRoomServerIfNeeded(backendDir) {
  return new Promise((resolve) => {
    checkPortFree(DEFAULT_ROOM_WS_PORT, '127.0.0.1').then((free) => {
      if (!free) {
        roomWsPort = DEFAULT_ROOM_WS_PORT;
        console.log(
          '[Main] Room signaling port',
          DEFAULT_ROOM_WS_PORT,
          'busy — assuming room server already running (e.g. start.py)'
        );
        return resolve(true);
      }

      const pyPath = path.join(backendDir, 'src');
      const venvPython =
        process.platform === 'win32'
          ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
          : path.join(backendDir, '.venv', 'bin', 'python3');
      const useVenv = fs.existsSync(venvPython);
      const exe = useVenv ? venvPython : process.platform === 'win32' ? 'python' : 'python3';

      try {
        roomProcess = spawn(
          exe,
          [
            '-m',
            'focus_island.room_server',
            '--host',
            '127.0.0.1',
            '--port',
            String(DEFAULT_ROOM_WS_PORT),
          ],
          {
            cwd: backendDir,
            env: {
              ...process.env,
              PYTHONPATH: pyPath,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
          }
        );
        roomWsPort = DEFAULT_ROOM_WS_PORT;

        roomProcess.stdout.on('data', (data) => {
          const output = data.toString();
          console.log('[Room]', output.trimEnd());
          if (mainWindow) {
            mainWindow.webContents.send('room-log', { type: 'stdout', data: output });
          }
        });
        roomProcess.stderr.on('data', (data) => {
          const output = data.toString();
          console.warn('[Room]', output.trimEnd());
          if (mainWindow) {
            mainWindow.webContents.send('room-log', { type: 'stderr', data: output });
          }
        });
        roomProcess.on('error', (err) => {
          console.error('[Room] Failed to start room server:', err);
        });
        roomProcess.on('exit', (code) => {
          console.log('[Room] room_server exited with code:', code);
          roomProcess = null;
        });

        console.log('[Main] Room signaling server started (pid:', roomProcess.pid, ')');
        resolve(true);
      } catch (err) {
        console.error('[Main] Error spawning room server:', err);
        resolve(false);
      }
    });
  });
}

// Create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#0a0a0f',
    frame: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../public/icon.ico')
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Window events
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

// Start the Python backend
function startBackend() {
  // Dev: __dirname is frontend/electron -> repo root is ../..
  const backendDir = isDev
    ? path.join(__dirname, '..', '..')
    : path.join(app.getAppPath(), '..');

  const pythonScript = path.join(backendDir, 'src', 'focus_island', 'main.py');
  
  // Determine Python command
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  
  console.log('Starting backend from:', backendDir);
  console.log('Python script:', pythonScript);

  try {
    const pyPath = path.join(backendDir, 'src');
    const venvPython =
      process.platform === 'win32'
        ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
        : path.join(backendDir, '.venv', 'bin', 'python3');
    const useVenv = fs.existsSync(venvPython);
    const exe = useVenv ? venvPython : pythonCmd;

    backendProcess = spawn(
      exe,
      [
        '-m', 'focus_island.main',
        '--mode', 'server',
        '--ws-port', String(backendPorts.wsPort),
        '--api-port', String(backendPorts.apiPort),
        '--cuda'
      ],
      {
        cwd: backendDir,
        env: {
          ...process.env,
          PYTHONPATH: pyPath,
          FOCUS_ISLAND_SKIP_AUTO_PORT: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
      }
    );

    // Log backend output
    backendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Backend]', output);
      if (mainWindow) {
        mainWindow.webContents.send('backend-log', { type: 'stdout', data: output });
      }
    });

    backendProcess.stderr.on('data', (data) => {
      const output = data.toString();
      // Python/uvicorn often sends regular logs to stderr, avoid marking all as Error
      console.warn('[Backend]', output.trimEnd());
      if (mainWindow) {
        mainWindow.webContents.send('backend-log', { type: 'stderr', data: output });
      }
    });

    backendProcess.on('error', (err) => {
      console.error('Failed to start backend:', err);
      if (mainWindow) {
        mainWindow.webContents.send('backend-error', { message: err.message });
      }
    });

    backendProcess.on('exit', (code) => {
      console.log('Backend exited with code:', code);
      if (mainWindow) {
        mainWindow.webContents.send('backend-exit', { code });
      }
    });

    console.log('Backend process started with PID:', backendProcess.pid);
    return true;
  } catch (err) {
    console.error('Error starting backend:', err);
    return false;
  }
}

// Stop the backend
function stopBackend() {
  if (backendProcess) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
    } else {
      backendProcess.kill('SIGTERM');
    }
    backendProcess = null;
  }
}

// App lifecycle
app.whenReady().then(async () => {
  const backendDir = isDev
    ? path.join(__dirname, '..', '..')
    : path.join(app.getAppPath(), '..');

  if (process.env.FOCUS_ISLAND_EXTERNAL_BACKEND === '1') {
    const fromFile = readPortsFromRoot(backendDir);
    backendPorts = fromFile || { wsPort: 8765, apiPort: 8000 };
    console.log('[Main] Skipping embedded Python backend (FOCUS_ISLAND_EXTERNAL_BACKEND=1)');
    console.log('[Main] Using WS/API ports for renderer:', backendPorts);
  } else {
    backendPorts = await allocateBackendPorts();
    console.log('[Main] Allocated backend ports:', backendPorts);
  }

  // Room server is lightweight — start before the window so Live mode can connect immediately.
  if (process.env.FOCUS_ISLAND_SKIP_ROOM_SERVER !== '1') {
    await startRoomServerIfNeeded(backendDir);
  }

  createWindow();

  if (process.env.FOCUS_ISLAND_EXTERNAL_BACKEND !== '1') {
    const started = startBackend();
    if (!started) {
      console.error('[Main] Failed to start backend process');
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopRoomServer();
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopRoomServer();
  stopBackend();
});

// IPC handlers
ipcMain.handle('start-backend', async () => {
  return startBackend();
});

ipcMain.handle('stop-backend', async () => {
  stopBackend();
  return true;
});

ipcMain.handle('get-backend-status', async () => {
  return {
    running: backendProcess !== null,
    pid: backendProcess ? backendProcess.pid : null
  };
});

ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

ipcMain.handle('get-backend-ports', async () => ({ ...backendPorts }));

/** ws:// URL for Live mode / WebRTC signaling (room_server). */
ipcMain.handle('get-room-signaling', async () => ({
  port: roomWsPort,
  url: `ws://127.0.0.1:${roomWsPort}/ws/room`,
}));

// Export for testing
module.exports = { startBackend, stopBackend, startRoomServerIfNeeded, stopRoomServer };
