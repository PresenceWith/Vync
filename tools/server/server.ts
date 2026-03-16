import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { createWsServer } from './ws-handler.js';
import { FileRegistry } from './file-registry.js';
import {
  addAllowedDir,
  createHostGuard,
  getAllowedDirs,
  validateFilePath,
} from './security.js';
import type { VyncFile } from '@vync/shared';

const DEFAULT_PORT = 3100;

export async function startServer(
  options: {
    initialFile?: string;
    port?: number;
    mode?: 'development' | 'production';
    processMode?: 'daemon' | 'electron' | 'foreground';
    staticDir?: string;
    openBrowser?: boolean;
  } = {}
) {
  const port = options.port ?? DEFAULT_PORT;
  const mode = options.mode ?? 'development';
  const processMode = options.processMode ?? 'daemon';
  const registry = new FileRegistry();

  // Register initial file's directory as allowed
  if (options.initialFile) {
    addAllowedDir(path.dirname(options.initialFile));
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
    res.json({
      version: 2,
      mode: 'hub',
      processMode,
      pid: process.pid,
      fileCount: registry.listFiles().length,
    });
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
      if (
        err.message.includes('outside allowed') ||
        err.message.includes('Only .vync')
      ) {
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

  // --- File discovery API ---
  app.get('/api/files/discover', async (_req, res) => {
    try {
      const registered = new Set(registry.listFiles());
      const scanDirs = new Set<string>();
      for (const dir of getAllowedDirs()) {
        scanDirs.add(dir);
        scanDirs.add(path.join(dir, '.vync'));
      }
      const discovered: string[] = [];
      const MAX_RESULTS = 100;
      for (const dir of scanDirs) {
        if (discovered.length >= MAX_RESULTS) break;
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (discovered.length >= MAX_RESULTS) break;
            if (!entry.isFile() || !entry.name.endsWith('.vync')) continue;
            const real = await fs
              .realpath(path.join(dir, entry.name))
              .catch(() => null);
            if (real && !registered.has(real)) {
              discovered.push(real);
            }
          }
        } catch {
          /* directory doesn't exist or not readable */
        }
      }
      res.json({ files: [...new Set(discovered)] });
    } catch (err: any) {
      console.error('[vync] Discovery error:', err);
      res.status(500).json({ error: 'Discovery failed' });
    }
  });

  // --- Sync API (file-scoped) ---
  app.get('/api/sync', async (req, res) => {
    const filePath = req.query.file as string;
    if (!filePath) {
      res
        .status(400)
        .json({ error: 'file_required', files: registry.listFiles() });
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
      if (!data) {
        res.status(400).json({ error: 'Invalid VyncFile format' });
        return;
      }
      if (data.type === 'graph') {
        // Graph files: validate nodes and edges arrays
        const gd = data as Record<string, unknown>;
        if (!Array.isArray(gd.nodes) || !Array.isArray(gd.edges)) {
          res
            .status(400)
            .json({ error: 'Graph file requires nodes and edges arrays' });
          return;
        }
      } else {
        // Canvas files (default): validate elements array
        if (!Array.isArray(data.elements)) {
          res.status(400).json({ error: 'Invalid VyncFile format' });
          return;
        }
      }
      await sync.writeFile(data);
      registry.broadcastToFile(filePath, {
        type: 'file-changed',
        filePath,
        data,
      });
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
    app.get('*path', (_req, res) => {
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
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
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
    await openModule.default(
      `${url}/?file=${encodeURIComponent(options.initialFile)}`
    );
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
