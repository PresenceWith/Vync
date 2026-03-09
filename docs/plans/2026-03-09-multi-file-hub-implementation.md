# Multi-File Hub Server — Stage 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 단일 파일 서버를 허브 아키텍처로 전환하여 여러 .vync 파일을 동시에 열고 편집할 수 있게 한다.

**Architecture:** 하나의 Express 서버(:3100)가 FileRegistry를 통해 여러 파일을 관리. 각 파일은 독립적인 SyncService + FileWatcher + WebSocket 클라이언트 집합을 가짐. CLI `vync open`은 서버 재시작 대신 파일 등록, `vync close`로 해제.

**Tech Stack:** TypeScript, Express, ws (WebSocket), chokidar, Node.js crypto (SHA-256)

**Design doc:** `docs/plans/2026-03-09-multi-file-hub-design.md`

---

## Task 1: Shared Types — WsMessage 확장

**Files:**
- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/src/__tests__/types.test.ts` (신규)

**Step 1: Write the failing test**

```typescript
// packages/shared/src/__tests__/types.test.ts
import { describe, it, expect } from 'vitest';
import type { WsMessage } from '../types.js';

describe('WsMessage', () => {
  it('should accept filePath field', () => {
    const msg: WsMessage = {
      type: 'file-changed',
      filePath: '/path/to/file.vync',
      data: { version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] },
    };
    expect(msg.filePath).toBe('/path/to/file.vync');
  });

  it('should accept new message types', () => {
    const closed: WsMessage = { type: 'file-closed', filePath: '/a.vync' };
    const deleted: WsMessage = { type: 'file-deleted', filePath: '/a.vync' };
    const error: WsMessage = { type: 'error', code: 'FILE_NOT_FOUND' };
    expect(closed.type).toBe('file-closed');
    expect(deleted.type).toBe('file-deleted');
    expect(error.code).toBe('FILE_NOT_FOUND');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/src/__tests__/types.test.ts`
Expected: FAIL — `filePath`, `code` not in type, `'file-closed'` etc not assignable.

**Step 3: Update types**

```typescript
// packages/shared/src/types.ts
export interface VyncViewport {
  zoom: number;
  x: number;
  y: number;
}

export interface VyncFile<T = unknown> {
  version: number;
  viewport: VyncViewport;
  elements: T[];
}

export interface WsMessage<T = unknown> {
  type: 'file-changed' | 'connected' | 'file-closed' | 'file-deleted' | 'error';
  filePath?: string;
  data?: VyncFile<T>;
  code?: string;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/shared/src/__tests__/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/__tests__/types.test.ts
git commit -m "feat(shared): extend WsMessage with filePath, file-closed, file-deleted, error types"
```

---

## Task 2: Security Layer — validateFilePath + hostGuard

**Files:**
- Create: `tools/server/security.ts`
- Test: `tools/server/__tests__/security.test.ts` (신규)

**Step 1: Write the failing test**

```typescript
// tools/server/__tests__/security.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { validateFilePath, addAllowedDir, clearAllowedDirs } from '../security.js';

describe('validateFilePath', () => {
  const tmpDir = path.join(os.tmpdir(), 'vync-security-test');

  beforeEach(async () => {
    clearAllowedDirs();
    await fs.mkdir(tmpDir, { recursive: true });
    addAllowedDir(tmpDir);
  });

  it('rejects non-.vync extension', async () => {
    await expect(validateFilePath('/etc/passwd')).rejects.toThrow('Only .vync files permitted');
  });

  it('rejects path outside allowed dirs', async () => {
    await expect(validateFilePath('/tmp/evil.vync')).rejects.toThrow('outside allowed directories');
  });

  it('accepts valid .vync path inside allowed dir', async () => {
    const filePath = path.join(tmpDir, 'test.vync');
    await fs.writeFile(filePath, '{}');
    const result = await validateFilePath(filePath);
    expect(result).toBe(filePath);
  });

  it('resolves .. segments before allowlist check', async () => {
    await expect(
      validateFilePath(path.join(tmpDir, '..', '..', 'etc', 'passwd.vync'))
    ).rejects.toThrow('outside allowed directories');
  });

  it('handles non-existent file (create case) via parent dir', async () => {
    const filePath = path.join(tmpDir, 'new.vync');
    const result = await validateFilePath(filePath);
    expect(result).toBe(filePath);
  });

  it('rejects when max files reached', async () => {
    // Tested in FileRegistry, not here — validateFilePath does not check count
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tools/server/__tests__/security.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement security.ts**

```typescript
// tools/server/security.ts
import path from 'node:path';
import fs from 'node:fs/promises';

const allowedDirs: Set<string> = new Set();

export function addAllowedDir(dir: string): void {
  allowedDirs.add(path.resolve(dir));
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

  const allowed = [...allowedDirs].some(
    (dir) => real.startsWith(dir + path.sep) || real === path.resolve(dir)
  );
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tools/server/__tests__/security.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/server/security.ts tools/server/__tests__/security.test.ts
git commit -m "feat(server): add validateFilePath security layer with allowlist and host guard"
```

---

## Task 3: SyncService — drain() 메서드 추가

**Files:**
- Modify: `tools/server/sync-service.ts:9,48-49,94`
- Test: `tools/server/__tests__/sync-drain.test.ts` (신규)

**Step 1: Write the failing test**

```typescript
// tools/server/__tests__/sync-drain.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSyncService } from '../sync-service.js';

describe('SyncService.drain', () => {
  it('resolves immediately when no writes pending', async () => {
    const tmpFile = path.join(os.tmpdir(), `drain-test-${Date.now()}.vync`);
    await fs.writeFile(tmpFile, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    const sync = createSyncService(tmpFile);
    await sync.init();
    await sync.drain(); // should not hang
    await fs.unlink(tmpFile).catch(() => {});
  });

  it('waits for in-flight write to complete', async () => {
    const tmpFile = path.join(os.tmpdir(), `drain-test2-${Date.now()}.vync`);
    const data = { version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [{ id: 'aaaaa' }] };
    await fs.writeFile(tmpFile, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    const sync = createSyncService(tmpFile);
    await sync.init();
    // Fire write without awaiting
    const writePromise = sync.writeFile(data);
    await sync.drain();
    // After drain, write must be complete
    const content = JSON.parse(await fs.readFile(tmpFile, 'utf-8'));
    expect(content.elements).toHaveLength(1);
    await writePromise;
    await fs.unlink(tmpFile).catch(() => {});
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tools/server/__tests__/sync-drain.test.ts`
Expected: FAIL — `sync.drain is not a function`

**Step 3: Add drain() + expose filePath**

Modify `tools/server/sync-service.ts`:

At line 94, change the return statement from:
```typescript
  return { init, writeFile, handleFileChange, readFile };
```
to:
```typescript
  async function drain(): Promise<void> {
    await writeQueue;
  }

  return { init, writeFile, handleFileChange, readFile, drain, filePath };
```

Also update the type export at line 97 — no change needed (ReturnType auto-updates).

**Step 4: Run test to verify it passes**

Run: `npx vitest run tools/server/__tests__/sync-drain.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/server/sync-service.ts tools/server/__tests__/sync-drain.test.ts
git commit -m "feat(sync): add drain() method for graceful write queue completion"
```

---

## Task 4: FileWatcher — unlink 이벤트 지원

**Files:**
- Modify: `tools/server/file-watcher.ts:4-6,16-23`
- Test: `tools/server/__tests__/file-watcher-unlink.test.ts` (신규)

**Step 1: Write the failing test**

```typescript
// tools/server/__tests__/file-watcher-unlink.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFileWatcher } from '../file-watcher.js';

describe('FileWatcher unlink', () => {
  it('calls onDelete when file is removed', async () => {
    const tmpFile = path.join(os.tmpdir(), `watcher-unlink-${Date.now()}.vync`);
    await fs.writeFile(tmpFile, '{}');

    let deleteCalled = false;
    const watcher = createFileWatcher(tmpFile, {
      onChange: () => {},
      onDelete: () => { deleteCalled = true; },
    });

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => watcher.on('ready', resolve));

    await fs.unlink(tmpFile);

    // Wait for event propagation
    await new Promise((r) => setTimeout(r, 500));
    expect(deleteCalled).toBe(true);
    await watcher.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tools/server/__tests__/file-watcher-unlink.test.ts`
Expected: FAIL — `createFileWatcher` doesn't accept object callbacks.

**Step 3: Update file-watcher.ts**

```typescript
// tools/server/file-watcher.ts
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tools/server/__tests__/file-watcher-unlink.test.ts`
Expected: PASS

**Step 5: Verify existing server still compiles** (file-watcher backward compat — old call with function still works)

Run: `npx tsc --noEmit -p tools/server/tsconfig.json 2>&1 || npx tsc --noEmit`
Expected: No new errors (function callback still accepted via union type).

**Step 6: Commit**

```bash
git add tools/server/file-watcher.ts tools/server/__tests__/file-watcher-unlink.test.ts
git commit -m "feat(watcher): support onDelete callback for file unlink events"
```

---

## Task 5: FileRegistry — 핵심 추상화

**Files:**
- Create: `tools/server/file-registry.ts`
- Test: `tools/server/__tests__/file-registry.test.ts` (신규)

**Step 1: Write the failing test**

```typescript
// tools/server/__tests__/file-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileRegistry } from '../file-registry.js';
import { addAllowedDir, clearAllowedDirs } from '../security.js';

describe('FileRegistry', () => {
  const tmpDir = path.join(os.tmpdir(), `vync-registry-test-${Date.now()}`);
  let registry: FileRegistry;
  const makeFile = async (name: string) => {
    const p = path.join(tmpDir, name);
    await fs.writeFile(p, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    return p;
  };

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    clearAllowedDirs();
    addAllowedDir(tmpDir);
    registry = new FileRegistry();
  });

  afterEach(async () => {
    await registry.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registers a file and lists it', async () => {
    const p = await makeFile('a.vync');
    await registry.register(p);
    expect(registry.listFiles()).toContain(p);
  });

  it('register is idempotent', async () => {
    const p = await makeFile('b.vync');
    await registry.register(p);
    await registry.register(p); // no error
    expect(registry.listFiles()).toHaveLength(1);
  });

  it('unregisters a file', async () => {
    const p = await makeFile('c.vync');
    await registry.register(p);
    await registry.unregister(p);
    expect(registry.listFiles()).not.toContain(p);
  });

  it('getSync returns SyncService for registered file', async () => {
    const p = await makeFile('d.vync');
    await registry.register(p);
    const sync = registry.getSync(p);
    expect(sync).toBeDefined();
    expect(sync!.filePath).toBe(p);
  });

  it('getSync returns undefined for unregistered file', () => {
    expect(registry.getSync('/nonexistent.vync')).toBeUndefined();
  });

  it('enforces max file limit', async () => {
    const oldMax = FileRegistry.MAX_FILES;
    FileRegistry.MAX_FILES = 2;
    const p1 = await makeFile('e1.vync');
    const p2 = await makeFile('e2.vync');
    const p3 = await makeFile('e3.vync');
    await registry.register(p1);
    await registry.register(p2);
    await expect(registry.register(p3)).rejects.toThrow('Maximum');
    FileRegistry.MAX_FILES = oldMax;
  });

  it('emits registered/unregistered events', async () => {
    const events: string[] = [];
    registry.on('registered', (fp: string) => events.push(`reg:${path.basename(fp)}`));
    registry.on('unregistered', (fp: string) => events.push(`unreg:${path.basename(fp)}`));
    const p = await makeFile('f.vync');
    await registry.register(p);
    await registry.unregister(p);
    expect(events).toEqual([`reg:f.vync`, `unreg:f.vync`]);
  });

  it('emits empty event when last file unregistered', async () => {
    let emptyCalled = false;
    registry.on('empty', () => { emptyCalled = true; });
    const p = await makeFile('g.vync');
    await registry.register(p);
    await registry.unregister(p);
    expect(emptyCalled).toBe(true);
  });

  it('blocks register during pending unregister', async () => {
    const p = await makeFile('h.vync');
    await registry.register(p);
    const unregPromise = registry.unregister(p);
    // While unregister is in progress, register should wait
    await unregPromise;
    // Now register should succeed
    await registry.register(p);
    expect(registry.listFiles()).toContain(p);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tools/server/__tests__/file-registry.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement FileRegistry**

```typescript
// tools/server/file-registry.ts
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
      throw new Error(`Maximum number of tracked files (${FileRegistry.MAX_FILES}) reached`);
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
            this.broadcastToFile(validated, { type: 'file-changed', filePath: validated, data });
          }
        },
        onDelete: () => {
          this.broadcastToFile(validated, { type: 'file-deleted', filePath: validated });
        },
      });
    } catch (err) {
      this.files.delete(validated);
      throw err;
    }

    this.emit('registered', validated);
  }

  async unregister(filePath: string): Promise<void> {
    const validated = await validateFilePath(filePath);
    const entry = this.files.get(validated);
    if (!entry) return;

    this.pendingUnregister.add(validated);

    try {
      // Notify clients
      this.broadcastToFile(validated, { type: 'file-closed', filePath: validated });

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

      this.files.delete(validated);
    } finally {
      this.pendingUnregister.delete(validated);
    }

    this.emit('unregistered', validated);
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tools/server/__tests__/file-registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/server/file-registry.ts tools/server/__tests__/file-registry.test.ts
git commit -m "feat(server): add FileRegistry with per-file SyncService, watcher, and WS client management"
```

---

## Task 6: WebSocket Handler — 파일별 라우팅

**Files:**
- Modify: `tools/server/ws-handler.ts` (전체 재작성)
- Test: `tools/server/__tests__/ws-handler.test.ts` (신규)

**Step 1: Write the failing test**

```typescript
// tools/server/__tests__/ws-handler.test.ts
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createWsServer } from '../ws-handler.js';
import { FileRegistry } from '../file-registry.js';
import { addAllowedDir, clearAllowedDirs } from '../security.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('WsHandler file routing', () => {
  it('rejects connection without ?file param', async () => {
    const server = http.createServer();
    const registry = new FileRegistry();
    createWsServer(server, 0, registry);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msg = await new Promise<any>((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws.on('close', () => resolve({ type: 'closed' }));
    });
    expect(msg.type).toBe('error');

    ws.close();
    await registry.shutdown();
    server.close();
  });

  it('accepts connection with valid ?file param', async () => {
    const tmpDir = path.join(os.tmpdir(), `ws-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'test.vync');
    await fs.writeFile(filePath, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));

    clearAllowedDirs();
    addAllowedDir(tmpDir);

    const server = http.createServer();
    const registry = new FileRegistry();
    await registry.register(filePath);
    createWsServer(server, 0, registry);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?file=${encodeURIComponent(filePath)}`);
    const msg = await new Promise<any>((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(msg.type).toBe('connected');
    expect(msg.filePath).toBe(filePath);

    ws.close();
    await registry.shutdown();
    server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tools/server/__tests__/ws-handler.test.ts`
Expected: FAIL — `createWsServer` signature mismatch.

**Step 3: Rewrite ws-handler.ts**

```typescript
// tools/server/ws-handler.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { WsMessage } from '@vync/shared';
import type { FileRegistry } from './file-registry.js';

export function createWsServer(server: Server, port: number, registry: FileRegistry) {
  const wss = new WebSocketServer({ noServer: true });
  const clientFiles = new Map<WebSocket, string>();

  const allowedOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    if (url.pathname !== '/ws') return;

    // Strict origin check: reject absent origin
    const origin = request.headers.origin;
    if (port > 0 && (!origin || !allowedOrigins.includes(origin))) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const filePath = url.searchParams.get('file');

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, filePath);
    });
  });

  wss.on('connection', (ws: WebSocket, _request: any, filePath: string | null) => {
    if (!filePath) {
      ws.send(JSON.stringify({ type: 'error', code: 'FILE_REQUIRED' } satisfies WsMessage));
      ws.close(4400, 'file parameter required');
      return;
    }

    // Check if file is registered
    if (!registry.getSync(filePath)) {
      ws.send(JSON.stringify({ type: 'error', code: 'FILE_NOT_FOUND' } satisfies WsMessage));
      ws.close(4404, 'File not registered');
      return;
    }

    clientFiles.set(ws, filePath);
    registry.addClient(filePath, ws);

    console.log(`[vync] WS client connected: ${filePath}`);
    ws.send(JSON.stringify({ type: 'connected', filePath } satisfies WsMessage));

    ws.on('close', () => {
      const fp = clientFiles.get(ws);
      if (fp) {
        registry.removeClient(fp, ws);
        clientFiles.delete(ws);
      }
      console.log('[vync] WS client disconnected');
    });
  });

  return {
    close() {
      wss.clients.forEach((client) => client.terminate());
      wss.close();
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tools/server/__tests__/ws-handler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/server/ws-handler.ts tools/server/__tests__/ws-handler.test.ts
git commit -m "feat(ws): file-scoped WebSocket routing with strict origin check"
```

---

## Task 7: Server — Hub 모드 리팩토링

**Files:**
- Modify: `tools/server/server.ts` (대규모 수정)
- Test: `tools/server/__tests__/server-hub.test.ts` (신규)

**Step 1: Write the failing test**

```typescript
// tools/server/__tests__/server-hub.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { addAllowedDir, clearAllowedDirs } from '../security.js';

describe('Hub Server', () => {
  const tmpDir = path.join(os.tmpdir(), `vync-hub-test-${Date.now()}`);
  let shutdownFn: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (shutdownFn) { await shutdownFn(); shutdownFn = null; }
    clearAllowedDirs();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('starts without initial file and responds to /api/health', async () => {
    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production', staticDir: undefined });
    shutdownFn = result.shutdown;

    const res = await fetch(`http://localhost:${port}/api/health`);
    const body = await res.json();
    expect(body.version).toBe(2);
    expect(body.mode).toBe('hub');
    expect(body.fileCount).toBe(0);
  });

  it('registers a file via POST /api/files', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'a.vync');
    await fs.writeFile(filePath, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    addAllowedDir(tmpDir);

    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production', staticDir: undefined });
    shutdownFn = result.shutdown;

    const res = await fetch(`http://localhost:${port}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    expect(res.status).toBe(201);

    // Verify file is accessible
    const syncRes = await fetch(`http://localhost:${port}/api/sync?file=${encodeURIComponent(filePath)}`);
    expect(syncRes.ok).toBe(true);
    const data = await syncRes.json();
    expect(data.version).toBe(1);
  });

  it('returns 400 when ?file= missing on /api/sync', async () => {
    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production', staticDir: undefined });
    shutdownFn = result.shutdown;

    const res = await fetch(`http://localhost:${port}/api/sync`);
    expect(res.status).toBe(400);
  });

  it('returns 403 for path outside allowed dirs', async () => {
    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production', staticDir: undefined });
    shutdownFn = result.shutdown;

    const res = await fetch(`http://localhost:${port}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/etc/passwd' }),
    });
    expect(res.status).toBe(403);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tools/server/__tests__/server-hub.test.ts`
Expected: FAIL — `startServer` signature mismatch.

**Step 3: Rewrite server.ts**

```typescript
// tools/server/server.ts
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createWsServer } from './ws-handler.js';
import { FileRegistry } from './file-registry.js';
import { addAllowedDir, createHostGuard, validateFilePath } from './security.js';
import type { VyncFile } from '@vync/shared';

const DEFAULT_PORT = 3100;

export async function startServer(
  options: {
    initialFile?: string;
    port?: number;
    mode?: 'development' | 'production';
    staticDir?: string;
    openBrowser?: boolean;
  } = {}
) {
  const port = options.port ?? DEFAULT_PORT;
  const mode = options.mode ?? 'development';
  const registry = new FileRegistry();

  // Register initial file's directory as allowed
  if (options.initialFile) {
    const dir = path.dirname(options.initialFile);
    addAllowedDir(dir);
    await registry.register(options.initialFile);
  }

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // --- Host guard (DNS rebinding prevention) ---
  app.use(createHostGuard(port));

  // --- CORS (localhost only) ---
  const allowedOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];

  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // --- Health endpoint ---
  app.get('/api/health', (_req, res) => {
    res.json({ version: 2, mode: 'hub', fileCount: registry.listFiles().length });
  });

  // --- File registration API ---
  app.get('/api/files', (_req, res) => {
    res.json({ files: registry.listFiles() });
  });

  app.post('/api/files', async (req, res) => {
    const { filePath } = req.body;
    if (!filePath || typeof filePath !== 'string') {
      res.status(400).json({ error: 'filePath required' });
      return;
    }
    try {
      const validated = await validateFilePath(filePath);
      addAllowedDir(path.dirname(validated));
      const alreadyRegistered = registry.getSync(validated) !== undefined;
      await registry.register(validated);
      res.status(alreadyRegistered ? 200 : 201).json({
        filePath: validated,
        status: alreadyRegistered ? 'already_registered' : 'registered',
      });
    } catch (err: any) {
      if (err.message.includes('outside allowed') || err.message.includes('Only .vync')) {
        res.status(403).json({ error: err.message });
      } else if (err.message.includes('Maximum')) {
        res.status(429).json({ error: err.message });
      } else {
        console.error('[vync] Registration error:', err);
        res.status(500).json({ error: err.message });
      }
    }
  });

  app.delete('/api/files', async (req, res) => {
    const filePath = req.query.file as string;
    const all = req.query.all === 'true';

    if (all) {
      await registry.shutdown();
      res.json({ status: 'all_unregistered' });
      return;
    }

    if (!filePath) {
      res.status(400).json({ error: 'file query param required' });
      return;
    }
    try {
      await registry.unregister(filePath);
      res.json({ status: 'unregistered', filePath });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Sync API (file-scoped) ---
  app.get('/api/sync', async (req, res) => {
    const filePath = req.query.file as string;
    if (!filePath) {
      res.status(400).json({ error: 'file_required', files: registry.listFiles() });
      return;
    }
    const sync = registry.getSync(filePath);
    if (!sync) {
      res.status(404).json({ error: 'File not registered', filePath });
      return;
    }
    try {
      const data = await sync.readFile();
      res.json(data);
    } catch (err) {
      console.error('[vync] Error reading file:', err);
      res.status(500).json({ error: 'Failed to read file' });
    }
  });

  app.put('/api/sync', async (req, res) => {
    const filePath = req.query.file as string;
    if (!filePath) {
      res.status(400).json({ error: 'file_required' });
      return;
    }
    const sync = registry.getSync(filePath);
    if (!sync) {
      res.status(404).json({ error: 'File not registered', filePath });
      return;
    }
    try {
      const data = req.body as VyncFile;
      if (!data || !Array.isArray(data.elements)) {
        res.status(400).json({ error: 'Invalid VyncFile format' });
        return;
      }
      await sync.writeFile(data);
      res.json({ ok: true });
    } catch (err) {
      console.error('[vync] Error writing file:', err);
      res.status(500).json({ error: 'Failed to write file' });
    }
  });

  // --- HTTP Server ---
  const server = http.createServer(app);

  // --- Frontend serving ---
  let vite: { close: () => Promise<void> } | null = null;

  if (mode === 'production' && options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(options.staticDir!, 'index.html'));
    });
  } else if (mode === 'development') {
    const { createServer: createViteServer } = await import('vite');
    const projectRoot = process.env.VYNC_HOME || process.cwd();
    const webAppRoot = path.resolve(projectRoot, 'apps/web');

    vite = await createViteServer({
      configFile: path.resolve(webAppRoot, 'vite.config.ts'),
      root: webAppRoot,
      server: { middlewareMode: true, hmr: { server } },
    });

    app.use(vite.middlewares);
  }

  // --- WebSocket server ---
  const ws = createWsServer(server, port, registry);

  // --- Shutdown ---
  const shutdown = async () => {
    console.log('\n[vync] Shutting down...');
    await registry.shutdown();
    ws.close();
    if (vite) await vite.close();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      server.close(() => { clearTimeout(timer); resolve(); });
    });
  };

  const url = `http://localhost:${port}`;

  await new Promise<void>((resolve, reject) => {
    const onStartupError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`[vync] Port ${port} is already in use`));
      } else {
        reject(err);
      }
    };
    server.once('error', onStartupError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onStartupError);
      console.log(`[vync] Hub server running at ${url}`);
      if (options.initialFile) {
        console.log(`[vync] Initial file: ${options.initialFile}`);
      }
      resolve();
    });
  });

  if (options.openBrowser && options.initialFile) {
    const openModule = await import('open');
    await openModule.default(`${url}/?file=${encodeURIComponent(options.initialFile)}`);
  }

  return { shutdown, server, url, registry };
}

// Direct execution
const isDirectRun =
  process.argv[1]?.endsWith('server.ts') ||
  process.argv[1]?.endsWith('server.js');

if (isDirectRun) {
  const filePath = process.argv[2];
  const resolvedFile = filePath ? path.resolve(filePath) : undefined;
  if (resolvedFile) addAllowedDir(path.dirname(resolvedFile));

  startServer({ initialFile: resolvedFile })
    .then(({ shutdown }) => {
      process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
      process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
    })
    .catch((err) => {
      console.error('[vync] Fatal error:', err.message);
      process.exit(1);
    });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tools/server/__tests__/server-hub.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/server/server.ts tools/server/__tests__/server-hub.test.ts
git commit -m "feat(server): rewrite as hub server with FileRegistry, file-scoped API, and security"
```

---

## Task 8: CLI — PID JSON + 2-state open + close 커맨드

**Files:**
- Modify: `tools/cli/open.ts` (대규모 수정)
- Modify: `tools/cli/main.ts:4-15,25-54`
- Test: `tools/cli/__tests__/open-hub.test.ts` (신규)

**Step 1: Write the failing test**

```typescript
// tools/cli/__tests__/open-hub.test.ts
import { describe, it, expect } from 'vitest';
import { readServerInfo, writeServerInfo, type ServerInfo } from '../open.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const VYNC_DIR = path.join(os.homedir(), '.vync');
const PID_FILE = path.join(VYNC_DIR, 'server.pid');

describe('PID file JSON format', () => {
  it('writes and reads JSON format', async () => {
    const info: ServerInfo = { version: 2, pid: 99999, mode: 'daemon', port: 3100 };
    await writeServerInfo(info);
    const read = await readServerInfo();
    expect(read).toEqual(info);
    await fs.unlink(PID_FILE).catch(() => {});
  });

  it('reads legacy 3-line format', async () => {
    await fs.mkdir(VYNC_DIR, { recursive: true });
    await fs.writeFile(PID_FILE, '12345\ndaemon\n/path/to/file.vync');
    const read = await readServerInfo();
    expect(read).toEqual({ version: 1, pid: 12345, mode: 'daemon', port: 3100 });
    await fs.unlink(PID_FILE).catch(() => {});
  });

  it('returns null for corrupt file', async () => {
    await fs.mkdir(VYNC_DIR, { recursive: true });
    await fs.writeFile(PID_FILE, 'garbage');
    const read = await readServerInfo();
    expect(read).toBeNull();
    // Should have cleaned up
    await expect(fs.access(PID_FILE)).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tools/cli/__tests__/open-hub.test.ts`
Expected: FAIL — ServerInfo type doesn't have `version`/`port`.

**Step 3: Rewrite open.ts**

This is a large file. Key changes:
- `ServerInfo` → JSON with version + port
- `readServerInfo` → JSON parse with legacy fallback
- `writeServerInfo` → JSON.stringify
- `handleExistingServer` → 2-state (server-up / server-down)
- `vyncOpen` → register via POST, not restart
- Health check → `/api/health`
- Browser URL → `?file=` param
- Add `vyncClose` export
- Polling → `/api/health` instead of `/api/sync`

The full implementation code for open.ts should replace the existing file. Due to the size, here are the key structural changes:

**ServerInfo:**
```typescript
export interface ServerInfo {
  version: number;
  pid: number;
  mode: 'daemon' | 'electron' | 'foreground';
  port: number;
}
```

**readServerInfo (JSON + legacy):**
```typescript
export async function readServerInfo(): Promise<ServerInfo | null> {
  try {
    const content = (await fs.readFile(PID_FILE, 'utf-8')).trim();
    try {
      const parsed = JSON.parse(content);
      if (parsed.version && parsed.pid) return parsed;
    } catch {}
    // Legacy 3-line format
    const lines = content.split('\n');
    if (lines.length >= 2 && !isNaN(Number(lines[0]))) {
      return { version: 1, pid: Number(lines[0]), mode: lines[1] as any, port: PORT };
    }
    await fs.unlink(PID_FILE).catch(() => {});
    return null;
  } catch { return null; }
}
```

**handleExistingServer (2-state):**
```typescript
async function isServerRunning(): Promise<{ running: boolean; info: ServerInfo | null }> {
  const info = await readServerInfo();
  if (!info) return { running: false, info: null };
  try { process.kill(info.pid, 0); } catch {
    await fs.unlink(PID_FILE).catch(() => {});
    return { running: false, info: null };
  }
  try {
    const res = await fetch(`http://localhost:${info.port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      const body = await res.json();
      if (body.version === 2) return { running: true, info };
      // Old server → stop it
      await vyncStop();
      return { running: false, info: null };
    }
  } catch {}
  await fs.unlink(PID_FILE).catch(() => {});
  return { running: false, info: null };
}
```

**vyncOpen (register mode):**
```typescript
export async function vyncOpen(filePath: string, opts = {}): Promise<void> {
  const resolved = await validateAndResolve(filePath);
  const { running, info } = await isServerRunning();
  const port = info?.port ?? PORT;

  if (running) {
    // Register file with running server
    await registerFile(port, resolved);
    await openBrowserWithFile(port, resolved);
    return;
  }

  // Start new server
  if (opts.foreground) return runForeground(resolved);
  const electronBinary = await findElectronBinary();
  if (electronBinary) return runElectron(resolved);
  return runDaemon(resolved);
}
```

**registerFile helper:**
```typescript
async function registerFile(port: number, filePath: string): Promise<void> {
  const res = await fetch(`http://localhost:${port}/api/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`[vync] Registration failed: ${body.error || res.statusText}`);
  }
}
```

**openBrowserWithFile helper:**
```typescript
async function openBrowserWithFile(port: number, filePath: string): Promise<void> {
  const openModule = await import('open');
  await openModule.default(`http://localhost:${port}/?file=${encodeURIComponent(filePath)}`);
}
```

**vyncClose (신규):**
```typescript
export async function vyncClose(filePath?: string, opts?: { keepServer?: boolean }): Promise<void> {
  const info = await readServerInfo();
  if (!info) { console.error('[vync] No running server.'); return; }

  if (filePath) {
    const resolved = resolveVyncPath(filePath);
    const res = await fetch(
      `http://localhost:${info.port}/api/files?file=${encodeURIComponent(resolved)}`,
      { method: 'DELETE' }
    );
    if (res.ok) console.log(`[vync] Closed: ${resolved}`);
  } else {
    // Close all
    await fetch(`http://localhost:${info.port}/api/files?all=true`, { method: 'DELETE' });
    console.log('[vync] All files closed.');
  }

  // Check if server should stop
  if (!opts?.keepServer) {
    const filesRes = await fetch(`http://localhost:${info.port}/api/files`).catch(() => null);
    const body = filesRes ? await filesRes.json() : { files: [] };
    if (body.files.length === 0) {
      await vyncStop();
    }
  }
}
```

**main.ts** — add close command:
```typescript
case 'close': {
  const keepServer = args.includes('--keep-server');
  const filePath = args.find((a) => !a.startsWith('--'));
  await vyncClose(filePath, { keepServer });
  break;
}
```

**Polling in runDaemon/runElectron** — change from `/api/sync` to `/api/health`:
```typescript
const res = await fetch(`${url}/api/health`);
if (res.ok) { /* ready */ }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tools/cli/__tests__/open-hub.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tools/cli/open.ts tools/cli/main.ts tools/cli/__tests__/open-hub.test.ts
git commit -m "feat(cli): hub-mode PID (JSON), 2-state open, close command, register-based workflow"
```

---

## Task 9: Frontend — FileBoard 컴포넌트 + ?file= 파라미터

**Files:**
- Create: `apps/web/src/app/file-board.tsx`
- Modify: `apps/web/src/app/app.tsx` (슬림화)

**Step 1: Extract FileBoard from App**

Create `apps/web/src/app/file-board.tsx` with the existing board logic, parameterized by `filePath`:
- Props: `{ filePath: string }`
- All existing state (value, syncMode, wsRef, etc.) moves here
- API calls use `?file=` param
- WebSocket uses `?file=` param
- localStorage key: `vync_board_${filePath}`
- **Viewport 변경**: WebSocket `file-changed` 메시지에서 viewport 무시 (elements만 업데이트)
- Legacy localStorage migration (한 번만 실행)

**Step 2: Rewrite App as thin wrapper**

```typescript
// apps/web/src/app/app.tsx
import { FileBoard } from './file-board';

export function App() {
  const filePath = new URLSearchParams(window.location.search).get('file');

  if (!filePath) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui' }}>
        <div style={{ textAlign: 'center', color: '#666' }}>
          <h2>No file specified</h2>
          <p>Use <code>vync open &lt;file&gt;</code> to start.</p>
        </div>
      </div>
    );
  }

  return <FileBoard filePath={filePath} />;
}

export default App;
```

**Step 3: Implement FileBoard**

Key changes from the original App:
```typescript
// API calls
fetch(`/api/sync?file=${encodeURIComponent(filePath)}`)
fetch(`/api/sync?file=${encodeURIComponent(filePath)}`, { method: 'PUT', ... })

// WebSocket
const wsUrl = `${protocol}//${window.location.host}/ws?file=${encodeURIComponent(filePath)}`;

// LocalStorage
const storageKey = `vync_board_${filePath}`;

// Viewport: on WS file-changed, only update elements, not viewport
if (msg.type === 'file-changed' && msg.data) {
  remoteUpdateUntilRef.current = Date.now() + 500;
  setValue((prev) => ({
    ...prev,
    children: msg.data!.elements || [],
    // viewport NOT updated — keep current tab's viewport
  }));
}

// Reconnect recovery: POST /api/files to re-register if GET returns 404
if (res.status === 404) {
  await fetch('/api/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  // Retry
}

// Legacy migration (once)
const legacyData = await localforage.getItem('main_board_content');
if (legacyData && !await localforage.getItem(storageKey)) {
  await localforage.setItem(storageKey, legacyData);
}
```

**Step 4: Verify dev server works**

Run: `npm run dev:server` (with a test .vync file)
Open: `http://localhost:3100/?file=<path>` in browser
Expected: Board loads correctly.

**Step 5: Commit**

```bash
git add apps/web/src/app/file-board.tsx apps/web/src/app/app.tsx
git commit -m "feat(web): extract FileBoard component with file-scoped sync, viewport isolation"
```

---

## Task 10: Electron — 파일 등록 모드

**Files:**
- Modify: `tools/electron/main.ts:66-98`

**Step 1: Update openFile() to register instead of restart**

```typescript
async function openFile(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);

  if (serverHandle) {
    // Hub mode: register new file, don't restart
    try {
      await fetch(`${serverHandle.url}/api/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: resolved }),
      });
    } catch (err: any) {
      dialog.showErrorBox('Vync Error', `Failed to register file: ${err.message}`);
      return;
    }
  } else {
    // Start server
    try {
      const { startServer } = await import('../server/server.js');
      const isDev = !app.isPackaged;
      const staticDir = isDev
        ? undefined
        : path.join(process.resourcesPath, 'dist', 'apps', 'web');
      serverHandle = await startServer({
        initialFile: resolved,
        port: 3100,
        mode: isDev ? 'development' : 'production',
        staticDir,
      });
    } catch (err: any) {
      dialog.showErrorBox('Vync Error', err.message);
      app.quit();
      return;
    }
  }

  const fileUrl = `${serverHandle!.url}/?file=${encodeURIComponent(resolved)}`;
  if (!mainWindow) {
    createWindow(fileUrl);
  } else {
    mainWindow.loadURL(fileUrl);
  }
}
```

**Step 2: Update second-instance handler**

```typescript
app.on('second-instance', (_event, argv) => {
  const file = argv.find((a) => a.endsWith('.vync'));
  if (file) openFile(file);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
```

(This already calls `openFile` which now registers instead of restarts.)

**Step 3: Verify Electron compiles**

Run: `npx esbuild tools/electron/main.ts --bundle --platform=node --outfile=dist/electron/main.js --packages=external`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add tools/electron/main.ts
git commit -m "feat(electron): register files with hub server instead of restarting"
```

---

## Task 11: Hooks — SessionEnd 업데이트

**Files:**
- Modify: `.claude-plugin/hooks.json:14-24`

**Step 1: Update SessionEnd hook**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path // \"\"' | { read f; [[ \"$f\" == *.vync ]] && node \"$HOME/.claude/skills/vync-editing/scripts/validate.js\" \"$f\" 2>&1 || true; }"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X DELETE 'http://localhost:3100/api/files?all=true' 2>/dev/null; [ -f \"$HOME/.vync/server.pid\" ] && { pid=$(node -e \"try{console.log(JSON.parse(require('fs').readFileSync('$HOME/.vync/server.pid','utf8')).pid)}catch{const l=require('fs').readFileSync('$HOME/.vync/server.pid','utf8').split('\\n');console.log(l[0])}\" 2>/dev/null || head -1 \"$HOME/.vync/server.pid\"); kill \"$pid\" 2>/dev/null; rm -f \"$HOME/.vync/server.pid\"; }; exit 0"
          }
        ]
      }
    ]
  }
}
```

**Step 2: Re-run install.sh**

Run: `bash .claude-plugin/install.sh`
Expected: Hooks merged into `~/.claude/settings.json`.

**Step 3: Commit**

```bash
git add .claude-plugin/hooks.json
git commit -m "fix(hooks): update SessionEnd to unregister files before killing hub server"
```

---

## Task 12: /vync 커맨드 — close 서브커맨드 문서화

**Files:**
- Modify: `.claude-plugin/commands/vync.md`

**Step 1: Add close subcommand**

Add to the CLI subcommands section:
```markdown
- `close [file]` — Unregister file from server. If no files remain, server stops.
  - `--keep-server` — Unregister but keep server running.
