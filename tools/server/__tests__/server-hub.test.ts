import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { addAllowedDir, clearAllowedDirs } from '../security.js';

describe('Hub Server', () => {
  const tmpDir = path.join(os.tmpdir(), `vync-hub-test-${Date.now()}`);
  let shutdownFn: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (shutdownFn) { await shutdownFn(); shutdownFn = null; }
    clearAllowedDirs();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('starts without initial file and responds to /api/health', async () => {
    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production' });
    shutdownFn = result.shutdown;

    const res = await fetch(`http://localhost:${port}/api/health`);
    const body = await res.json();
    expect(body.version).toBe(2);
    expect(body.mode).toBe('hub');
    expect(body.fileCount).toBe(0);
  });

  it('registers a file via POST /api/files', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'a.vync');
    await fs.writeFile(filePath, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    addAllowedDir(tmpDir);

    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production' });
    shutdownFn = result.shutdown;

    const realPath = await fs.realpath(filePath);

    const res = await fetch(`http://localhost:${port}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Host': `localhost:${port}` },
      body: JSON.stringify({ filePath: realPath }),
    });
    expect(res.status).toBe(201);

    // Verify file is accessible
    const syncRes = await fetch(`http://localhost:${port}/api/sync?file=${encodeURIComponent(realPath)}`);
    expect(syncRes.ok).toBe(true);
    const data = await syncRes.json();
    expect(data.version).toBe(1);
  });

  it('returns 400 when ?file= missing on /api/sync', async () => {
    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production' });
    shutdownFn = result.shutdown;

    const res = await fetch(`http://localhost:${port}/api/sync`);
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-.vync file', async () => {
    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production' });
    shutdownFn = result.shutdown;

    const res = await fetch(`http://localhost:${port}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/etc/passwd' }),
    });
    expect(res.status).toBe(403);
  });
});
