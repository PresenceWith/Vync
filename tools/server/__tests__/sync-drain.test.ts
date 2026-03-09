import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSyncService } from '../sync-service.js';

describe('SyncService.drain', () => {
  it('resolves immediately when no writes pending', async () => {
    const tmpFile = path.join(os.tmpdir(), `drain-test-${Date.now()}.vync`);
    await fs.writeFile(tmpFile, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    const sync = createSyncService(tmpFile);
    await sync.init();
    await sync.drain(); // should not hang
    await fs.unlink(tmpFile).catch(() => {});
  });

  it('waits for in-flight write to complete', async () => {
    const tmpFile = path.join(os.tmpdir(), `drain-test2-${Date.now()}.vync`);
    const data = { version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [{ id: 'aaaaa' }] };
    await fs.writeFile(tmpFile, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    const sync = createSyncService(tmpFile);
    await sync.init();
    // Fire write without awaiting
    const writePromise = sync.writeFile(data);
    await sync.drain();
    // After drain, write must be complete
    const content = JSON.parse(await fs.readFile(tmpFile, 'utf-8'));
    expect(content.elements).toHaveLength(1);
    await writePromise;
    await fs.unlink(tmpFile).catch(() => {});
  });
});
