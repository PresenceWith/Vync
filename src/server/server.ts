import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createFileWatcher } from './file-watcher.js';
import { createWsServer } from './ws-handler.js';
import { createSyncService } from './sync-service.js';
import type { VyncFile } from '../shared/types.js';

const PORT = 3100;

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx src/server/server.ts <file.vync>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);

  // Initialize sync service (validates file exists and is valid JSON)
  const sync = createSyncService(resolvedPath);
  try {
    await sync.init();
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
      const data = await sync.readFile();
      res.json(data);
    } catch (err) {
      console.error('[vync] Error reading file:', err);
      res.status(500).json({ error: 'Failed to read file' });
    }
  });

  app.put('/api/sync', async (req, res) => {
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
    const data = sync.handleFileChange(content);
    if (data) {
      ws.broadcast({ type: 'file-changed', data });
      console.log('[vync] File changed externally, notified clients');
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
