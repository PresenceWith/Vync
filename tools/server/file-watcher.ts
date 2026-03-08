import chokidar from 'chokidar';
import fs from 'node:fs/promises';

export function createFileWatcher(
  filePath: string,
  onChange: (content: string) => void
) {
  const watcher = chokidar.watch(filePath, {
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher.on('change', async () => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      onChange(content);
    } catch (err) {
      console.error('[vync] Error reading changed file:', err);
    }
  });

  return watcher;
}
