import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createFileWatcher } from './file-watcher.js';
import { createWsServer } from './ws-handler.js';
import type { VyncFile } from '../shared/types.js';

const PORT = 3100;

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx src/server/server.ts <file.vync>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);

  // Verify file exists and is valid JSON
  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');
    JSON.parse(content);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.error(`[vync] File not found: ${resolvedPath}`);
    } else {
      console.error(`[vync] Invalid JSON in file: ${resolvedPath}`);
    }
    process.exit(1);
  }

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // --- CORS (localhost only) ---

  const allowedOrigins = [
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
  ];

  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // --- API Routes (before Vite middleware) ---

  app.get('/api/sync', async (_req, res) => {
    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const data = JSON.parse(content);
      res.json(data);
    } catch (err) {
      console.error('[vync] Error reading file:', err);
      res.status(500).json({ error: 'Failed to read file' });
    }
  });

  app.put('/api/sync', async (req, res) => {
    try {
      const data = req.body as VyncFile;
      const content = JSON.stringify(data, null, 2);
      await fs.writeFile(resolvedPath, content, 'utf-8');
      res.json({ ok: true });
    } catch (err) {
      console.error('[vync] Error writing file:', err);
      res.status(500).json({ error: 'Failed to write file' });
    }
  });

  // --- HTTP Server ---

  const server = http.createServer(app);

  // --- Vite dev server (middleware mode) ---

  const projectRoot = process.cwd();
  const webAppRoot = path.resolve(projectRoot, 'apps/web');

  const vite = await createViteServer({
    configFile: path.resolve(webAppRoot, 'vite.config.ts'),
    root: webAppRoot,
    server: {
      middlewareMode: true,
      hmr: { server },
    },
  });

  app.use(vite.middlewares);

  // --- WebSocket server (sync channel on /ws) ---

  const ws = createWsServer(server, PORT);

  // --- File watcher ---

  const watcher = createFileWatcher(resolvedPath, (content) => {
    try {
      const data = JSON.parse(content) as VyncFile;
      ws.broadcast({ type: 'file-changed', data });
      console.log('[vync] File changed externally, notified clients');
    } catch {
      console.error('[vync] Invalid JSON in changed file, ignoring');
    }
  });

  // --- Graceful shutdown ---

  const shutdown = async () => {
    console.log('\n[vync] Shutting down...');
    await watcher.close();
    ws.close();
    await vite.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[vync] Server running at http://localhost:${PORT}`);
    console.log(`[vync] Watching: ${resolvedPath}`);
    console.log(`[vync] WebSocket: ws://localhost:${PORT}/ws`);
  });
}

main().catch((err) => {
  console.error('[vync] Fatal error:', err);
  process.exit(1);
});
