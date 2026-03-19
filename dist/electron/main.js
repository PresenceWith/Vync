var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tools/server/ws-handler.ts
function createWsServer(server, port, registry) {
  const wss = new import_ws.WebSocketServer({ noServer: true });
  const clientFiles = /* @__PURE__ */ new Map();
  const allowedOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`
  ];
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== "/ws") return;
    const origin = request.headers.origin;
    if (port > 0 && (!origin || !allowedOrigins.includes(origin))) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const filePath = url.searchParams.get("file");
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, filePath);
    });
  });
  wss.on(
    "connection",
    (ws, _request, filePath) => {
      if (!filePath) {
        registry.addHubClient(ws);
        ws.send(
          JSON.stringify({
            type: "connected",
            data: { files: registry.listFiles() }
          })
        );
        ws.on("close", () => {
          registry.removeHubClient(ws);
        });
        return;
      }
      if (!registry.getSync(filePath)) {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "FILE_NOT_FOUND"
          })
        );
        ws.close(4404, "File not registered");
        return;
      }
      clientFiles.set(ws, filePath);
      registry.addClient(filePath, ws);
      console.log(`[vync] WS client connected: ${filePath}`);
      ws.send(
        JSON.stringify({ type: "connected", filePath })
      );
      ws.on("close", () => {
        const fp = clientFiles.get(ws);
        if (fp) {
          registry.removeClient(fp, ws);
          clientFiles.delete(ws);
        }
        console.log("[vync] WS client disconnected");
      });
    }
  );
  return {
    close() {
      wss.clients.forEach((client) => client.terminate());
      wss.close();
    }
  };
}
var import_ws;
var init_ws_handler = __esm({
  "tools/server/ws-handler.ts"() {
    import_ws = require("ws");
  }
});

// packages/shared/src/types.ts
function isGraphFile(f) {
  return f.type === "graph";
}
var init_types = __esm({
  "packages/shared/src/types.ts"() {
  }
});

// packages/shared/src/hash.ts
function sha256(content) {
  return (0, import_node_crypto.createHash)("sha256").update(content, "utf-8").digest("hex");
}
var import_node_crypto;
var init_hash = __esm({
  "packages/shared/src/hash.ts"() {
    import_node_crypto = require("node:crypto");
  }
});

// packages/shared/src/index.ts
var init_src = __esm({
  "packages/shared/src/index.ts"() {
    init_types();
    init_hash();
  }
});

// tools/server/sync-service.ts
function createSyncService(filePath) {
  let lastHash = null;
  let isWriting = false;
  let lastValidContent = null;
  let writeQueue = Promise.resolve();
  async function init() {
    const content = await import_promises.default.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    lastHash = sha256(content);
    lastValidContent = content;
    return data;
  }
  async function writeFile(data) {
    const doWrite = async () => {
      const content = JSON.stringify(data, null, 2);
      const hash = sha256(content);
      if (hash === lastHash) return;
      const dir = import_node_path.default.dirname(filePath);
      const tmpPath = import_node_path.default.join(dir, `.${import_node_path.default.basename(filePath)}.tmp`);
      isWriting = true;
      try {
        await import_promises.default.writeFile(tmpPath, content, "utf-8");
        await import_promises.default.rename(tmpPath, filePath);
        lastHash = hash;
        lastValidContent = content;
      } catch (err) {
        await import_promises.default.unlink(tmpPath).catch(() => {
        });
        throw err;
      } finally {
        setTimeout(() => {
          isWriting = false;
        }, 500);
      }
    };
    writeQueue = writeQueue.then(doWrite, doWrite);
    return writeQueue;
  }
  function handleFileChange(content) {
    if (isWriting) return null;
    let data;
    try {
      data = JSON.parse(content);
    } catch {
      console.error(
        "[vync] Invalid JSON in changed file, keeping previous state"
      );
      return null;
    }
    const hash = sha256(content);
    if (hash === lastHash) return null;
    lastHash = hash;
    lastValidContent = content;
    return data;
  }
  async function readFile() {
    try {
      const content = await import_promises.default.readFile(filePath, "utf-8");
      const data = JSON.parse(content);
      lastValidContent = content;
      return data;
    } catch {
      if (lastValidContent) {
        console.error("[vync] Error reading file, returning last valid state");
        return JSON.parse(lastValidContent);
      }
      throw new Error("No valid file content available");
    }
  }
  async function drain() {
    await writeQueue;
  }
  return { init, writeFile, handleFileChange, readFile, drain, filePath };
}
var import_promises, import_node_path;
var init_sync_service = __esm({
  "tools/server/sync-service.ts"() {
    import_promises = __toESM(require("node:fs/promises"));
    import_node_path = __toESM(require("node:path"));
    init_src();
  }
});

// tools/server/file-watcher.ts
function createFileWatcher(filePath, callbacks) {
  const { onChange, onDelete } = typeof callbacks === "function" ? { onChange: callbacks, onDelete: void 0 } : callbacks;
  const watcher = import_chokidar.default.watch(filePath, {
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  });
  watcher.on("change", async () => {
    try {
      const content = await import_promises2.default.readFile(filePath, "utf-8");
      onChange(content);
    } catch (err) {
      console.error("[vync] Error reading changed file:", err);
    }
  });
  if (onDelete) {
    watcher.on("unlink", () => {
      console.log(`[vync] File deleted: ${filePath}`);
      onDelete();
    });
  }
  return watcher;
}
var import_chokidar, import_promises2;
var init_file_watcher = __esm({
  "tools/server/file-watcher.ts"() {
    import_chokidar = __toESM(require("chokidar"));
    import_promises2 = __toESM(require("node:fs/promises"));
  }
});

// tools/server/security.ts
function addAllowedDir(dir) {
  try {
    allowedDirs.add(import_node_fs.default.realpathSync(import_node_path2.default.resolve(dir)));
  } catch {
    allowedDirs.add(import_node_path2.default.resolve(dir));
  }
}
function getAllowedDirs() {
  return allowedDirs;
}
async function validateFilePath(rawPath) {
  const resolved = import_node_path2.default.resolve(rawPath);
  if (!resolved.endsWith(".vync")) {
    throw new Error("Only .vync files permitted");
  }
  let real;
  try {
    real = await import_promises3.default.realpath(resolved);
  } catch {
    try {
      const parentReal = await import_promises3.default.realpath(import_node_path2.default.dirname(resolved));
      real = import_node_path2.default.join(parentReal, import_node_path2.default.basename(resolved));
    } catch {
      throw new Error(`Parent directory does not exist: ${import_node_path2.default.dirname(resolved)}`);
    }
  }
  const allowed = [...allowedDirs].some((dir) => {
    return real.startsWith(dir + import_node_path2.default.sep) || real === dir;
  });
  if (!allowed) {
    throw new Error(`Path outside allowed directories: ${real}`);
  }
  return real;
}
function createHostGuard(port) {
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
  return (req, res, next) => {
    const host = req.headers.host;
    if (!host || !allowed.includes(host)) {
      res.status(421).json({ error: "Invalid Host header" });
      return;
    }
    next();
  };
}
var import_node_path2, import_promises3, import_node_fs, allowedDirs;
var init_security = __esm({
  "tools/server/security.ts"() {
    import_node_path2 = __toESM(require("node:path"));
    import_promises3 = __toESM(require("node:fs/promises"));
    import_node_fs = __toESM(require("node:fs"));
    allowedDirs = /* @__PURE__ */ new Set();
  }
});

// tools/server/file-registry.ts
var import_node_events, IDLE_TIMEOUT_MS, FileRegistry;
var init_file_registry = __esm({
  "tools/server/file-registry.ts"() {
    import_node_events = require("node:events");
    init_sync_service();
    init_file_watcher();
    init_security();
    IDLE_TIMEOUT_MS = 30 * 60 * 1e3;
    FileRegistry = class _FileRegistry extends import_node_events.EventEmitter {
      constructor() {
        super(...arguments);
        this.files = /* @__PURE__ */ new Map();
        this.pendingUnregister = /* @__PURE__ */ new Set();
        this.hubClients = /* @__PURE__ */ new Set();
      }
      static {
        this.MAX_FILES = Number(process.env.VYNC_MAX_FILES) || 50;
      }
      addHubClient(ws) {
        this.hubClients.add(ws);
      }
      removeHubClient(ws) {
        this.hubClients.delete(ws);
      }
      broadcastToHub(message) {
        const data = JSON.stringify(message);
        for (const client of this.hubClients) {
          if (client.readyState === 1) {
            client.send(data);
          }
        }
      }
      async register(filePath) {
        const validated = await validateFilePath(filePath);
        while (this.pendingUnregister.has(validated)) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (this.files.has(validated)) {
          this.resetIdleTimer(validated);
          return;
        }
        if (this.files.size >= _FileRegistry.MAX_FILES) {
          throw new Error(
            `Maximum number of tracked files (${_FileRegistry.MAX_FILES}) reached`
          );
        }
        const entry = {
          sync: null,
          watcher: null,
          clients: /* @__PURE__ */ new Set()
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
                  type: "file-changed",
                  filePath: validated,
                  data
                });
              }
            },
            onDelete: () => {
              this.broadcastToFile(validated, {
                type: "file-deleted",
                filePath: validated
              });
            }
          });
        } catch (err) {
          this.files.delete(validated);
          throw err;
        }
        this.emit("registered", validated);
        this.broadcastToHub({ type: "hub-file-registered", filePath: validated });
      }
      async unregister(filePath) {
        const entry = this.files.get(filePath);
        if (!entry) return;
        this.pendingUnregister.add(filePath);
        try {
          this.broadcastToFile(filePath, { type: "file-closed", filePath });
          await entry.sync.drain();
          await entry.watcher.close();
          if (entry.idleTimer) clearTimeout(entry.idleTimer);
          for (const ws of entry.clients) {
            ws.close(4e3, "File unregistered");
          }
          this.files.delete(filePath);
        } finally {
          this.pendingUnregister.delete(filePath);
        }
        this.emit("unregistered", filePath);
        this.broadcastToHub({ type: "hub-file-unregistered", filePath });
        if (this.files.size === 0) {
          this.emit("empty");
        }
      }
      getSync(filePath) {
        return this.files.get(filePath)?.sync;
      }
      getEntry(filePath) {
        return this.files.get(filePath);
      }
      listFiles() {
        return [...this.files.keys()];
      }
      addClient(filePath, ws) {
        const entry = this.files.get(filePath);
        if (!entry) return;
        entry.clients.add(ws);
        this.resetIdleTimer(filePath);
      }
      removeClient(filePath, ws) {
        const entry = this.files.get(filePath);
        if (!entry) return;
        entry.clients.delete(ws);
        if (entry.clients.size === 0) {
          this.startIdleTimer(filePath);
        }
      }
      broadcastToFile(filePath, message) {
        const entry = this.files.get(filePath);
        if (!entry) return;
        const data = JSON.stringify(message);
        for (const client of entry.clients) {
          if (client.readyState === 1) {
            client.send(data);
          }
        }
      }
      async shutdown() {
        const files = [...this.files.keys()];
        for (const fp of files) {
          await this.unregister(fp).catch(() => {
          });
        }
        for (const ws of this.hubClients) {
          ws.close(1001, "Server shutting down");
        }
        this.hubClients.clear();
      }
      startIdleTimer(filePath) {
        const entry = this.files.get(filePath);
        if (!entry) return;
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        entry.idleTimer = setTimeout(() => {
          console.log(`[vync] Idle timeout: unregistering ${filePath}`);
          this.unregister(filePath).catch(() => {
          });
        }, IDLE_TIMEOUT_MS);
      }
      resetIdleTimer(filePath) {
        const entry = this.files.get(filePath);
        if (!entry) return;
        if (entry.idleTimer) {
          clearTimeout(entry.idleTimer);
          entry.idleTimer = void 0;
        }
      }
    };
  }
});

// tools/server/server.ts
var server_exports = {};
__export(server_exports, {
  startServer: () => startServer
});
async function startServer(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const mode = options.mode ?? "development";
  const processMode = options.processMode ?? "daemon";
  const registry = new FileRegistry();
  if (options.initialFile) {
    addAllowedDir(import_node_path3.default.dirname(options.initialFile));
    await registry.register(options.initialFile);
  }
  const app2 = (0, import_express.default)();
  app2.use(import_express.default.json({ limit: "10mb" }));
  app2.use(createHostGuard(port));
  const allowedOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`
  ];
  app2.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app2.get("/api/health", (_req, res) => {
    res.json({
      version: 2,
      mode: "hub",
      processMode,
      pid: process.pid,
      fileCount: registry.listFiles().length
    });
  });
  app2.get("/api/files", (_req, res) => {
    res.json({ files: registry.listFiles() });
  });
  app2.post("/api/files", async (req, res) => {
    const { filePath } = req.body;
    if (!filePath || typeof filePath !== "string") {
      res.status(400).json({ error: "filePath required" });
      return;
    }
    try {
      const validated = await validateFilePath(filePath);
      addAllowedDir(import_node_path3.default.dirname(validated));
      const alreadyRegistered = registry.getSync(validated) !== void 0;
      await registry.register(validated);
      res.status(alreadyRegistered ? 200 : 201).json({
        filePath: validated,
        status: alreadyRegistered ? "already_registered" : "registered"
      });
    } catch (err) {
      if (err.message.includes("outside allowed") || err.message.includes("Only .vync")) {
        res.status(403).json({ error: err.message });
      } else if (err.message.includes("Maximum")) {
        res.status(429).json({ error: err.message });
      } else {
        console.error("[vync] Registration error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  });
  app2.delete("/api/files", async (req, res) => {
    const filePath = req.query.file;
    const all = req.query.all === "true";
    if (all) {
      await registry.shutdown();
      res.json({ status: "all_unregistered" });
      return;
    }
    if (!filePath) {
      res.status(400).json({ error: "file query param required" });
      return;
    }
    try {
      await registry.unregister(filePath);
      res.json({ status: "unregistered", filePath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/files/discover", async (_req, res) => {
    try {
      const registered = new Set(registry.listFiles());
      const scanDirs = /* @__PURE__ */ new Set();
      for (const dir of getAllowedDirs()) {
        scanDirs.add(dir);
        scanDirs.add(import_node_path3.default.join(dir, ".vync"));
      }
      const discovered = [];
      const MAX_RESULTS = 100;
      for (const dir of scanDirs) {
        if (discovered.length >= MAX_RESULTS) break;
        try {
          const entries = await import_promises4.default.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (discovered.length >= MAX_RESULTS) break;
            if (!entry.isFile() || !entry.name.endsWith(".vync")) continue;
            const real = await import_promises4.default.realpath(import_node_path3.default.join(dir, entry.name)).catch(() => null);
            if (real && !registered.has(real)) {
              discovered.push(real);
            }
          }
        } catch {
        }
      }
      res.json({ files: [...new Set(discovered)] });
    } catch (err) {
      console.error("[vync] Discovery error:", err);
      res.status(500).json({ error: "Discovery failed" });
    }
  });
  app2.get("/api/sync", async (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
      res.status(400).json({ error: "file_required", files: registry.listFiles() });
      return;
    }
    const sync = registry.getSync(filePath);
    if (!sync) {
      res.status(404).json({ error: "File not registered", filePath });
      return;
    }
    try {
      const data = await sync.readFile();
      res.json(data);
    } catch (err) {
      console.error("[vync] Error reading file:", err);
      res.status(500).json({ error: "Failed to read file" });
    }
  });
  app2.put("/api/sync", async (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
      res.status(400).json({ error: "file_required" });
      return;
    }
    const sync = registry.getSync(filePath);
    if (!sync) {
      res.status(404).json({ error: "File not registered", filePath });
      return;
    }
    try {
      const data = req.body;
      if (!data) {
        res.status(400).json({ error: "Invalid VyncFile format" });
        return;
      }
      if (isGraphFile(data)) {
        const gd = data;
        if (!Array.isArray(gd.nodes) || !Array.isArray(gd.edges)) {
          res.status(400).json({ error: "Graph file requires nodes and edges arrays" });
          return;
        }
        if (gd.nodes.length > 2e3 || gd.edges.length > 5e3) {
          res.status(413).json({
            error: "Graph exceeds maximum size (2000 nodes, 5000 edges)"
          });
          return;
        }
      } else {
        if (!Array.isArray(data.elements)) {
          res.status(400).json({ error: "Invalid VyncFile format" });
          return;
        }
      }
      await sync.writeFile(data);
      registry.broadcastToFile(filePath, {
        type: "file-changed",
        filePath,
        data
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("[vync] Error writing file:", err);
      res.status(500).json({ error: "Failed to write file" });
    }
  });
  const server = import_node_http.default.createServer(app2);
  let vite = null;
  if (mode === "production" && options.staticDir) {
    app2.use(import_express.default.static(options.staticDir));
    app2.get("*path", (_req, res) => {
      res.sendFile(import_node_path3.default.join(options.staticDir, "index.html"));
    });
  } else if (mode === "development") {
    const { createServer: createViteServer } = await import("vite");
    const projectRoot = process.env.VYNC_HOME || process.cwd();
    const webAppRoot = import_node_path3.default.resolve(projectRoot, "apps/web");
    vite = await createViteServer({
      configFile: import_node_path3.default.resolve(webAppRoot, "vite.config.ts"),
      root: webAppRoot,
      server: { middlewareMode: true, hmr: { server } }
    });
    app2.use(vite.middlewares);
  }
  const ws = createWsServer(server, port, registry);
  const shutdown = async () => {
    console.log("\n[vync] Shutting down...");
    await registry.shutdown();
    ws.close();
    if (vite) await vite.close();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3e3);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  };
  const url = `http://localhost:${port}`;
  await new Promise((resolve, reject) => {
    const onStartupError = (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`[vync] Port ${port} is already in use`));
      } else {
        reject(err);
      }
    };
    server.once("error", onStartupError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onStartupError);
      console.log(`[vync] Hub server running at ${url}`);
      if (options.initialFile) {
        console.log(`[vync] Initial file: ${options.initialFile}`);
      }
      resolve();
    });
  });
  if (options.openBrowser && options.initialFile) {
    const openModule = await import("open");
    await openModule.default(
      `${url}/?file=${encodeURIComponent(options.initialFile)}`
    );
  }
  return { shutdown, server, url, registry };
}
var import_node_http, import_node_path3, import_promises4, import_express, DEFAULT_PORT, isDirectRun;
var init_server = __esm({
  "tools/server/server.ts"() {
    import_node_http = __toESM(require("node:http"));
    import_node_path3 = __toESM(require("node:path"));
    import_promises4 = __toESM(require("node:fs/promises"));
    import_express = __toESM(require("express"));
    init_ws_handler();
    init_file_registry();
    init_security();
    init_src();
    DEFAULT_PORT = 3100;
    isDirectRun = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
    if (isDirectRun) {
      const filePath = process.argv[2];
      const resolvedFile = filePath ? import_node_path3.default.resolve(filePath) : void 0;
      if (resolvedFile) addAllowedDir(import_node_path3.default.dirname(resolvedFile));
      startServer({ initialFile: resolvedFile }).then(({ shutdown }) => {
        process.on("SIGINT", async () => {
          await shutdown();
          process.exit(0);
        });
        process.on("SIGTERM", async () => {
          await shutdown();
          process.exit(0);
        });
      }).catch((err) => {
        console.error("[vync] Fatal error:", err.message);
        process.exit(1);
      });
    }
  }
});

