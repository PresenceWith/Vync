import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { resolveVyncPath } from './resolve.js';

const VYNC_DIR = path.join(os.homedir(), '.vync');
const PID_FILE = path.join(VYNC_DIR, 'server.pid');
const LOG_FILE = path.join(VYNC_DIR, 'server.log');
const PORT = 3100;
const POLL_INTERVAL = 300;
const POLL_TIMEOUT = 10_000;

// --- ServerInfo: PID file now stores pid + mode + filePath ---

export interface ServerInfo {
  pid: number;
  mode: 'daemon' | 'electron' | 'foreground';
  filePath: string;
}

export async function readServerInfo(): Promise<ServerInfo | null> {
  try {
    const content = (await fs.readFile(PID_FILE, 'utf-8')).trim();
    const lines = content.split('\n');
    // Old format was just a PID number — treat as stale
    if (lines.length < 3) {
      await fs.unlink(PID_FILE).catch(() => {});
      return null;
    }
    const [pidStr, mode, ...rest] = lines;
    return {
      pid: Number(pidStr),
      mode: mode as ServerInfo['mode'],
      filePath: rest.join('\n'),
    };
  } catch {
    return null;
  }
}

export async function writeServerInfo(info: ServerInfo): Promise<void> {
  await fs.mkdir(VYNC_DIR, { recursive: true });
  await fs.writeFile(
    PID_FILE,
    `${info.pid}\n${info.mode}\n${info.filePath}`,
    'utf-8'
  );
}

// --- Validation ---

async function validateAndResolve(filePath: string): Promise<string> {
  const resolved = resolveVyncPath(filePath);
  try {
    await fs.access(resolved);
  } catch {
    console.error(`[vync] File not found: ${resolved}`);
    console.error('[vync] Run "vync init <file>" first.');
    process.exit(1);
  }
  return resolved;
}

// --- Smart restart: 3-state server detection ---

type ServerState = 'none' | 'same-file' | 'different-file';
interface HandleResult {
  state: ServerState;
  info: ServerInfo | null;
}

async function handleExistingServer(
  newFilePath: string
): Promise<HandleResult> {
  const info = await readServerInfo();
  if (!info) return { state: 'none', info: null };

  // Stale PID detection (process existence check)
  try {
    process.kill(info.pid, 0);
  } catch {
    await fs.unlink(PID_FILE).catch(() => {});
    return { state: 'none', info: null };
  }

  // HTTP health check — PID alive but server may not be responding
  try {
    const res = await fetch(`http://localhost:${PORT}/api/sync`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) throw new Error();
  } catch {
    // PID alive but HTTP dead → stale or PID reuse
    await fs.unlink(PID_FILE).catch(() => {});
    return { state: 'none', info: null };
  }

  const state = info.filePath === newFilePath ? 'same-file' : 'different-file';
  return { state, info };
}

// --- Startup helpers ---

async function findElectronBinary(): Promise<string | null> {
  const projectRoot = process.env.VYNC_HOME || process.cwd();
  const electronPath = path.join(
    projectRoot,
    'node_modules',
    '.bin',
    'electron'
  );
  const compiledMain = path.join(projectRoot, 'dist', 'electron', 'main.js');

  try {
    await fs.access(electronPath, fsSync.constants.X_OK);
    await fs.access(compiledMain);
    return electronPath;
  } catch {
    return null;
  }
}

