import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';

const allowedDirs: Set<string> = new Set();

export function addAllowedDir(dir: string): void {
  try {
    allowedDirs.add(fsSync.realpathSync(path.resolve(dir)));
  } catch {
    allowedDirs.add(path.resolve(dir));
  }
}

export function clearAllowedDirs(): void {
  allowedDirs.clear();
}

export function getAllowedDirs(): ReadonlySet<string> {
  return allowedDirs;
}

export async function validateFilePath(rawPath: string): Promise<string> {
  const resolved = path.resolve(rawPath);

  if (!resolved.endsWith('.vync')) {
    throw new Error('Only .vync files permitted');
  }

  // Resolve symlinks: use realpath for existing files, parent realpath for new files
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch {
    try {
      const parentReal = await fs.realpath(path.dirname(resolved));
      real = path.join(parentReal, path.basename(resolved));
    } catch {
      throw new Error(`Parent directory does not exist: ${path.dirname(resolved)}`);
    }
  }

  const allowed = [...allowedDirs].some((dir) => {
    return real.startsWith(dir + path.sep) || real === dir;
  });
  if (!allowed) {
    throw new Error(`Path outside allowed directories: ${real}`);
  }

  return real;
}

export function createHostGuard(port: number) {
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
  return (req: any, res: any, next: any) => {
    const host = req.headers.host;
    if (!host || !allowed.includes(host)) {
      res.status(421).json({ error: 'Invalid Host header' });
      return;
    }
    next();
  };
}
