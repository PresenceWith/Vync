import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { addAllowedDir, clearAllowedDirs } from '../security.js';

describe('Multi-file E2E', () => {
  const tmpDir = path.join(os.tmpdir(), `vync-e2e-${Date.now()}`);
  let shutdownFn: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (shutdownFn) { await shutdownFn(); shutdownFn = null; }
    clearAllowedDirs();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('two files: independent editing + isolation', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const fileA = path.join(tmpDir, 'a.vync');
    const fileB = path.join(tmpDir, 'b.vync');
    const baseData = { version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] };
    await fs.writeFile(fileA, JSON.stringify(baseData));
    await fs.writeFile(fileB, JSON.stringify(baseData));
    addAllowedDir(tmpDir);

    const { startServer } = await import('../server.js');
    const port = 3400 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production' });
    shutdownFn = result.shutdown;

    const base = `http://localhost:${port}`;
    const realA = await fs.realpath(fileA);
    const realB = await fs.realpath(fileB);

    // Register both files
    await fetch(`${base}/api/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: realA }) });
    await fetch(`${base}/api/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: realB }) });

    // Verify both accessible
    const resA = await fetch(`${base}/api/sync?file=${encodeURIComponent(realA)}`);
    const resB = await fetch(`${base}/api/sync?file=${encodeURIComponent(realB)}`);
    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);

    // Write to file A
    await fetch(`${base}/api/sync?file=${encodeURIComponent(realA)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseData, elements: [{ id: 'aaaaa' }] }),
    });

    // File B should be unchanged
    const bData = await (await fetch(`${base}/api/sync?file=${encodeURIComponent(realB)}`)).json();
    expect(bData.elements).toHaveLength(0);

    // File A should have the element
    const aData = await (await fetch(`${base}/api/sync?file=${encodeURIComponent(realA)}`)).json();
    expect(aData.elements).toHaveLength(1);

    // Unregister file A
    await fetch(`${base}/api/files?file=${encodeURIComponent(realA)}`, { method: 'DELETE' });

    // File A should be 404 now
    const resA2 = await fetch(`${base}/api/sync?file=${encodeURIComponent(realA)}`);
    expect(resA2.status).toBe(404);

    // File B still works
    const resB2 = await fetch(`${base}/api/sync?file=${encodeURIComponent(realB)}`);
    expect(resB2.ok).toBe(true);
  });

  it('security: rejects non-.vync files', async () => {
    const { startServer } = await import('../server.js');
    const port = 3400 + Math.floor(Math.random() * 100);
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