```

**Step 2: Update open description**

```markdown
- `open <file>` — Register file with hub server and open browser. Starts server if not running.
```

**Step 3: Commit**

```bash
git add .claude-plugin/commands/vync.md
git commit -m "docs(plugin): add close subcommand, update open description for hub mode"
```

---

## Task 13: Integration Test — 멀티 파일 E2E

**Files:**
- Create: `tools/server/__tests__/multi-file-e2e.test.ts`

**Step 1: Write integration test**

```typescript
// tools/server/__tests__/multi-file-e2e.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WebSocket } from 'ws';
import { addAllowedDir, clearAllowedDirs } from '../security.js';

describe('Multi-file E2E', () => {
  const tmpDir = path.join(os.tmpdir(), `vync-e2e-${Date.now()}`);
  let shutdownFn: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (shutdownFn) { await shutdownFn(); shutdownFn = null; }
    clearAllowedDirs();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('two files: independent editing + WS isolation', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const fileA = path.join(tmpDir, 'a.vync');
    const fileB = path.join(tmpDir, 'b.vync');
    const baseData = { version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] };
    await fs.writeFile(fileA, JSON.stringify(baseData));
    await fs.writeFile(fileB, JSON.stringify(baseData));
    addAllowedDir(tmpDir);

    const { startServer } = await import('../server.js');
    const port = 3300 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production' });
    shutdownFn = result.shutdown;

    const base = `http://localhost:${port}`;

    // Register both files
    await fetch(`${base}/api/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: fileA }) });
    await fetch(`${base}/api/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: fileB }) });

    // Verify both accessible
    const resA = await fetch(`${base}/api/sync?file=${encodeURIComponent(fileA)}`);
    const resB = await fetch(`${base}/api/sync?file=${encodeURIComponent(fileB)}`);
    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);

    // Write to file A
    await fetch(`${base}/api/sync?file=${encodeURIComponent(fileA)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseData, elements: [{ id: 'aaaaa' }] }),
    });

    // File B should be unchanged
    const bData = await (await fetch(`${base}/api/sync?file=${encodeURIComponent(fileB)}`)).json();
    expect(bData.elements).toHaveLength(0);

    // File A should have the element
    const aData = await (await fetch(`${base}/api/sync?file=${encodeURIComponent(fileA)}`)).json();
    expect(aData.elements).toHaveLength(1);

    // Unregister file A
    await fetch(`${base}/api/files?file=${encodeURIComponent(fileA)}`, { method: 'DELETE' });

    // File A should be 404 now
    const resA2 = await fetch(`${base}/api/sync?file=${encodeURIComponent(fileA)}`);
    expect(resA2.status).toBe(404);

    // File B still works
    const resB2 = await fetch(`${base}/api/sync?file=${encodeURIComponent(fileB)}`);
    expect(resB2.ok).toBe(true);
  });

  it('security: rejects non-.vync files', async () => {
    const { startServer } = await import('../server.js');
    const port = 3300 + Math.floor(Math.random() * 100);
    const result = await startServer({ port, mode: 'production' });
    shutdownFn = result.shutdown;

    const res = await fetch(`http://localhost:${port}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/etc/passwd' }),
    });
    expect(res.status).toBe(403);
  });
});
```

**Step 2: Run test**

Run: `npx vitest run tools/server/__tests__/multi-file-e2e.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tools/server/__tests__/multi-file-e2e.test.ts
git commit -m "test: add multi-file E2E integration tests with security validation"
```

---

## Task 14: Docs — DECISIONS.md + ARCHITECTURE.md 업데이트

**Files:**
- Modify: `docs/DECISIONS.md` — D-014 추가
- Modify: `docs/ARCHITECTURE.md` — 멀티 파일 반영
- Modify: `docs/PLAN.md` — Phase 8 추가

**Step 1: Add D-014**

```markdown
| D-014 | Multi-file hub server | 단일 서버(:3100), 다중 파일. FileRegistry가 파일별 SyncService/Watcher/WS 관리. | 멀티 인스턴스 대비 리소스 효율. 탭+윈도우 모두 가능한 유일한 선택. | 2026-03-09 |
```

**Step 2: Update ARCHITECTURE.md sync mechanism**

Update the sync flow diagram to show file-scoped routing.

**Step 3: Update PLAN.md**

Add Phase 8 (Multi-file hub) with completion criteria.

**Step 4: Commit**

```bash
git add docs/DECISIONS.md docs/ARCHITECTURE.md docs/PLAN.md
git commit -m "docs: add D-014 multi-file hub, update architecture and plan for Phase 8"
```

---

## Task 15: 전체 테스트 실행 + 최종 검증

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 2: Dev server manual test**

```bash
# Terminal 1: Start server
npx tsx tools/server/server.ts

