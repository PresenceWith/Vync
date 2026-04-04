import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import express from 'express';
import { WebSocket } from 'ws';
import { createWsServer } from '../ws-handler.js';
import { FileRegistry } from '../file-registry.js';
import { addAllowedDir, clearAllowedDirs } from '../security.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { VyncCanvasFile } from '@vync/shared';

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.on('message', function handler(data) {
      ws.off('message', handler);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('PUT /api/sync broadcast', () => {
  let server: http.Server;
  let registry: FileRegistry;
  let port: number;
  let tmpDir: string;

  const vyncData: VyncCanvasFile = {
    version: 1,
    viewport: { zoom: 1, x: 0, y: 0 },
    elements: [],
  };

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `put-broadcast-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    clearAllowedDirs();
    addAllowedDir(tmpDir);

    const app = express();
    app.use(express.json({ limit: '10mb' }));

    registry = new FileRegistry();

    // Replicate the PUT /api/sync handler from server.ts
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
        const data = req.body as VyncCanvasFile;
        if (!data || !Array.isArray(data.elements)) {
          res.status(400).json({ error: 'Invalid VyncCanvasFile format' });
          return;
        }
        await sync.writeFile(data);
        registry.broadcastToFile(filePath, {
          type: 'file-changed',
          filePath,
          data,
        });
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to write file' });
      }
    });

    server = http.createServer(app);
    createWsServer(server, 0, registry);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await registry.shutdown();
    server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('broadcasts file-changed to all WS clients after PUT', async () => {
    const filePath = path.join(tmpDir, 'test.vync');
    await fs.writeFile(filePath, JSON.stringify(vyncData));
    await registry.register(filePath);

    const realPath = await fs.realpath(filePath);

    // Connect two file-scoped WS clients
    const ws1 = new WebSocket(
      `ws://127.0.0.1:${port}/ws?file=${encodeURIComponent(realPath)}`
    );
    const ws2 = new WebSocket(
      `ws://127.0.0.1:${port}/ws?file=${encodeURIComponent(realPath)}`
    );

    // Wait for connected messages
    await waitForMessage(ws1);
    await waitForMessage(ws2);

    // Set up message listeners before PUT
    const msg1Promise = waitForMessage(ws1);
    const msg2Promise = waitForMessage(ws2);

    // PUT new data
    const updatedData: VyncCanvasFile = {
      version: 1,
      viewport: { zoom: 1, x: 0, y: 0 },
      elements: [{ id: 'abc12', type: 'mindmap', data: {}, children: [] }] as any,
    };

    const res = await fetch(
      `http://127.0.0.1:${port}/api/sync?file=${encodeURIComponent(realPath)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedData),
      }
    );
    expect(res.ok).toBe(true);

    // Both clients should receive file-changed
    const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);

    expect(msg1.type).toBe('file-changed');
    expect(msg1.filePath).toBe(realPath);
    expect(msg1.data.elements).toHaveLength(1);

    expect(msg2.type).toBe('file-changed');
    expect(msg2.filePath).toBe(realPath);
    expect(msg2.data.elements).toHaveLength(1);

    ws1.close();
    ws2.close();
  });

  it('does not broadcast to clients of other files', async () => {
    const fileA = path.join(tmpDir, 'a.vync');
    const fileB = path.join(tmpDir, 'b.vync');
    await fs.writeFile(fileA, JSON.stringify(vyncData));
    await fs.writeFile(fileB, JSON.stringify(vyncData));
    await registry.register(fileA);
    await registry.register(fileB);

    const realA = await fs.realpath(fileA);
    const realB = await fs.realpath(fileB);

    // Connect client to file B
    const wsB = new WebSocket(
      `ws://127.0.0.1:${port}/ws?file=${encodeURIComponent(realB)}`
    );
    await waitForMessage(wsB);

    // PUT to file A
    const updatedData: VyncCanvasFile = {
      version: 1,
      viewport: { zoom: 1, x: 0, y: 0 },
      elements: [{ id: 'xyz99', type: 'mindmap', data: {}, children: [] }] as any,
    };

    await fetch(
      `http://127.0.0.1:${port}/api/sync?file=${encodeURIComponent(realA)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedData),
      }
    );

    // Client B should NOT receive any message — wait briefly to confirm
    const received = await Promise.race([
      waitForMessage(wsB).then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 300)),
    ]);

    expect(received).toBe(false);

    wsB.close();
  });
});
