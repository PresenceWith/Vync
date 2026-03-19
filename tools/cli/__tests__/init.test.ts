import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { vyncInit } from '../init.js';

describe('vyncInit', () => {
  const tmpDir = path.join(os.tmpdir(), 'vync-test-init');

  afterEach(async () => {
    delete process.env.VYNC_CALLER_CWD;
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

    const exists = await fs
      .access(path.join(tmpDir, 'test.vync'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it('creates file in .vync/ subdirectory for bare filename', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    process.env.VYNC_CALLER_CWD = tmpDir;

    await vyncInit('myplan');

    const expected = path.join(tmpDir, '.vync', 'myplan.vync');
    const exists = await fs
      .access(expected)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it('resolves explicit relative path against caller CWD', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    process.env.VYNC_CALLER_CWD = tmpDir;

    await vyncInit('./myplan');

    const expected = path.join(tmpDir, 'myplan.vync');
    const exists = await fs
      .access(expected)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it('creates a graph file with --type graph', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    process.env.VYNC_CALLER_CWD = tmpDir;

    await vyncInit('ontology', { type: 'graph' });

    const file = path.join(tmpDir, '.vync', 'ontology.vync');
    const raw = await fs.readFile(file, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.type).toBe('graph');
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
    expect(data.elements).toBeUndefined();
    expect(data.version).toBe(1);
    expect(data.viewport).toBeDefined();
  });

  it('graph init throws if file already exists', async () => {
    await fs.mkdir(path.join(tmpDir, '.vync'), { recursive: true });
    process.env.VYNC_CALLER_CWD = tmpDir;
    await fs.writeFile(path.join(tmpDir, '.vync', 'existing.vync'), '{}');

    await expect(vyncInit('existing', { type: 'graph' })).rejects.toThrow(
      'already exists'
    );
  });

  it('defaults to canvas when no type option given', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    process.env.VYNC_CALLER_CWD = tmpDir;

    await vyncInit('plain');

    const file = path.join(tmpDir, '.vync', 'plain.vync');
    const raw = await fs.readFile(file, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.elements).toEqual([]);
    expect(data.type).toBeUndefined();
  });
});
