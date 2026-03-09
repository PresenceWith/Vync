import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileRegistry } from '../file-registry.js';
import { addAllowedDir, clearAllowedDirs } from '../security.js';

describe('FileRegistry', () => {
  const tmpDir = path.join(os.tmpdir(), `vync-registry-test-${Date.now()}`);
  let registry: FileRegistry;
  const makeFile = async (name: string) => {
    const p = path.join(tmpDir, name);
    await fs.writeFile(p, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    return p;
  };

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    clearAllowedDirs();
    addAllowedDir(tmpDir);
    registry = new FileRegistry();
  });

  afterEach(async () => {
    await registry.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registers a file and lists it', async () => {
    const p = await makeFile('a.vync');
    await registry.register(p);
    const realP = await fs.realpath(p);
    expect(registry.listFiles()).toContain(realP);
  });

  it('register is idempotent', async () => {
    const p = await makeFile('b.vync');
    await registry.register(p);
    await registry.register(p); // no error
    expect(registry.listFiles()).toHaveLength(1);
  });

  it('unregisters a file', async () => {
    const p = await makeFile('c.vync');
    await registry.register(p);
    const realP = await fs.realpath(p);
    await registry.unregister(realP);
    expect(registry.listFiles()).not.toContain(realP);
  });

  it('getSync returns SyncService for registered file', async () => {
    const p = await makeFile('d.vync');
    await registry.register(p);
    const realP = await fs.realpath(p);
    const sync = registry.getSync(realP);
    expect(sync).toBeDefined();
    expect(sync!.filePath).toBe(realP);
  });

  it('getSync returns undefined for unregistered file', () => {
    expect(registry.getSync('/nonexistent.vync')).toBeUndefined();
  });

  it('enforces max file limit', async () => {
    const oldMax = FileRegistry.MAX_FILES;
    FileRegistry.MAX_FILES = 2;
    const p1 = await makeFile('e1.vync');
    const p2 = await makeFile('e2.vync');
    const p3 = await makeFile('e3.vync');
    await registry.register(p1);
    await registry.register(p2);
    await expect(registry.register(p3)).rejects.toThrow('Maximum');
    FileRegistry.MAX_FILES = oldMax;
  });

  it('emits registered/unregistered events', async () => {
    const events: string[] = [];
    registry.on('registered', (fp: string) => events.push(`reg:${path.basename(fp)}`));
    registry.on('unregistered', (fp: string) => events.push(`unreg:${path.basename(fp)}`));
    const p = await makeFile('f.vync');
    await registry.register(p);
    const realP = await fs.realpath(p);
    await registry.unregister(realP);
    expect(events).toEqual([`reg:f.vync`, `unreg:f.vync`]);
  });

  it('emits empty event when last file unregistered', async () => {
    let emptyCalled = false;
    registry.on('empty', () => { emptyCalled = true; });
    const p = await makeFile('g.vync');
    await registry.register(p);
    const realP = await fs.realpath(p);
    await registry.unregister(realP);
    expect(emptyCalled).toBe(true);
  });

  it('blocks register during pending unregister', async () => {
    const p = await makeFile('h.vync');
    await registry.register(p);
    const realP = await fs.realpath(p);
    const unregPromise = registry.unregister(realP);
    await unregPromise;
    // Now register should succeed
    await registry.register(p);
    expect(registry.listFiles()).toContain(realP);
  });
});
