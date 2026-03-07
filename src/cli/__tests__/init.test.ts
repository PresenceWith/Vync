import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { vyncInit } from '../init.js';

describe('vyncInit', () => {
  const tmpDir = path.join(os.tmpdir(), 'vync-test-init');

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a valid .vync file with empty canvas', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'test.vync');

    await vyncInit(filePath);

    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    expect(data.version).toBe(1);
    expect(data.viewport).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(data.elements).toEqual([]);
  });

  it('throws if file already exists', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'existing.vync');
    await fs.writeFile(filePath, '{}');

    await expect(vyncInit(filePath)).rejects.toThrow('already exists');
  });

  it('appends .vync extension if missing', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'test');

    await vyncInit(filePath);

    const exists = await fs.access(path.join(tmpDir, 'test.vync')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
