import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

function readBackendWsPort() {
  try {
    const p = path.resolve(__dirname, '..', '.focus_island_ports.json');
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const n = Number(j.ws_port);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    /* ignore */
  }
  return 8765;
}

const focusIslandWsPort = readBackendWsPort();

function readRoomWsPort() {
  try {
    const p = path.resolve(__dirname, '..', '.focus_island_ports.json');
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const n = Number(j.room_ws_port);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    /* ignore */
  }
  return 8766;
}

const focusIslandRoomWsPort = readRoomWsPort();
const focusIslandRoomWsUrl = `ws://127.0.0.1:${focusIslandRoomWsPort}/ws/room`;

export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html')
    }
  },
  server: {
    port: 5173,
    strictPort: false
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  define: {
    __FOCUS_ISLAND_WS_PORT__: JSON.stringify(focusIslandWsPort),
    __FOCUS_ISLAND_ROOM_WS_PORT__: JSON.stringify(focusIslandRoomWsPort),
    __FOCUS_ISLAND_ROOM_WS_URL__: JSON.stringify(focusIslandRoomWsUrl),
  },
});
