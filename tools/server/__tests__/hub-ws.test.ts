import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createWsServer } from '../ws-handler.js';
import { FileRegistry } from '../file-registry.js';
import { addAllowedDir, clearAllowedDirs } from '../security.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.on('message', function handler(data) {
      ws.off('message', handler);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('Hub WebSocket', () => {
  let server: http.Server;
  let registry: FileRegistry;
  let port: number;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `hub-ws-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    clearAllowedDirs();
    addAllowedDir(tmpDir);

    server = http.createServer();
    registry = new FileRegistry();
    createWsServer(server, 0, registry);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await registry.shutdown();
    server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('sends connected with file list on hub connect', async () => {
    const filePath = path.join(tmpDir, 'a.vync');
    await fs.writeFile(filePath, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    await registry.register(filePath);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('connected');
    expect(msg.data.files).toHaveLength(1);
    expect(msg.data.files[0]).toContain('a.vync');

    ws.close();
  });

  it('broadcasts hub-file-registered when file registered', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const connMsg = await waitForMessage(ws);
    expect(connMsg.type).toBe('connected');
    expect(connMsg.data.files).toEqual([]);

    // Register a file — hub client should receive notification
    const filePath = path.join(tmpDir, 'b.vync');
    await fs.writeFile(filePath, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));

    const regPromise = waitForMessage(ws);
    await registry.register(filePath);
    const regMsg = await regPromise;

    expect(regMsg.type).toBe('hub-file-registered');
    expect(regMsg.filePath).toContain('b.vync');

    ws.close();
  });

  it('broadcasts hub-file-unregistered when file unregistered', async () => {
    const filePath = path.join(tmpDir, 'c.vync');
    await fs.writeFile(filePath, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    await registry.register(filePath);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const connMsg = await waitForMessage(ws);
    expect(connMsg.type).toBe('connected');
    expect(connMsg.data.files).toHaveLength(1);

    const realPath = await fs.realpath(filePath);
    const unregPromise = waitForMessage(ws);
    await registry.unregister(realPath);
    const unregMsg = await unregPromise;

    expect(unregMsg.type).toBe('hub-file-unregistered');
    expect(unregMsg.filePath).toContain('c.vync');

    ws.close();
  });

  it('hub client disconnect cleans up without error', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await waitForMessage(ws);

    // Close hub client — should not cause errors
    ws.close();
    await new Promise((r) => setTimeout(r, 100));

    // Registry should still function normally
    const filePath = path.join(tmpDir, 'd.vync');
    await fs.writeFile(filePath, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    await registry.register(filePath);
    expect(registry.listFiles()).toHaveLength(1);
  });

  it('hub WS and file-scoped WS operate independently', async () => {
    const filePath = path.join(tmpDir, 'e.vync');
    await fs.writeFile(filePath, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));
    await registry.register(filePath);

    const realPath = await fs.realpath(filePath);

    // Connect hub client
    const hubWs = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const hubMsg = await waitForMessage(hubWs);
    expect(hubMsg.type).toBe('connected');
    expect(hubMsg.data.files).toHaveLength(1);

    // Connect file-scoped client
    const fileWs = new WebSocket(`ws://127.0.0.1:${port}/ws?file=${encodeURIComponent(realPath)}`);
    const fileMsg = await waitForMessage(fileWs);
    expect(fileMsg.type).toBe('connected');
    expect(fileMsg.filePath).toBe(realPath);

    // Register another file — only hub client gets notification
    const filePath2 = path.join(tmpDir, 'f.vync');
    await fs.writeFile(filePath2, JSON.stringify({ version: 1, viewport: { zoom: 1, x: 0, y: 0 }, elements: [] }));

    const hubRegPromise = waitForMessage(hubWs);
    await registry.register(filePath2);
    const hubRegMsg = await hubRegPromise;
    expect(hubRegMsg.type).toBe('hub-file-registered');

    hubWs.close();
    fileWs.close();
  });
});
