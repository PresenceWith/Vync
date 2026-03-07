import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const VYNC_DIR = path.join(os.homedir(), '.vync');
const PID_FILE = path.join(VYNC_DIR, 'server.pid');

export async function vyncOpen(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);

  try {
    await fs.access(resolved);
  } catch {
    console.error(`[vync] File not found: ${resolved}`);
    console.error('[vync] Run "vync init <file>" first.');
    process.exit(1);
  }

  // Check if server already running
  try {
    const existingPid = await fs.readFile(PID_FILE, 'utf-8');
    process.kill(Number(existingPid.trim()), 0);
    console.error(`[vync] Server already running (PID ${existingPid.trim()}). Run "vync stop" first.`);
    process.exit(1);
  } catch {
    // Not running, continue
  }

  // Write PID file
  await fs.mkdir(VYNC_DIR, { recursive: true });
  await fs.writeFile(PID_FILE, String(process.pid), 'utf-8');

  // Start server (dynamic import to avoid loading vite at CLI parse time)
  const { startServer } = await import('../server/server.js');
  await startServer(resolved, { openBrowser: true });
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
