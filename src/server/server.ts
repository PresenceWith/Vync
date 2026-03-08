import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createFileWatcher } from './file-watcher.js';
import { createWsServer } from './ws-handler.js';
import { createSyncService } from './sync-service.js';
import type { VyncFile } from '../shared/types.js';

const DEFAULT_PORT = 3100;

export async function startServer(
  resolvedPath: string,
  options: {
    openBrowser?: boolean;
    port?: number;
    mode?: 'development' | 'production';
    staticDir?: string;
  } = {}
) {
  const port = options.port ?? DEFAULT_PORT;
  const mode = options.mode ?? 'development';
  const sync = createSyncService(resolvedPath);
  try {
    await sync.init();
  } catch (err: any) {
    const msg =
      err.code === 'ENOENT'
        ? `File not found: ${resolvedPath}`
        : `Invalid JSON in file: ${resolvedPath}`;
    throw new Error(`[vync] ${msg}`);
  }

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // --- CORS (localhost only) ---

  const allowedOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
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

  // --- Frontend serving (dev: Vite middleware, prod: static files) ---

  let vite: { close: () => Promise<void> } | null = null;

  if (mode === 'production' && options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(options.staticDir!, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const projectRoot = process.env.VYNC_HOME || process.cwd();
    const webAppRoot = path.resolve(projectRoot, 'apps/web');

    vite = await createViteServer({
      configFile: path.resolve(webAppRoot, 'vite.config.ts'),
      root: webAppRoot,
      server: {
        middlewareMode: true,
        hmr: { server },
      },
    });

    app.use(vite.middlewares);
  }

  // --- WebSocket server (sync channel on /ws) ---

  const ws = createWsServer(server, port);

  // --- File watcher ---

  const watcher = createFileWatcher(resolvedPath, (content) => {
    const data = sync.handleFileChange(content);
    if (data) {
      ws.broadcast({ type: 'file-changed', data });
      console.log('[vync] File changed externally, notified clients');
    }
  });

  // --- Shutdown function ---

  const shutdown = async () => {
    console.log('\n[vync] Shutting down...');
    await watcher.close();
    ws.close();
    if (vite) {
      await vite.close();
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  const url = `http://localhost:${port}`;

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`[vync] Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      server.removeAllListeners('error');
      console.log(`[vync] Server running at ${url}`);
      console.log(`[vync] Watching: ${resolvedPath}`);
      console.log(`[vync] WebSocket: ws://localhost:${port}/ws`);
      resolve();
    });
  });

  if (options.openBrowser) {
    const openModule = await import('open');
    await openModule.default(url);
  }

  return { shutdown, server, url };
}

// Direct execution (backward compat with `npm run dev:server -- <file>`)
const isDirectRun =
  process.argv[1]?.endsWith('server.ts') ||
  process.argv[1]?.endsWith('server.js');

if (isDirectRun) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx src/server/server.ts <file.vync>');
    process.exit(1);
  }
  startServer(path.resolve(filePath))
    .then(({ shutdown }) => {
      process.on('SIGINT', async () => {
        await shutdown();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await shutdown();
        process.exit(0);
      });
    })
    .catch((err) => {
      console.error('[vync] Fatal error:', err.message);
      process.exit(1);
    });
}
