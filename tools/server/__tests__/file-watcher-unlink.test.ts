import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFileWatcher } from '../file-watcher.js';

describe('FileWatcher unlink', () => {
  it('calls onDelete when file is removed', async () => {
    const tmpFile = path.join(os.tmpdir(), `watcher-unlink-${Date.now()}.vync`);
    await fs.writeFile(tmpFile, '{}');

    const deletePromise = new Promise<void>((resolve) => {
      const watcher = createFileWatcher(tmpFile, {
        onChange: () => {},
        onDelete: () => {
          resolve();
          watcher.close();
        },
      });

      // Wait for watcher to be ready, then delete
      watcher.on('ready', () => {
        // Small delay after ready to ensure FSEvents is fully registered
        setTimeout(() => {
          fs.unlink(tmpFile).catch(() => {});
        }, 200);
      });
    });

    // Should resolve within 5s (generous timeout for macOS FSEvents)
    await expect(
      Promise.race([
        deletePromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('onDelete not called within 5s')), 5000)
        ),
      ])
    ).resolves.toBeUndefined();
  }, 10000);

  it('still works with function callback (backward compat)', async () => {
    const tmpFile = path.join(os.tmpdir(), `watcher-compat-${Date.now()}.vync`);
    await fs.writeFile(tmpFile, '{}');

    const watcher = createFileWatcher(tmpFile, (_content) => {
      // no-op
    });

    await new Promise<void>((resolve) => watcher.on('ready', resolve));
    await watcher.close();
    await fs.unlink(tmpFile).catch(() => {});
  });
});
