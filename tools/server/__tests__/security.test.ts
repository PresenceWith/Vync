import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  validateFilePath,
  addAllowedDir,
  clearAllowedDirs,
} from '../security.js';

describe('validateFilePath', () => {
  const tmpDir = path.join(os.tmpdir(), 'vync-security-test');

  beforeEach(async () => {
    clearAllowedDirs();
    await fs.mkdir(tmpDir, { recursive: true });
    addAllowedDir(tmpDir);
  });

  it('rejects non-.vync extension', async () => {
    await expect(validateFilePath('/etc/passwd')).rejects.toThrow(
      'Only .vync files permitted'
    );
  });

  it('rejects path outside allowed dirs', async () => {
    await expect(validateFilePath('/tmp/evil.vync')).rejects.toThrow(
      'outside allowed directories'
    );
  });

  it('accepts valid .vync path inside allowed dir', async () => {
    const filePath = path.join(tmpDir, 'test.vync');
    await fs.writeFile(filePath, '{}');
    const result = await validateFilePath(filePath);
    // On macOS, tmpdir resolves via /private — so compare with realpath
    const expected = await fs.realpath(filePath);
    expect(result).toBe(expected);
  });

  it('resolves .. segments before allowlist check', async () => {
    // Use a single .. to land in the parent of tmpDir (which exists)
    await expect(
      validateFilePath(path.join(tmpDir, '..', 'escaped.vync'))
    ).rejects.toThrow('outside allowed directories');
  });

  it('handles non-existent file (create case) via parent dir', async () => {
    const filePath = path.join(tmpDir, 'new.vync');
    const result = await validateFilePath(filePath);
    const parentReal = await fs.realpath(tmpDir);
    expect(result).toBe(path.join(parentReal, 'new.vync'));
  });
});
