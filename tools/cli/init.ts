import fs from 'node:fs/promises';
import path from 'node:path';
import type { VyncFile } from '@vync/shared';

const EMPTY_CANVAS: VyncFile = {
  version: 1,
  viewport: { zoom: 1, x: 0, y: 0 },
  elements: [],
};

export async function vyncInit(filePath: string): Promise<string> {
  const resolved = filePath.endsWith('.vync') ? filePath : `${filePath}.vync`;
  const absolute = path.resolve(resolved);

  try {
    await fs.access(absolute);
    throw new Error(`File already exists: ${absolute}`);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, JSON.stringify(EMPTY_CANVAS, null, 2), 'utf-8');

  return absolute;
}
