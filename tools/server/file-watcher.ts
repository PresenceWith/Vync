import chokidar from 'chokidar';
import fs from 'node:fs/promises';

export interface FileWatcherCallbacks {
  onChange: (content: string) => void;
  onDelete?: () => void;
}

export function createFileWatcher(
  filePath: string,
  callbacks: FileWatcherCallbacks | ((content: string) => void)
) {
  const { onChange, onDelete } =
    typeof callbacks === 'function'
      ? { onChange: callbacks, onDelete: undefined }
      : callbacks;

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

  if (onDelete) {
    watcher.on('unlink', () => {
      console.log(`[vync] File deleted: ${filePath}`);
      onDelete();
    });
  }

  return watcher;
}
