import path from 'node:path';

/** Caller's actual CWD (passed as VYNC_CALLER_CWD by bin/vync.js) */
function getCallerCwd(): string {
  return process.env.VYNC_CALLER_CWD || process.cwd();
}

/**
 * Resolve .vync file path:
 * - bare filename (no path separator): CWD/.vync/filename.vync
 * - relative/absolute path: resolve against caller CWD as-is
 */
export function resolveVyncPath(filePath: string): string {
  const withExt = filePath.endsWith('.vync') ? filePath : `${filePath}.vync`;
  const callerCwd = getCallerCwd();

  // bare filename → .vync/ subdirectory
  if (!withExt.includes(path.sep) && !withExt.includes('/')) {
    return path.resolve(callerCwd, '.vync', withExt);
  }

  // explicit path → resolve against caller CWD
  return path.resolve(callerCwd, withExt);
}
