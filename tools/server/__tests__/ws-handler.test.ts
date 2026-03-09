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

    // Get the realpath since FileRegistry stores realpath
    const realFilePath = await fs.realpath(filePath);

    createWsServer(server, 0, registry);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?file=${encodeURIComponent(realFilePath)}`);
    const msg = await new Promise<any>((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(msg.type).toBe('connected');
    expect(msg.filePath).toBe(realFilePath);

    ws.close();
    await registry.shutdown();
    server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
