import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import {
  readServerInfo,
  writeServerInfo,
  vyncStop,
  getPidFilePath,
  getVyncDir,
  type ServerInfo,
} from '../open.js';

// readServerInfo/writeServerInfo use module constants VYNC_DIR/PID_FILE
// so they touch real ~/.vync/server.pid. Backup/restore around tests.
const REAL_PID_FILE = getPidFilePath();
const REAL_VYNC_DIR = getVyncDir();
let pidBackup: string | null = null;

beforeEach(async () => {
  try {
    pidBackup = await fs.readFile(REAL_PID_FILE, 'utf-8');
  } catch {
    pidBackup = null;
  }
});

afterEach(async () => {
  if (pidBackup !== null) {
    await fs.writeFile(REAL_PID_FILE, pidBackup, 'utf-8');
  } else {
    await fs.unlink(REAL_PID_FILE).catch(() => {});
  }
});

describe('writeServerInfo + readServerInfo', () => {
  it('round-trips ServerInfo correctly', async () => {
    const info: ServerInfo = {
      version: 2,
      pid: 12345,
      mode: 'daemon',
      port: 3100,
    };
    await writeServerInfo(info);
    const result = await readServerInfo();
    expect(result).toEqual(info);
  });

  it('handles all three modes', async () => {
    for (const mode of ['daemon', 'electron', 'foreground'] as const) {
      await writeServerInfo({ version: 2, pid: 99, mode, port: 3100 });
      const result = await readServerInfo();
      expect(result?.mode).toBe(mode);
    }
  });

  it('handles custom port', async () => {
    const info: ServerInfo = {
      version: 2,
      pid: 42,
      mode: 'daemon',
      port: 4200,
    };
    await writeServerInfo(info);
    const result = await readServerInfo();
    expect(result).toEqual(info);
  });
});

describe('readServerInfo edge cases', () => {
  it('returns null when PID file does not exist', async () => {
    await fs.unlink(REAL_PID_FILE).catch(() => {});
    expect(await readServerInfo()).toBeNull();
  });

  it('returns null and cleans up old single-line PID format', async () => {
    await fs.mkdir(REAL_VYNC_DIR, { recursive: true });
    await fs.writeFile(REAL_PID_FILE, '12345', 'utf-8');
    expect(await readServerInfo()).toBeNull();
    await expect(fs.access(REAL_PID_FILE)).rejects.toThrow();
  });

  it('reads legacy two-line PID format as version 1', async () => {
    await fs.mkdir(REAL_VYNC_DIR, { recursive: true });
    await fs.writeFile(REAL_PID_FILE, '12345\ndaemon', 'utf-8');
    const result = await readServerInfo();
    expect(result).toEqual({ version: 1, pid: 12345, mode: 'daemon', port: 3100 });
  });

  it('returns null for empty file', async () => {
    await fs.mkdir(REAL_VYNC_DIR, { recursive: true });
    await fs.writeFile(REAL_PID_FILE, '', 'utf-8');
    expect(await readServerInfo()).toBeNull();
  });
});

describe('vyncStop', () => {
  it('handles missing PID file gracefully', async () => {
    await fs.unlink(REAL_PID_FILE).catch(() => {});
    // Should not throw
    await vyncStop();
  });

  it('handles stale PID (process already gone)', async () => {
    // Write a PID that doesn't exist (very high number)
    await writeServerInfo({
      version: 2,
      pid: 2147483647,
      mode: 'daemon',
      port: 3100,
    });
    await vyncStop();
    // PID file should be cleaned up
    await expect(fs.access(REAL_PID_FILE)).rejects.toThrow();
  });

  it('stops a real spawned process', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
    const pid = child.pid!;
    child.unref();

    await writeServerInfo({
      version: 2,
      pid,
      mode: 'daemon',
      port: 3100,
    });

    await vyncStop();

    // Process should be dead
    expect(() => process.kill(pid, 0)).toThrow();
    // PID file should be gone
    await expect(fs.access(REAL_PID_FILE)).rejects.toThrow();
  });
});
