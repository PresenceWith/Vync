import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let serverHandle: { shutdown: () => Promise<void>; url: string } | null = null;
let pendingFilePath: string | null = null;

// --- Single instance lock ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const file = argv.find((a) => a.endsWith('.vync'));
    if (file) openFile(file);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// --- macOS: handle file association (can fire before ready) ---
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    openFile(filePath);
  } else {
    pendingFilePath = filePath;
  }
});

// --- App ready ---
app.whenReady().then(async () => {
  const filePath =
    pendingFilePath || process.argv.find((a) => a.endsWith('.vync')) || null;

  if (!filePath) {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Vync Canvas', extensions: ['vync'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      app.quit();
      return;
    }
    await openFile(result.filePaths[0]);
  } else {
    await openFile(filePath);
  }
});

// --- Window lifecycle ---
app.on('window-all-closed', async () => {
  if (serverHandle) {
    await serverHandle.shutdown();
    serverHandle = null;
  }
  app.quit();
});

// --- Core functions ---

async function openFile(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);

  if (serverHandle) {
    // Hub mode: register new file, don't restart
    try {
      await fetch(`${serverHandle.url}/api/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: resolved }),
      });
    } catch (err: any) {
      dialog.showErrorBox(
        'Vync Error',
        `Failed to register file: ${err.message}`
      );
      return;
    }
  } else {
    // Start server with new signature
    try {
      const { startServer } = await import('../server/server.js');
      const isDev = !app.isPackaged;
      const staticDir = isDev
        ? undefined
        : path.join(process.resourcesPath, 'dist', 'apps', 'web');
      serverHandle = await startServer({
        initialFile: resolved,
        port: 3100,
        mode: isDev ? 'development' : 'production',
        staticDir,
      });
    } catch (err: any) {
      dialog.showErrorBox('Vync Error', err.message);
      app.quit();
      return;
    }
  }

  // URL now includes ?file= param
  const fileUrl = `${serverHandle!.url}/?file=${encodeURIComponent(resolved)}`;
  if (!mainWindow) {
    createWindow(fileUrl);
  } else {
    mainWindow.loadURL(fileUrl);
  }
}

function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Vync',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}