async function runForeground(resolved: string): Promise<void> {
  await writeServerInfo({
    pid: process.pid,
    mode: 'foreground',
    filePath: resolved,
  });

  const { startServer } = await import('../server/server.js');
  const { shutdown } = await startServer(resolved, { openBrowser: true });

  const cleanup = async () => {
    await shutdown();
    await fs.unlink(PID_FILE).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function runElectron(resolved: string): Promise<void> {
  const projectRoot = process.env.VYNC_HOME || process.cwd();
  const electronPath = path.join(
    projectRoot,
    'node_modules',
    '.bin',
    'electron'
  );
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

  await writeServerInfo({
    pid: childPid,
    mode: 'electron',
    filePath: resolved,
  });
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

  console.error(
    `[vync] Electron did not become ready within ${POLL_TIMEOUT / 1000}s.`
  );
  console.error(`[vync] Check logs: ${LOG_FILE}`);
  await fs.unlink(PID_FILE).catch(() => {});
  process.exit(1);
}

async function runDaemon(resolved: string): Promise<void> {
  const projectRoot = process.env.VYNC_HOME || process.cwd();
  const tsxPath = path.join(projectRoot, 'node_modules', '.bin', 'tsx');
  const serverScript = path.join(projectRoot, 'tools', 'server', 'server.ts');

  // Verify tsx exists
  try {
    await fs.access(tsxPath, fsSync.constants.X_OK);
  } catch {
    console.error(`[vync] tsx not found at: ${tsxPath}`);
    console.error('[vync] Run "npm install" in the project root.');
    process.exit(1);
  }

  // Prepare log file
  await fs.mkdir(VYNC_DIR, { recursive: true });
  const logFd = fsSync.openSync(LOG_FILE, 'w');

  // Spawn detached server process
  const child = spawn(tsxPath, [serverScript, resolved], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: projectRoot,
    env: { ...process.env, VYNC_HOME: projectRoot },
  });

  const childPid = child.pid;
  if (!childPid) {
    fsSync.closeSync(logFd);
    console.error('[vync] Failed to spawn server process.');
    process.exit(1);
  }

  // Save child PID (not this process's PID)
  await writeServerInfo({
    pid: childPid,
    mode: 'daemon',
    filePath: resolved,
  });
  child.unref();
  fsSync.closeSync(logFd);

  // Poll until server is ready
  const url = `http://localhost:${PORT}`;
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT) {
    // Check child is still alive
    try {
      process.kill(childPid, 0);
    } catch {
      console.error('[vync] Server process exited unexpectedly.');
      console.error(`[vync] Check logs: ${LOG_FILE}`);
      await fs.unlink(PID_FILE).catch(() => {});
      process.exit(1);
    }

    // Try to reach the server
    try {
      const res = await fetch(`${url}/api/sync`);
      if (res.ok) {
        // Server is ready — open browser
        const openModule = await import('open');
        await openModule.default(url);

        console.log(`[vync] Server running at ${url} (PID ${childPid})`);
        console.log(`[vync] Watching: ${resolved}`);
        console.log(`[vync] Log: ${LOG_FILE}`);
        return;
      }
    } catch {
      // Not ready yet
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout
  console.error(
    `[vync] Server did not become ready within ${POLL_TIMEOUT / 1000}s.`
  );
  console.error(`[vync] Check logs: ${LOG_FILE}`);
  // Clean up PID file but leave process running for debugging
  await fs.unlink(PID_FILE).catch(() => {});
  process.exit(1);
}

// --- Public API ---

export async function vyncOpen(
  filePath: string,
  opts: { foreground?: boolean } = {}
): Promise<void> {
  const resolved = await validateAndResolve(filePath);
  const { state, info } = await handleExistingServer(resolved);

  if (state === 'same-file') {
    if (info?.mode === 'electron') {
      // Electron second-instance event auto-focuses → no browser open needed
      console.log('[vync] Electron already running with this file.');
    } else {
      console.log('[vync] Server already running, opening browser...');
      const openModule = await import('open');
      await openModule.default(`http://localhost:${PORT}`);
    }
    return;
  }

  if (state === 'different-file') {
    console.log(`[vync] Switching to: ${resolved}`);
    await vyncStop();
  }

  // state === 'none' or just stopped
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

export function getPidFilePath(): string {
  return PID_FILE;
}
export function getVyncDir(): string {
  return VYNC_DIR;
}

export async function vyncStop(): Promise<void> {
  const info = await readServerInfo();
  if (!info) {
    console.error('[vync] No running server found.');
    return;
  }

  try {
    process.kill(info.pid, 'SIGTERM');
  } catch (err: any) {
    if (err.code !== 'ESRCH') throw err;
    // Process already gone
    await fs.unlink(PID_FILE).catch(() => {});
    console.log(`[vync] Server stopped (PID ${info.pid})`);
    return;
  }
  await fs.unlink(PID_FILE).catch(() => {});

  // Wait for process to exit (max 5s, server shutdown timeout is 3s)
  const start = Date.now();
  let stopped = false;
  while (Date.now() - start < 5000) {
    try {
      process.kill(info.pid, 0);
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      stopped = true;
      break;
    }
  }

  // Escalate to SIGKILL if still alive
  if (!stopped) {
    console.error('[vync] Server did not stop in 5s. Force-killing.');
    try {
      process.kill(info.pid, 'SIGKILL');
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  // Wait for port to be released (max 2s)
  let portFree = false;
  const portStart = Date.now();
  while (Date.now() - portStart < 2000) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createConnection({ port: PORT, host: '127.0.0.1' });
      probe.once('connect', () => {
        probe.destroy();
        resolve(false);
      });
      probe.once('error', () => resolve(true));
    });
    if (free) {
      portFree = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!portFree) {
    console.error(
      `[vync] Warning: port ${PORT} still in use after stop. Manual cleanup may be required.`
    );
  }
  console.log(`[vync] Server stopped (PID ${info.pid})`);
}
