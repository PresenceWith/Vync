import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const tmpBase = path.join(os.tmpdir(), `vync-discover-${Date.now()}`);

describe('discoverVyncFiles', () => {
  beforeEach(async () => {
    await fs.mkdir(tmpBase, { recursive: true });
    process.env.VYNC_CALLER_CWD = tmpBase;
  });

  afterEach(async () => {
    delete process.env.VYNC_CALLER_CWD;
    await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  });

  async function loadDiscover() {
    // Fresh import to pick up env changes
    const mod = await import('../discover.js');
    return mod.discoverVyncFiles;
  }

  const STUB = JSON.stringify({
    version: 1,
    viewport: { zoom: 1, x: 0, y: 0 },
    elements: [],
  });

  it('finds .vync files in CWD', async () => {
    await fs.writeFile(path.join(tmpBase, 'a.vync'), STUB);
    await fs.writeFile(path.join(tmpBase, 'b.vync'), STUB);
    await fs.writeFile(path.join(tmpBase, 'readme.md'), 'hello');

    const discover = await loadDiscover();
    const files = await discover();

    expect(files).toHaveLength(2);
    expect(files.every((f: string) => f.endsWith('.vync'))).toBe(true);
  });

  it('finds .vync files in CWD/.vync/ subdirectory', async () => {
    const subdir = path.join(tmpBase, '.vync');
    await fs.mkdir(subdir);
    await fs.writeFile(path.join(subdir, 'plan.vync'), STUB);

    const discover = await loadDiscover();
    const files = await discover();

    expect(files).toHaveLength(1);
    expect(files[0]).toContain('.vync/plan.vync');
  });

  it('combines CWD and .vync/ results', async () => {
    await fs.writeFile(path.join(tmpBase, 'root.vync'), STUB);
    const subdir = path.join(tmpBase, '.vync');
    await fs.mkdir(subdir);
    await fs.writeFile(path.join(subdir, 'sub.vync'), STUB);

    const discover = await loadDiscover();
    const files = await discover();

    expect(files).toHaveLength(2);
  });

  it('returns empty array when no .vync files exist', async () => {
    await fs.writeFile(path.join(tmpBase, 'readme.md'), 'hello');

    const discover = await loadDiscover();
    const files = await discover();

    expect(files).toEqual([]);
  });

  it('returns sorted results', async () => {
    await fs.writeFile(path.join(tmpBase, 'z.vync'), STUB);
    await fs.writeFile(path.join(tmpBase, 'a.vync'), STUB);
    await fs.writeFile(path.join(tmpBase, 'm.vync'), STUB);

    const discover = await loadDiscover();
    const files = await discover();

    const names = files.map((f: string) => path.basename(f));
    expect(names).toEqual(['a.vync', 'm.vync', 'z.vync']);
  });

  it('ignores node_modules and .git directories', async () => {
    const nm = path.join(tmpBase, 'node_modules', 'pkg');
    await fs.mkdir(nm, { recursive: true });
    await fs.writeFile(path.join(nm, 'bad.vync'), STUB);

    const git = path.join(tmpBase, '.git');
    await fs.mkdir(git, { recursive: true });
    await fs.writeFile(path.join(git, 'bad.vync'), STUB);

    await fs.writeFile(path.join(tmpBase, 'good.vync'), STUB);

    const discover = await loadDiscover();
    const files = await discover();

    expect(files).toHaveLength(1);
    expect(files[0]).toContain('good.vync');
  });
});
