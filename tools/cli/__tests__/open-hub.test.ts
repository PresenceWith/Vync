import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import {
  readServerInfo,
  writeServerInfo,
  getPidFilePath,
  getVyncDir,
  type ServerInfo,
} from '../open.js';

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

describe('PID file JSON format', () => {
  it('writes and reads JSON format', async () => {
    const info: ServerInfo = { version: 2, pid: 99999, mode: 'daemon', port: 3100 };
    await writeServerInfo(info);
    const read = await readServerInfo();
    expect(read).toEqual(info);
  });

  it('reads legacy 3-line format', async () => {
    await fs.mkdir(REAL_VYNC_DIR, { recursive: true });
    await fs.writeFile(REAL_PID_FILE, '12345\ndaemon\n/path/to/file.vync');
    const read = await readServerInfo();
    expect(read).toEqual({ version: 1, pid: 12345, mode: 'daemon', port: 3100 });
  });

  it('returns null for corrupt file', async () => {
    await fs.mkdir(REAL_VYNC_DIR, { recursive: true });
    await fs.writeFile(REAL_PID_FILE, 'garbage');
    const read = await readServerInfo();
    expect(read).toBeNull();
    await expect(fs.access(REAL_PID_FILE)).rejects.toThrow();
  });
});
