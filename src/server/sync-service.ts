import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../shared/hash.js';
import type { VyncFile } from '../shared/types.js';

export function createSyncService(filePath: string) {
  let lastHash: string | null = null;
  let isWriting = false;
  let lastValidContent: string | null = null;

  // Initialize hash from current file
  async function init(): Promise<VyncFile> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as VyncFile;
    lastHash = sha256(content);
    lastValidContent = content;
    return data;
  }

  // Atomic write: tmp + rename, with echo prevention
  async function writeFile(data: VyncFile): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    const hash = sha256(content);

    // Skip if content hasn't changed
    if (hash === lastHash) return;

    const dir = path.dirname(filePath);
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp`);

    isWriting = true;
    try {
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, filePath);
      lastHash = hash;
      lastValidContent = content;
    } finally {
      // Small delay to ensure chokidar picks up the write before we clear the flag
      setTimeout(() => {
        isWriting = false;
      }, 100);
    }
  }

  // Called by file watcher: returns parsed data if it's an external change, null otherwise
  function handleFileChange(content: string): VyncFile | null {
    // If we're currently writing, ignore (our own write)
    if (isWriting) return null;

    // Validate JSON
    let data: VyncFile;
    try {
      data = JSON.parse(content) as VyncFile;
    } catch {
      console.error('[vync] Invalid JSON in changed file, keeping previous state');
      return null;
    }

    // Compare hash to detect echo
    const hash = sha256(content);
    if (hash === lastHash) return null;

    // External change
    lastHash = hash;
    lastValidContent = content;
    return data;
  }

  // Read file with validation, falling back to last valid state
  async function readFile(): Promise<VyncFile> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as VyncFile;
      lastHash = sha256(content);
      lastValidContent = content;
      return data;
    } catch {
      if (lastValidContent) {
        console.error('[vync] Error reading file, returning last valid state');
        return JSON.parse(lastValidContent) as VyncFile;
      }
      throw new Error('No valid file content available');
    }
  }

  return { init, writeFile, handleFileChange, readFile };
}

export type SyncService = ReturnType<typeof createSyncService>;
