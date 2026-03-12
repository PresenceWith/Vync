import fs from 'node:fs/promises';
import path from 'node:path';

/** Caller's actual CWD (passed as VYNC_CALLER_CWD by bin/vync.js) */
function getCallerCwd(): string {
  return process.env.VYNC_CALLER_CWD || process.cwd();
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

/**
 * Discover .vync files in the caller's CWD.
 * Scans: CWD/*.vync + CWD/.vync/*.vync (1 level only, no deep recursion).
 * Returns sorted absolute paths.
 */
export async function discoverVyncFiles(): Promise<string[]> {
  const cwd = getCallerCwd();
  const found: string[] = [];

  // Scan CWD for *.vync files
  try {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.vync')) {
        found.push(path.resolve(cwd, entry.name));
      }
    }
  } catch {
    // CWD not readable
  }

  // Scan CWD/.vync/ subdirectory
  const vyncSubdir = path.join(cwd, '.vync');
  try {
    const entries = await fs.readdir(vyncSubdir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.vync')) {
        found.push(path.resolve(vyncSubdir, entry.name));
      }
    }
  } catch {
    // .vync/ doesn't exist or not readable
  }

  // Scan immediate subdirectories (1 level, skip ignored)
  try {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name === '.vync' ||
        entry.name.startsWith('.') ||
        IGNORED_DIRS.has(entry.name)
      ) {
        continue;
      }
      const subdir = path.join(cwd, entry.name);
      try {
        const subEntries = await fs.readdir(subdir, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isFile() && sub.name.endsWith('.vync')) {
            found.push(path.resolve(subdir, sub.name));
          }
        }
      } catch {
        // subdirectory not readable
      }
    }
  } catch {
    // CWD not readable
  }

  // Deduplicate and sort
  return [...new Set(found)].sort();
}
