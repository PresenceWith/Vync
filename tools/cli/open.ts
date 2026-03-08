import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const VYNC_DIR = path.join(os.homedir(), '.vync');
const PID_FILE = path.join(VYNC_DIR, 'server.pid');
const LOG_FILE = path.join(VYNC_DIR, 'server.log');
const PORT = 3100;
const POLL_INTERVAL = 300;
const POLL_TIMEOUT = 10_000;

async function validateAndResolve(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  try {
    await fs.access(resolved);
  } catch {
    console.error(`[vync] File not found: ${resolved}`);
    console.error('[vync] Run "vync init <file>" first.');
    process.exit(1);
  }
  return resolved;
}

async function ensureNoExistingServer(): Promise<void> {
  try {
    const existingPid = await fs.readFile(PID_FILE, 'utf-8');
    process.kill(Number(existingPid.trim()), 0);
    console.error(
      `[vync] Server already running (PID ${existingPid.trim()}). Run "vync stop" first.`
    );
    process.exit(1);
  } catch {
    // Not running, continue
  }
}

async function runForeground(resolved: string): Promise<void> {
  await fs.mkdir(VYNC_DIR, { recursive: true });
  await fs.writeFile(PID_FILE, String(process.pid), 'utf-8');

  const { startServer } = await import('../server/server.js');
  const { shutdown } = await startServer(resolved, { openBrowser: true });

  process.on('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });
}

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
  await fs.writeFile(PID_FILE, String(childPid), 'utf-8');
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

export async function vyncStop(): Promise<void> {
  try {
    const pid = await fs.readFile(PID_FILE, 'utf-8');
    process.kill(Number(pid.trim()), 'SIGTERM');
    await fs.unlink(PID_FILE);
    console.log(`[vync] Server stopped (PID ${pid.trim()})`);
  } catch {
    console.error('[vync] No running server found.');
  }
}
