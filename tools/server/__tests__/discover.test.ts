import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { addAllowedDir, clearAllowedDirs } from '../security.js';

const VYNC_STUB = JSON.stringify({
  version: 1,
  viewport: { zoom: 1, x: 0, y: 0 },
  elements: [],
});

describe('GET /api/files/discover', () => {
  const tmpDir = path.join(os.tmpdir(), `vync-discover-${Date.now()}`);
  let shutdownFn: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (shutdownFn) {
      await shutdownFn();
      shutdownFn = null;
    }
    clearAllowedDirs();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  async function startWithFile(filePath: string) {
    addAllowedDir(path.dirname(filePath));
    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({
      port,
      mode: 'production',
      initialFile: filePath,
    });
    shutdownFn = result.shutdown;
    return { port, ...result };
  }

  it('discovers unregistered .vync files in allowed directory', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const registered = path.join(tmpDir, 'a.vync');
    const unregistered = path.join(tmpDir, 'b.vync');
    await fs.writeFile(registered, VYNC_STUB);
    await fs.writeFile(unregistered, VYNC_STUB);

    const { port } = await startWithFile(registered);

    const res = await fetch(`http://localhost:${port}/api/files/discover`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    const realUnregistered = await fs.realpath(unregistered);
    expect(body.files).toContain(realUnregistered);
    // registered file should NOT appear
    const realRegistered = await fs.realpath(registered);
    expect(body.files).not.toContain(realRegistered);
  });

  it('ignores non-.vync files', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const vyncFile = path.join(tmpDir, 'a.vync');
    const txtFile = path.join(tmpDir, 'notes.txt');
    await fs.writeFile(vyncFile, VYNC_STUB);
    await fs.writeFile(txtFile, 'hello');

    const { port } = await startWithFile(vyncFile);

    const res = await fetch(`http://localhost:${port}/api/files/discover`);
    const body = await res.json();
    expect(body.files.every((f: string) => f.endsWith('.vync'))).toBe(true);
  });

  it('scans .vync/ subdirectory of allowed dir', async () => {
    const subDir = path.join(tmpDir, '.vync');
    await fs.mkdir(subDir, { recursive: true });
    const parentFile = path.join(tmpDir, 'main.vync');
    const subFile = path.join(subDir, 'sub.vync');
    await fs.writeFile(parentFile, VYNC_STUB);
    await fs.writeFile(subFile, VYNC_STUB);

    const { port } = await startWithFile(parentFile);

    const res = await fetch(`http://localhost:${port}/api/files/discover`);
    const body = await res.json();
    const realSub = await fs.realpath(subFile);
    expect(body.files).toContain(realSub);
  });

  it('returns empty array when no unregistered files exist', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const onlyFile = path.join(tmpDir, 'only.vync');
    await fs.writeFile(onlyFile, VYNC_STUB);

    const { port } = await startWithFile(onlyFile);

    const res = await fetch(`http://localhost:${port}/api/files/discover`);
    const body = await res.json();
    expect(body.files).toEqual([]);
  });

  it('handles non-existent scan directories gracefully', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const file = path.join(tmpDir, 'a.vync');
    await fs.writeFile(file, VYNC_STUB);

    // Add a non-existent dir to allowedDirs
    addAllowedDir('/tmp/does-not-exist-' + Date.now());

    const { port } = await startWithFile(file);

    const res = await fetch(`http://localhost:${port}/api/files/discover`);
    expect(res.ok).toBe(true);
    // Should not crash
  });
});