// tools/electron/main.ts
var import_electron = require("electron");
var import_node_path4 = __toESM(require("node:path"));
process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE") return;
  console.error("[vync] Uncaught exception:", err);
  import_electron.app.quit();
});
var mainWindow = null;
var serverHandle = null;
var pendingFilePath = null;
var gotTheLock = import_electron.app.requestSingleInstanceLock();
if (!gotTheLock) {
  import_electron.app.quit();
} else {
  import_electron.app.on("second-instance", (_event, argv) => {
    const file = argv.find((a) => a.endsWith(".vync"));
    if (file) openFile(file);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
import_electron.app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    openFile(filePath);
  } else {
    pendingFilePath = filePath;
  }
});
import_electron.app.whenReady().then(async () => {
  const filePath = pendingFilePath || process.argv.find((a) => a.endsWith(".vync")) || null;
  if (!filePath) {
    const result = await import_electron.dialog.showOpenDialog({
      filters: [{ name: "Vync Canvas", extensions: ["vync"] }],
      properties: ["openFile", "showHiddenFiles"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      import_electron.app.quit();
      return;
    }
    await openFile(result.filePaths[0]);
  } else {
    await openFile(filePath);
  }
});
import_electron.app.on("window-all-closed", async () => {
  if (serverHandle) {
    await serverHandle.shutdown();
    serverHandle = null;
  }
  import_electron.app.quit();
});
async function openFile(filePath) {
  const resolved = import_node_path4.default.resolve(filePath);
  if (serverHandle) {
    try {
      await fetch(`${serverHandle.url}/api/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: resolved })
      });
    } catch (err) {
      import_electron.dialog.showErrorBox(
        "Vync Error",
        `Failed to register file: ${err.message}`
      );
      return;
    }
  } else {
    try {
      const { startServer: startServer2 } = await Promise.resolve().then(() => (init_server(), server_exports));
      const isDev = !import_electron.app.isPackaged;
      const staticDir = isDev ? void 0 : import_node_path4.default.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "dist",
        "apps",
        "web"
      );
      serverHandle = await startServer2({
        initialFile: resolved,
        port: 3100,
        mode: isDev ? "development" : "production",
        processMode: "electron",
        staticDir
      });
    } catch (err) {
      if (err.message.includes("already in use")) {
        const existingUrl = "http://localhost:3100";
        try {
          const res = await fetch(`${existingUrl}/api/health`, {
            signal: AbortSignal.timeout(2e3)
          });
          if (res.ok) {
            const body = await res.json();
            if (body.version === 2) {
              serverHandle = { shutdown: async () => {
              }, url: existingUrl };
              console.log(`[vync] Reusing existing server (PID ${body.pid})`);
              await fetch(`${existingUrl}/api/files`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filePath: resolved })
              });
            } else {
              import_electron.dialog.showErrorBox(
                "Vync Error",
                "Incompatible server on port 3100"
              );
              import_electron.app.quit();
              return;
            }
          } else {
            import_electron.dialog.showErrorBox(
              "Vync Error",
              "Port 3100 in use by non-Vync process"
            );
            import_electron.app.quit();
            return;
          }
        } catch {
          import_electron.dialog.showErrorBox(
            "Vync Error",
            "Port 3100 in use but server not responding"
          );
          import_electron.app.quit();
          return;
        }
      } else {
        import_electron.dialog.showErrorBox("Vync Error", err.message);
        import_electron.app.quit();
        return;
      }
    }
  }
  if (!mainWindow) {
    const fileUrl = `${serverHandle.url}/?file=${encodeURIComponent(
      resolved
    )}`;
    createWindow(fileUrl);
  }
}
function createWindow(url) {
  mainWindow = new import_electron.BrowserWindow({
    width: 1400,
    height: 900,
    title: "Vync",
    webPreferences: {
      preload: import_node_path4.default.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
//# sourceMappingURL=main.js.map