# Terminal 2: Register two files
curl -X POST http://localhost:3100/api/files -H 'Content-Type: application/json' -d '{"filePath":"/path/to/a.vync"}'
curl -X POST http://localhost:3100/api/files -H 'Content-Type: application/json' -d '{"filePath":"/path/to/b.vync"}'

# Browser: Open two tabs
open "http://localhost:3100/?file=/path/to/a.vync"
open "http://localhost:3100/?file=/path/to/b.vync"

# Verify: Both tabs show different content, edits are independent
```

**Step 3: CLI manual test**

```bash
vync open plan      # Starts server, opens browser
vync open design    # Registers second file, opens new tab
vync close plan     # Unregisters plan, design still works
vync stop           # Stops server
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: multi-file hub server (Stage 1 complete)"
```

---

## Dependency Graph

```
Task 1 (types)
  ↓
Task 2 (security)
  ↓
Task 3 (drain) ─────────→ Task 5 (FileRegistry)
  ↓                              ↓
Task 4 (watcher unlink) ────→ Task 6 (WS handler)
                                     ↓
                               Task 7 (server hub)
                                     ↓
                         ┌───────────┼───────────┐
                         ↓           ↓           ↓
                   Task 8 (CLI) Task 9 (FE) Task 10 (Electron)
                         ↓           ↓           ↓
                   Task 11 (hooks) Task 12 (docs)
                         ↓
                   Task 13 (E2E)
                         ↓
                   Task 14 (docs)
                         ↓
                   Task 15 (verify)
```

Tasks 1-4는 독립적으로 병렬 실행 가능. Tasks 8-10도 Task 7 완료 후 병렬 가능.

---

## Stage 2 동기화 체크포인트

> **1단계 완료 후 반드시 수행:**
> 1. `docs/plans/2026-03-09-multi-file-hub-design.md`의 Stage 2 Preview 섹션 재검토
> 2. 1단계에서 확정된 API 계약, WsMessage 프로토콜, FileBoard 구조 기반으로 2단계 세부 계획 작성
> 3. `docs/plans/YYYY-MM-DD-multi-file-tab-ui-design.md`로 저장
> 4. 특히 확인: `remoteUpdateUntilRef` → `Map<string, number>` 전환 필요 여부, Electron 멀티 윈도우 vs 탭 결정
