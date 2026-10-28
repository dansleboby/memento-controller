import http from 'node:http';
import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { createApp } from '../server/src/http/server.js';

// Fixed so localStorage (theme, language, last frame IP) keeps the same origin across launches.
const PREFERRED_PORT = 47017;
const DISCONNECT_GRACE_MS = 3000;

const api = createApp();
let origin = null;
let mainWindow = null;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function startServer() {
  const server = http.createServer(api);
  try {
    return await listen(server, PREFERRED_PORT);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    return listen(server, 0);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: 'Memento',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1c1b' : '#e8e4e0',
    autoHideMenuBar: true,
    show: false,
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Anything leaving the local UI belongs in the system browser, not in this window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === origin) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  mainWindow.loadURL(origin);
}

// The frame accepts one controller at a time: a second instance would fight over it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    origin = `http://127.0.0.1:${await startServer()}`;
    createWindow();
    app.on('activate', () => {
      if (!mainWindow) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());

  // Frame protocol requires Disconnect last, on teardown; it queues behind any running
  // transfer, so cap the wait.
  let disconnecting = false;
  app.on('before-quit', (event) => {
    const client = api.ctx.getClient();
    if (!client || disconnecting) return;
    event.preventDefault();
    disconnecting = true;
    const grace = new Promise((resolve) => setTimeout(resolve, DISCONNECT_GRACE_MS));
    Promise.race([client.disconnect().catch(() => {}), grace]).finally(() => app.exit(0));
  });
}
