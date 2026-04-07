const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

/** Ports passed to renderer (IPC) and to Python; defaults until allocateBackendPorts runs. */
let backendPorts = { wsPort: 8765, apiPort: 8000 };

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
      // Python/uvicorn 常把普通日志打到 stderr，避免一律标成 Error
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
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
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

// Export for testing
module.exports = { startBackend, stopBackend };
