import { EventEmitter } from 'node:events';
import { createSyncService, type SyncService } from './sync-service.js';
import { createFileWatcher } from './file-watcher.js';
import { validateFilePath } from './security.js';
import type { FSWatcher } from 'chokidar';
import type { WebSocket } from 'ws';
import type { WsMessage } from '@vync/shared';

interface FileEntry {
  sync: SyncService;
  watcher: FSWatcher;
  clients: Set<WebSocket>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class FileRegistry extends EventEmitter {
  static MAX_FILES = Number(process.env.VYNC_MAX_FILES) || 50;
  private files = new Map<string, FileEntry>();
  private pendingUnregister = new Set<string>();
  private hubClients = new Set<WebSocket>();

  addHubClient(ws: WebSocket): void {
    this.hubClients.add(ws);
  }

  removeHubClient(ws: WebSocket): void {
    this.hubClients.delete(ws);
  }

  private broadcastToHub(message: WsMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.hubClients) {
      if (client.readyState === 1 /* WebSocket.OPEN */) {
        client.send(data);
      }
    }
  }

  async register(filePath: string): Promise<void> {
    const validated = await validateFilePath(filePath);

    // Wait if unregister is in progress for this file
    while (this.pendingUnregister.has(validated)) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Idempotent
    if (this.files.has(validated)) {
      this.resetIdleTimer(validated);
      return;
    }

    if (this.files.size >= FileRegistry.MAX_FILES) {
      throw new Error(
        `Maximum number of tracked files (${FileRegistry.MAX_FILES}) reached`
      );
    }

    // Claim slot synchronously
    const entry: FileEntry = {
      sync: null as any,
      watcher: null as any,
      clients: new Set(),
    };
    this.files.set(validated, entry);

    try {
      entry.sync = createSyncService(validated);
      await entry.sync.init();
      entry.watcher = createFileWatcher(validated, {
        onChange: (content) => {
          const data = entry.sync.handleFileChange(content);
          if (data) {
            this.broadcastToFile(validated, {
              type: 'file-changed',
              filePath: validated,
              data,
            });
          }
        },
        onDelete: () => {
          this.broadcastToFile(validated, {
            type: 'file-deleted',
            filePath: validated,
          });
        },
      });
    } catch (err) {
      this.files.delete(validated);
      throw err;
    }

    this.emit('registered', validated);
    this.broadcastToHub({ type: 'hub-file-registered', filePath: validated });
  }

  async unregister(filePath: string): Promise<void> {
    const entry = this.files.get(filePath);
    if (!entry) return;

    this.pendingUnregister.add(filePath);

    try {
      // Notify clients
      this.broadcastToFile(filePath, { type: 'file-closed', filePath });

      // Drain write queue
      await entry.sync.drain();

      // Close watcher
      await entry.watcher.close();

      // Clear idle timer
      if (entry.idleTimer) clearTimeout(entry.idleTimer);

      // Close client connections
      for (const ws of entry.clients) {
        ws.close(4000, 'File unregistered');
      }

      this.files.delete(filePath);
    } finally {
      this.pendingUnregister.delete(filePath);
    }

    this.emit('unregistered', filePath);
    this.broadcastToHub({ type: 'hub-file-unregistered', filePath });
    if (this.files.size === 0) {
      this.emit('empty');
    }
  }

  getSync(filePath: string): SyncService | undefined {
    return this.files.get(filePath)?.sync;
  }

  getEntry(filePath: string): FileEntry | undefined {
    return this.files.get(filePath);
  }

  listFiles(): string[] {
    return [...this.files.keys()];
  }

  addClient(filePath: string, ws: WebSocket): void {
    const entry = this.files.get(filePath);
    if (!entry) return;
    entry.clients.add(ws);
    this.resetIdleTimer(filePath);
  }

  removeClient(filePath: string, ws: WebSocket): void {
    const entry = this.files.get(filePath);
    if (!entry) return;
    entry.clients.delete(ws);
    if (entry.clients.size === 0) {
      this.startIdleTimer(filePath);
    }
  }

  broadcastToFile(filePath: string, message: WsMessage): void {
    const entry = this.files.get(filePath);
    if (!entry) return;
    const data = JSON.stringify(message);
    for (const client of entry.clients) {
      if (client.readyState === 1 /* WebSocket.OPEN */) {
        client.send(data);
      }
    }
  }

  async shutdown(): Promise<void> {
    const files = [...this.files.keys()];
    for (const fp of files) {
      await this.unregister(fp).catch(() => {});
    }
    for (const ws of this.hubClients) {
      ws.close(1001, 'Server shutting down');
    }
    this.hubClients.clear();
  }

  private startIdleTimer(filePath: string): void {
    const entry = this.files.get(filePath);
    if (!entry) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      console.log(`[vync] Idle timeout: unregistering ${filePath}`);
      this.unregister(filePath).catch(() => {});
    }, IDLE_TIMEOUT_MS);
  }

  private resetIdleTimer(filePath: string): void {
    const entry = this.files.get(filePath);
    if (!entry) return;
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
  }
}
