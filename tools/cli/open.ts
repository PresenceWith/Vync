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

// --- ServerInfo: JSON format with version + port ---

export interface ServerInfo {
  version: number;
  pid: number;
  mode: 'daemon' | 'electron' | 'foreground';
  port: number;
}

export async function readServerInfo(): Promise<ServerInfo | null> {
  try {
    const content = (await fs.readFile(PID_FILE, 'utf-8')).trim();
    // Try JSON first
    try {
      const parsed = JSON.parse(content);
      if (parsed.version && parsed.pid) return parsed;
    } catch {}
    // Legacy 3-line format: pid\nmode\nfilePath
    const lines = content.split('\n');
    if (lines.length >= 2 && !isNaN(Number(lines[0]))) {
      return {
        version: 1,
        pid: Number(lines[0]),
        mode: lines[1] as any,
        port: PORT,
      };
    }
    // Corrupt — clean up
    await fs.unlink(PID_FILE).catch(() => {});
    return null;
  } catch {
    return null;
  }
}

export async function writeServerInfo(info: ServerInfo): Promise<void> {
  await fs.mkdir(VYNC_DIR, { recursive: true });
  await fs.writeFile(PID_FILE, JSON.stringify(info), 'utf-8');
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

// --- 2-state server detection ---

async function probePort(): Promise<{
  running: boolean;
  info: ServerInfo | null;
}> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return { running: false, info: null };
    const body = await res.json();
    if (body.version !== 2) return { running: false, info: null };

    // Recover PID file from health response
    const recoveredInfo: ServerInfo = {
      version: 2,
      pid: body.pid,
      mode: 'daemon',
      port: PORT,
    };
    await writeServerInfo(recoveredInfo);
    console.log(
      `[vync] Discovered existing server (PID ${body.pid}), recovered PID file.`
    );
    return { running: true, info: recoveredInfo };
  } catch {
    return { running: false, info: null };
  }
}

async function isServerRunning(): Promise<{
  running: boolean;
  info: ServerInfo | null;
}> {
  const info = await readServerInfo();

  if (info) {
    // Check if process is alive
    try {
      process.kill(info.pid, 0);
    } catch {
      await fs.unlink(PID_FILE).catch(() => {});
      // Fall through to port probe
      return probePort();
    }

    // Health check
    try {
      const res = await fetch(`http://localhost:${info.port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.version === 2) return { running: true, info };
        // Old server -> stop it
        await vyncStop();
        return { running: false, info: null };
      }
    } catch {}

    // PID alive but HTTP dead -> stale
    await fs.unlink(PID_FILE).catch(() => {});
    return { running: false, info: null };
  }

  // No PID file — probe port as fallback
  return probePort();
}

// --- Helpers ---

async function registerFile(port: number, filePath: string): Promise<void> {
  const res = await fetch(`http://localhost:${port}/api/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `[vync] Registration failed: ${(body as any).error || res.statusText}`
    );
  }
}

async function openBrowserWithFile(
  port: number,
  filePath: string
): Promise<void> {
  const openModule = await import('open');
  await openModule.default(
    `http://localhost:${port}/?file=${encodeURIComponent(filePath)}`
  );
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
    version: 2,
    pid: process.pid,
    mode: 'foreground',
    port: PORT,
  });

  const { startServer } = await import('../server/server.js');
  const { shutdown } = await startServer({
    initialFile: resolved,
    openBrowser: true,
  });

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
    version: 2,
    pid: childPid,
    mode: 'electron',
    port: PORT,
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
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        console.log(`[vync] Vync app running (PID ${childPid})`);
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
    version: 2,
    pid: childPid,
    mode: 'daemon',
    port: PORT,
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
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        // Server is ready — register file + open browser
        await registerFile(PORT, resolved);
        await openBrowserWithFile(PORT, resolved);

        console.log(`[vync] Server running at ${url} (PID ${childPid})`);
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
  const { running, info } = await isServerRunning();
  const port = info?.port ?? PORT;

  if (running) {
    // Hub mode: register file and open browser
    console.log('[vync] Server running, registering file...');
    await registerFile(port, resolved);
    await openBrowserWithFile(port, resolved);
    return;
  }

  // Start new server
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

export async function vyncClose(
  filePath?: string,
  opts?: { keepServer?: boolean }
): Promise<void> {
  const info = await readServerInfo();
  if (!info) {
    console.error('[vync] No running server.');
    return;
  }

  if (filePath) {
    const resolved = resolveVyncPath(filePath);
    try {
      const res = await fetch(
        `http://localhost:${info.port}/api/files?file=${encodeURIComponent(
          resolved
        )}`,
        { method: 'DELETE' }
      );
      if (res.ok) console.log(`[vync] Closed: ${resolved}`);
    } catch {
      console.error('[vync] Server not reachable.');
      return;
    }
  } else {
    try {
      await fetch(`http://localhost:${info.port}/api/files?all=true`, {
        method: 'DELETE',
      });
      console.log('[vync] All files closed.');
    } catch {
      console.error('[vync] Server not reachable.');
      return;
    }
  }

  // Check if server should stop (no files left)
  if (!opts?.keepServer) {
    try {
      const filesRes = await fetch(`http://localhost:${info.port}/api/files`);
      const body = await filesRes.json();
      if ((body as any).files.length === 0) {
        await vyncStop();
      }
    } catch {
      // Server already gone
    }
  }
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
  const port = info.port ?? PORT;
  let portFree = false;
  const portStart = Date.now();
  while (Date.now() - portStart < 2000) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createConnection({ port, host: '127.0.0.1' });
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
    console.error(`[vync] Warning: port ${port} still in use after stop.`);
  }
  console.log(`[vync] Server stopped (PID ${info.pid})`);
}
