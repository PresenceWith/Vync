import fs from 'node:fs/promises';
import path from 'node:path';
import type { VyncCanvasFile, VyncGraphFile } from '@vync/shared';
import { resolveVyncPath } from './resolve.js';

interface InitOptions {
  type?: 'canvas' | 'graph';
}

const EMPTY_CANVAS: VyncCanvasFile = {
  version: 1,
  viewport: { zoom: 1, x: 0, y: 0 },
  elements: [],
};

const EMPTY_GRAPH: VyncGraphFile = {
  version: 1,
  type: 'graph',
  viewport: { zoom: 1, x: 0, y: 0 },
  nodes: [],
  edges: [],
};

export async function vyncInit(filePath: string, options?: InitOptions): Promise<string> {
  const absolute = resolveVyncPath(filePath);

  try {
    await fs.access(absolute);
    throw new Error(`File already exists: ${absolute}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const content = options?.type === 'graph' ? EMPTY_GRAPH : EMPTY_CANVAS;
  await fs.writeFile(absolute, JSON.stringify(content, null, 2), 'utf-8');

  return absolute;
}
