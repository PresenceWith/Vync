# Electron Desktop App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Vync를 Electron으로 감싸서 네이티브 데스크톱 앱처럼 동작하게 한다 (.vync 더블클릭 → 앱 열림, 창 닫기 → 자동 종료).

**Architecture:** Electron main process가 `startServer()`를 in-process로 호출. BrowserWindow가 `http://localhost:<port>`를 로드. 개발 모드에서는 Vite middleware, 프로덕션에서는 `express.static`. CLI (`vync open`)는 Electron 앱을 detached spawn.

**Tech Stack:** Electron, electron-builder (macOS DMG), esbuild (main.ts 빌드), Express + WS + chokidar (기존 서버)

---

## Task 1: Refactor `startServer()` — Remove `process.exit()` and signal handlers

**Files:**
- Modify: `src/server/server.ts:12-143`

**Step 1: Remove `process.exit(1)` from startServer error handling**

Replace lines 17-26 in `src/server/server.ts`:

```typescript
// BEFORE
  const sync = createSyncService(resolvedPath);
  try {
    await sync.init();
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.error(`[vync] File not found: ${resolvedPath}`);
    } else {
      console.error(`[vync] Invalid JSON in file: ${resolvedPath}`);
    }
    process.exit(1);
  }

// AFTER
  const sync = createSyncService(resolvedPath);
  try {
    await sync.init();
  } catch (err: any) {
    const msg = err.code === 'ENOENT'
      ? `File not found: ${resolvedPath}`
      : `Invalid JSON in file: ${resolvedPath}`;
    throw new Error(`[vync] ${msg}`);
  }
```

**Step 2: Remove SIGINT/SIGTERM handlers from startServer**

Delete lines 123-124:

```typescript
// DELETE these lines
  process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
  process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
```

**Step 3: Add signal handlers to the direct-run block instead**

Update the `isDirectRun` block at the bottom of `server.ts`:

```typescript
if (isDirectRun) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx src/server/server.ts <file.vync>');
    process.exit(1);
  }
  startServer(path.resolve(filePath))
    .then(({ shutdown }) => {
      process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
      process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
    })
    .catch((err) => {
      console.error('[vync] Fatal error:', err.message);
      process.exit(1);
    });
}
```

**Step 4: Update `runForeground` in `open.ts` to wire up signal handlers**

In `src/cli/open.ts`, update `runForeground`:

```typescript
async function runForeground(resolved: string): Promise<void> {
  await fs.mkdir(VYNC_DIR, { recursive: true });
  await fs.writeFile(PID_FILE, String(process.pid), 'utf-8');

  const { startServer } = await import('../server/server.js');
  const { shutdown } = await startServer(resolved, { openBrowser: true });

  process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
  process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
}
```

**Step 5: Verify dev:server still works**

Run: `npm run dev:server -- examples/mindmap.vync`
Expected: Server starts on :3100, Ctrl+C cleanly shuts down.

**Step 6: Commit**

```bash
git add src/server/server.ts src/cli/open.ts
git commit -m "refactor(server): remove process.exit and signal handlers from startServer

Callers now wire up their own lifecycle management.
This is a prerequisite for Electron integration."
```

---

## Task 2: Add configurable port and EADDRINUSE error handling

**Files:**
- Modify: `src/server/server.ts:10-135`

**Step 1: Update startServer signature with port option**

```typescript
// BEFORE
const PORT = 3100;

export async function startServer(
  resolvedPath: string,
  options: { openBrowser?: boolean } = {}
) {

// AFTER
const DEFAULT_PORT = 3100;

export async function startServer(
  resolvedPath: string,
  options: {
    openBrowser?: boolean;
    port?: number;
  } = {}
) {
  const port = options.port ?? DEFAULT_PORT;
```

**Step 2: Replace all `PORT` references with `port` inside startServer**

Update CORS origins, WebSocket server, and listen call to use `port` variable:

```typescript
  const allowedOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];
  // ...
  const ws = createWsServer(server, port);
  // ...
  const url = `http://localhost:${port}`;
