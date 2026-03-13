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
      properties: ['openFile', 'showHiddenFiles'],
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
        : path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'dist',
            'apps',
            'web'
          );
      serverHandle = await startServer({
        initialFile: resolved,
        port: 3100,
        mode: isDev ? 'development' : 'production',
        staticDir,
      });
    } catch (err: any) {
      // EADDRINUSE: try connecting to existing server
      if (err.message.includes('already in use')) {
        const existingUrl = 'http://localhost:3100';
        try {
          const res = await fetch(`${existingUrl}/api/health`, {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) {
            const body = await res.json();
            if (body.version === 2) {
              // Reuse existing server (no shutdown responsibility)
              serverHandle = { shutdown: async () => {}, url: existingUrl };
              console.log(`[vync] Reusing existing server (PID ${body.pid})`);
              // Register the file with existing server
              await fetch(`${existingUrl}/api/files`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: resolved }),
              });
            } else {
              dialog.showErrorBox(
                'Vync Error',
                'Incompatible server on port 3100'
              );
              app.quit();
              return;
            }
          } else {
            dialog.showErrorBox(
              'Vync Error',
              'Port 3100 in use by non-Vync process'
            );
            app.quit();
            return;
          }
        } catch {
          dialog.showErrorBox(
            'Vync Error',
            'Port 3100 in use but server not responding'
          );
          app.quit();
          return;
        }
      } else {
        dialog.showErrorBox('Vync Error', err.message);
        app.quit();
        return;
      }
    }
  }

  // First file: create window. Subsequent files: hub WS notifies frontend.
  if (!mainWindow) {
    const fileUrl = `${serverHandle!.url}/?file=${encodeURIComponent(
      resolved
    )}`;
    createWindow(fileUrl);
  }
  // If window already exists, hub WS broadcasts hub-file-registered to frontend
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