```

**Step 3: Add error handler on server.listen for EADDRINUSE**

Replace the listen promise:

```typescript
// BEFORE
  await new Promise<void>((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[vync] Server running at ${url}`);
      // ...
      resolve();
    });
  });

// AFTER
  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`[vync] Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      server.removeAllListeners('error');
      console.log(`[vync] Server running at ${url}`);
      console.log(`[vync] Watching: ${resolvedPath}`);
      console.log(`[vync] WebSocket: ws://localhost:${port}/ws`);
      resolve();
    });
  });
```

**Step 4: Verify**

Run: `npm run dev:server -- examples/mindmap.vync`
Then in another terminal: `npm run dev:server -- examples/mindmap.vync`
Expected: Second instance throws "Port 3100 is already in use" (not a crash).

**Step 5: Commit**

```bash
git add src/server/server.ts
git commit -m "feat(server): add configurable port and EADDRINUSE handling"
```

---

## Task 3: Make Vite import conditional and add production static serving

**Files:**
- Modify: `src/server/server.ts:4,83-97,115-121`

**Step 1: Remove top-level Vite import**

```typescript
// DELETE line 4
import { createServer as createViteServer } from 'vite';
```

**Step 2: Add mode and staticDir to startServer options**

```typescript
export async function startServer(
  resolvedPath: string,
  options: {
    openBrowser?: boolean;
    port?: number;
    mode?: 'development' | 'production';
    staticDir?: string;
  } = {}
) {
  const port = options.port ?? DEFAULT_PORT;
  const mode = options.mode ?? 'development';
```

**Step 3: Replace unconditional Vite setup with dev/prod branch**

```typescript
  // --- Frontend serving (dev: Vite middleware, prod: static files) ---

  let vite: { close: () => Promise<void> } | null = null;

  if (mode === 'production' && options.staticDir) {
    app.use(express.static(options.staticDir));
    // SPA fallback: serve index.html for all non-API routes
    app.get('*', (_req, res) => {
      res.sendFile(path.join(options.staticDir!, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const projectRoot = process.env.VYNC_HOME || process.cwd();
    const webAppRoot = path.resolve(projectRoot, 'apps/web');

    vite = await createViteServer({
      configFile: path.resolve(webAppRoot, 'vite.config.ts'),
      root: webAppRoot,
      server: {
        middlewareMode: true,
        hmr: { server },
      },
    });

    app.use(vite.middlewares);
  }
```

**Step 4: Update shutdown to conditionally close Vite**

```typescript
  const shutdown = async () => {
    console.log('\n[vync] Shutting down...');
    await watcher.close();
    ws.close();
    if (vite) {
      await vite.close();
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      server.close(() => { clearTimeout(timer); resolve(); });
    });
  };
```

**Step 5: Verify dev mode still works**

Run: `npm run dev:server -- examples/mindmap.vync`
Expected: Vite middleware loads, HMR works in browser.

**Step 6: Verify production mode works**

Run: `npx nx build web` first, then:
```bash
NODE_ENV=production npx tsx src/server/server.ts examples/mindmap.vync
```
Note: This won't work yet because the direct-run block doesn't pass mode/staticDir. That's fine — Electron will be the production caller. Just verify dev mode is not broken.

**Step 7: Commit**

```bash
git add src/server/server.ts
git commit -m "feat(server): conditional Vite import and production static serving

Vite is dynamically imported only in development mode.
Production mode serves pre-built static files via express.static."
```

---

## Task 4: Fix WebSocket client termination and shutdown awaiting

**Files:**
- Modify: `src/server/ws-handler.ts:40-53`

**Step 1: Terminate all WebSocket clients before closing server**

Update the `close` function in `ws-handler.ts`:

```typescript
// BEFORE
    close() {
      wss.close();
    },

// AFTER
    close() {
      wss.clients.forEach((client) => client.terminate());
      wss.close();
    },
```

**Step 2: Verify**

Run: `npm run dev:server -- examples/mindmap.vync`
Open browser to http://localhost:3100, then Ctrl+C.
Expected: Clean shutdown without hanging.

**Step 3: Commit**

```bash
git add src/server/ws-handler.ts
git commit -m "fix(ws): terminate all WebSocket clients on shutdown

Prevents server.close() from hanging due to keep-alive connections."
```

---

## Task 5: Install Electron dependencies and add build scripts

**Files:**
- Modify: `package.json`

**Step 1: Install Electron and electron-builder as devDependencies**

Run:
```bash
npm install --save-dev electron electron-builder
```

**Step 2: Add Electron scripts to package.json**

Add to the `"scripts"` section:

```json
"dev:desktop": "node node_modules/esbuild/bin/esbuild src/electron/main.ts --bundle --platform=node --outdir=dist/electron --external:electron --sourcemap && electron dist/electron/main.js",
"build:desktop": "nx build web && node node_modules/esbuild/bin/esbuild src/electron/main.ts src/electron/preload.ts --bundle --platform=node --outdir=dist/electron --external:electron",
"package:desktop": "npm run build:desktop && electron-builder"
```

Note: We use `node node_modules/esbuild/bin/esbuild` because esbuild is already available via Vite's dependencies (no separate install needed).

**Step 3: Add `"main"` field to package.json**

Add at the top level of package.json:

```json
"main": "dist/electron/main.js"
```

**Step 4: Verify esbuild is available**

Run: `node node_modules/esbuild/bin/esbuild --version`
Expected: Prints a version number (esbuild is bundled with Vite).

**Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add Electron and electron-builder dependencies"
```

---

## Task 6: Create Electron main process

**Files:**
- Create: `src/electron/main.ts`

**Step 1: Write the Electron main process**

Create `src/electron/main.ts`:

```typescript
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
    pendingFilePath ||
    process.argv.find((a) => a.endsWith('.vync')) ||
    null;

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

  // Shut down existing server if running
  if (serverHandle) {
    await serverHandle.shutdown();
    serverHandle = null;
  }

  try {
    const { startServer } = await import('../server/server.js');

    const isDev = !app.isPackaged;
    const staticDir = isDev
      ? undefined
      : path.join(process.resourcesPath, 'dist', 'apps', 'web');

    serverHandle = await startServer(resolved, {
      port: 3100,
      mode: isDev ? 'development' : 'production',
      staticDir,
    });
  } catch (err: any) {
    dialog.showErrorBox('Vync Error', err.message);
    app.quit();
    return;
  }

  if (!mainWindow) {
    createWindow(serverHandle.url);
  } else {
    mainWindow.loadURL(serverHandle.url);
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
```

**Step 2: Verify the file compiles**

Run: `node node_modules/esbuild/bin/esbuild src/electron/main.ts --bundle --platform=node --outdir=dist/electron --external:electron --sourcemap`
Expected: `dist/electron/main.js` created without errors.

**Step 3: Commit**

```bash
git add src/electron/main.ts
git commit -m "feat(electron): create main process entry point

Single instance lock, macOS open-file handling, file picker dialog,
dev/prod mode detection via app.isPackaged."
```

---

## Task 7: Create Electron preload script

**Files:**
- Create: `src/electron/preload.ts`

**Step 1: Write minimal preload script**

Create `src/electron/preload.ts`:

```typescript
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('vyncDesktop', {
  isDesktopApp: true,
});
```

**Step 2: Verify it compiles**

Run: `node node_modules/esbuild/bin/esbuild src/electron/preload.ts --bundle --platform=node --outdir=dist/electron --external:electron`
Expected: `dist/electron/preload.js` created.

**Step 3: Commit**

```bash
git add src/electron/preload.ts
git commit -m "feat(electron): add minimal preload script"
```

---

## Task 8: Create electron-builder configuration

**Files:**
- Create: `electron-builder.yml`

**Step 1: Write electron-builder config**

Create `electron-builder.yml` at project root:

```yaml
appId: com.vync.app
productName: Vync

directories:
  output: dist/packages
  buildResources: build

mac:
  category: public.app-category.productivity
  target: dmg

dmg:
  title: Vync
  iconSize: 80
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications

fileAssociations:
  - ext: vync
    name: Vync Canvas
    role: Editor

files:
  - dist/electron/**/*
  - dist/apps/web/**/*
  - node_modules/**/*
  - "!node_modules/**/{test,tests,__tests__}/**"
  - "!node_modules/**/*.{md,map,ts}"
  - "!**/node_modules/.cache/**"

extraMetadata:
  main: dist/electron/main.js
```

**Step 2: Create build resources directory**

Run: `mkdir -p build`

**Step 3: Commit**

```bash
git add electron-builder.yml
git commit -m "chore: add electron-builder config for macOS DMG packaging"
```

---

## Task 9: Update CLI to spawn Electron app

**Files:**
- Modify: `src/cli/open.ts:47-126`

**Step 1: Add Electron spawn function**

Add `runElectron` function in `open.ts`, before `runDaemon`:

```typescript
async function findElectronBinary(): Promise<string | null> {
  const projectRoot = process.env.VYNC_HOME || process.cwd();
  const electronPath = path.join(projectRoot, 'node_modules', '.bin', 'electron');
  const compiledMain = path.join(projectRoot, 'dist', 'electron', 'main.js');

  try {
    await fs.access(electronPath, fsSync.constants.X_OK);
    await fs.access(compiledMain);
    return electronPath;
  } catch {
    return null;
  }
}

async function runElectron(resolved: string): Promise<void> {
  const projectRoot = process.env.VYNC_HOME || process.cwd();
  const electronPath = path.join(projectRoot, 'node_modules', '.bin', 'electron');
  const compiledMain = path.join(projectRoot, 'dist', 'electron', 'main.js');

  await fs.mkdir(VYNC_DIR, { recursive: true });
  const logFd = fsSync.openSync(LOG_FILE, 'w');

  const child = spawn(electronPath, [compiledMain, resolved], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: projectRoot,
    env: { ...process.env, VYNC_HOME: projectRoot },
  });

  const childPid = child.pid;
  if (!childPid) {
    fsSync.closeSync(logFd);
    console.error('[vync] Failed to spawn Electron process.');
    process.exit(1);
  }

  await fs.writeFile(PID_FILE, String(childPid), 'utf-8');
  child.unref();
  fsSync.closeSync(logFd);

  // Poll until server is ready
  const url = `http://localhost:${PORT}`;
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT) {
    try {
      process.kill(childPid, 0);
    } catch {
      console.error('[vync] Electron process exited unexpectedly.');
      console.error(`[vync] Check logs: ${LOG_FILE}`);
      await fs.unlink(PID_FILE).catch(() => {});
      process.exit(1);
    }

    try {
      const res = await fetch(`${url}/api/sync`);
      if (res.ok) {
        console.log(`[vync] Vync app running (PID ${childPid})`);
        console.log(`[vync] Watching: ${resolved}`);
        console.log(`[vync] Log: ${LOG_FILE}`);
        return;
      }
    } catch {
      // Not ready yet
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  console.error(`[vync] Electron did not become ready within ${POLL_TIMEOUT / 1000}s.`);
  console.error(`[vync] Check logs: ${LOG_FILE}`);
  await fs.unlink(PID_FILE).catch(() => {});
  process.exit(1);
}
```

**Step 2: Update runDaemon dispatch to try Electron first**

Update `vyncOpen` to try Electron, fall back to daemon:

```typescript
export async function vyncOpen(
  filePath: string,
  opts: { foreground?: boolean } = {}
): Promise<void> {
  const resolved = await validateAndResolve(filePath);
  await ensureNoExistingServer();

  if (opts.foreground) {
    return runForeground(resolved);
  }

  // Try Electron first, fall back to daemon mode
  const electronBinary = await findElectronBinary();
  if (electronBinary) {
    return runElectron(resolved);
  }
  return runDaemon(resolved);
}
```

**Step 3: Verify CLI still works without Electron build**

Run: `rm -rf dist/electron` then `npx tsx src/cli/main.ts open examples/mindmap.vync`
Expected: Falls back to daemon mode (tsx server.ts spawn).

**Step 4: Commit**

```bash
git add src/cli/open.ts
git commit -m "feat(cli): vync open spawns Electron app with daemon fallback

Tries Electron binary first. If dist/electron/main.js doesn't exist,
falls back to current tsx daemon mode."
```

---

## Task 10: Gate analytics script for Electron

**Files:**
- Modify: `apps/web/index.html:72`

**Step 1: Wrap Umami script in environment check**

Replace line 72:

```html
<!-- BEFORE -->
<script defer src="https://cloud.umami.is/script.js" data-website-id="7083aa92-85b1-4a67-a6d4-03d52819ba3d"></script>

<!-- AFTER -->
<script>
  if (!window.vyncDesktop) {
    const s = document.createElement('script');
    s.defer = true;
    s.src = 'https://cloud.umami.is/script.js';
    s.dataset.websiteId = '7083aa92-85b1-4a67-a6d4-03d52819ba3d';
    document.head.appendChild(s);
  }
</script>
```

**Step 2: Commit**

```bash
git add apps/web/index.html
git commit -m "fix(web): gate analytics script for Electron desktop app

window.vyncDesktop is set by Electron preload script.
Prevents analytics from loading in desktop app context."
```

---

## Task 11: End-to-end verification

**Step 1: Build Electron main process**

Run:
```bash
node node_modules/esbuild/bin/esbuild src/electron/main.ts src/electron/preload.ts --bundle --platform=node --outdir=dist/electron --external:electron --sourcemap
```
Expected: `dist/electron/main.js` and `dist/electron/preload.js` created.

**Step 2: Run Electron in dev mode**

Run:
```bash
npx electron dist/electron/main.js examples/mindmap.vync
```
Expected:
- Electron window opens (not a browser tab)
- Vync canvas loads with mindmap content
- HMR works (edit a React component, see instant update)
- No Umami analytics script loaded (check DevTools Network tab)

**Step 3: Test CLI → Electron flow**

Run:
```bash
npx tsx src/cli/main.ts open examples/mindmap.vync
```
Expected:
- Electron app spawns as daemon
- CLI prints PID and exits
- `vync stop` terminates the Electron process

**Step 4: Test window close → server shutdown**

Open Electron via Step 2, then close the window.
Expected: Process exits cleanly (check `ps aux | grep electron`).

**Step 5: Test file picker (no file argument)**

Run:
```bash
npx electron dist/electron/main.js
```
Expected: macOS file picker dialog opens, filtered to .vync files.

**Step 6: Test production build (optional)**

Run:
```bash
npm run build:desktop
npx electron dist/electron/main.js examples/mindmap.vync
```
Note: This tests the full build pipeline (nx build web + esbuild).
Expected: Electron loads the production-built static files.

**Step 7: Test DMG packaging (optional)**

Run:
```bash
npm run package:desktop
```
Expected: `dist/packages/Vync-*.dmg` created. Opening the DMG shows Vync.app.

**Step 8: Commit all verification results**

If any fixes were needed during verification, commit them as separate fix commits.

---

## Summary

| Task | Description | Est. |
|------|-------------|------|
| 1 | Remove process.exit + signal handlers from startServer | 5 min |
| 2 | Configurable port + EADDRINUSE handling | 5 min |
| 3 | Conditional Vite import + production static serving | 10 min |
| 4 | Fix WS client termination + shutdown awaiting | 3 min |
| 5 | Install Electron deps + add build scripts | 3 min |
| 6 | Create Electron main process | 10 min |
| 7 | Create Electron preload script | 2 min |
| 8 | Create electron-builder config | 3 min |
| 9 | Update CLI to spawn Electron | 10 min |
| 10 | Gate analytics script | 3 min |
| 11 | End-to-end verification | 15 min |
