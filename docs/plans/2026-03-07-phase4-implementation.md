# Phase 4: Claude Code 통합 플러그인 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Claude Code의 전역 확장 시스템을 통해 .vync 파일의 전체 라이프사이클을 관리하는 통합 도구 구축.

**Architecture:** CLI(bin/vync.js)가 기반 레이어로 서버 관리를 담당하고, Skill(vync-editing)이 지식 레이어로 .vync 편집을 가이드한다. Commands는 CLI의 thin wrapper + Skill 트리거. PostToolUse hook이 자동 검증.

**Tech Stack:** Node.js 25, TypeScript, tsx, express, open (npm), chokidar, Ajv (JSON Schema validation)

**Design Doc:** `docs/plans/2026-03-07-phase4-claude-plugin-design.md`

---

## Task 1: CLI 기반 레이어 — init 명령어

`vync init <file>` 로 빈 .vync 캔버스 파일을 생성하는 CLI 명령어.

**Files:**
- Create: `src/cli/init.ts`
- Test: `src/cli/__tests__/init.test.ts`

**Step 1: Write the failing test**

```typescript
// src/cli/__tests__/init.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { vyncInit } from '../init.js';

describe('vyncInit', () => {
  const tmpDir = path.join(os.tmpdir(), 'vync-test-init');

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a valid .vync file with empty canvas', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'test.vync');

    await vyncInit(filePath);

    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    expect(data.version).toBe(1);
    expect(data.viewport).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(data.elements).toEqual([]);
  });

  it('throws if file already exists', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'existing.vync');
    await fs.writeFile(filePath, '{}');

    await expect(vyncInit(filePath)).rejects.toThrow('already exists');
  });

  it('appends .vync extension if missing', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'test');

    await vyncInit(filePath);

    const exists = await fs.access(path.join(tmpDir, 'test.vync')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/__tests__/init.test.ts`
Expected: FAIL — module `../init.js` not found

**Step 3: Write minimal implementation**

```typescript
// src/cli/init.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { VyncFile } from '../shared/types.js';

const EMPTY_CANVAS: VyncFile = {
  version: 1,
  viewport: { zoom: 1, x: 0, y: 0 },
  elements: [],
};

export async function vyncInit(filePath: string): Promise<string> {
  // Append .vync extension if missing
  const resolved = filePath.endsWith('.vync') ? filePath : `${filePath}.vync`;
  const absolute = path.resolve(resolved);

  // Check if file already exists
  try {
    await fs.access(absolute);
    throw new Error(`File already exists: ${absolute}`);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(absolute), { recursive: true });

  // Write empty canvas
  await fs.writeFile(absolute, JSON.stringify(EMPTY_CANVAS, null, 2), 'utf-8');

  return absolute;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/__tests__/init.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add src/cli/init.ts src/cli/__tests__/init.test.ts
git commit -m "feat(cli): add vync init command

Creates empty .vync canvas file with version 1 format.
Auto-appends .vync extension, rejects existing files."
```

---

## Task 2: CLI 기반 레이어 — open/stop 명령어 + bin 진입점

`vync open <file>` 로 서버를 background로 시작하고 브라우저를 열고, `vync stop` 으로 종료.

**Files:**
- Modify: `src/server/server.ts` (main 함수 export)
- Create: `src/cli/open.ts`
- Create: `bin/vync.js`
- Modify: `package.json` (bin 필드 + open 의존성)

**Step 1: Install `open` package**

Run: `npm install open`

**Step 2: Refactor server.ts — export startServer function**

현재 `src/server/server.ts:12-143`의 `main()` 함수를 `startServer(filePath, options?)` 로 리팩토링하여 외부에서 호출 가능하게 만든다.

```typescript
// src/server/server.ts — 변경 사항 (기존 main을 startServer로 분리)
// 기존 main() 맨 위의 filePath 파싱 로직을 파라미터로 이동
// export async function startServer(filePath: string, options?: { openBrowser?: boolean })
// 기존 process.argv[2] 파싱은 파일 하단의 CLI 실행 부분으로 이동
```

수정할 부분:
- `async function main()` → `export async function startServer(resolvedPath: string, options: { openBrowser?: boolean } = {})`
- `const filePath = process.argv[2];` 제거 (파라미터로 받음)
- `const resolvedPath = path.resolve(filePath);` 제거 (이미 resolved)
- server.listen 콜백에서 `options.openBrowser`이면 `open(url)` 호출
- 파일 하단에 직접 실행 시 기존 동작 유지: `if (process.argv[1] === fileURLToPath(import.meta.url)) { ... }`
- `startServer`가 shutdown 함수를 반환하여 외부에서 종료 가능

```typescript
// src/server/server.ts 리팩토링된 전체 구조
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createFileWatcher } from './file-watcher.js';
import { createWsServer } from './ws-handler.js';
import { createSyncService } from './sync-service.js';
import type { VyncFile } from '../shared/types.js';

const PORT = 3100;

export async function startServer(resolvedPath: string, options: { openBrowser?: boolean } = {}) {
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

  // --- API Routes ---
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

  const server = http.createServer(app);

  // --- Vite dev server ---
  const projectRoot = process.env.VYNC_HOME || process.cwd();
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

  // --- WebSocket ---
  const ws = createWsServer(server, PORT);

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
    await vite.close();
    server.close();
  };

  process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
  process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });

  const url = `http://localhost:${PORT}`;

  await new Promise<void>((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[vync] Server running at ${url}`);
      console.log(`[vync] Watching: ${resolvedPath}`);
      console.log(`[vync] WebSocket: ws://localhost:${PORT}/ws`);
      resolve();
    });
  });

  if (options.openBrowser) {
    const openModule = await import('open');
    await openModule.default(url);
  }

  return { shutdown, server, url };
}

// Direct execution (backward compat with `tsx src/server/server.ts <file>`)
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile || process.argv[1]?.endsWith('/server.ts')) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx src/server/server.ts <file.vync>');
    process.exit(1);
  }
  startServer(path.resolve(filePath));
}
```

**Step 3: Create src/cli/open.ts**

```typescript
// src/cli/open.ts
import fs from 'node:fs/promises';
import path from 'node:path';

const PID_FILE = '/tmp/vync-server.pid';

export async function vyncOpen(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);

  // Verify file exists
  try {
    await fs.access(resolved);
  } catch {
    console.error(`[vync] File not found: ${resolved}`);
    console.error('[vync] Run "vync init <file>" first.');
    process.exit(1);
  }

  // Check if server already running
  try {
    const existingPid = await fs.readFile(PID_FILE, 'utf-8');
    process.kill(Number(existingPid), 0); // Check if process exists
    console.error(`[vync] Server already running (PID ${existingPid.trim()}). Run "vync stop" first.`);
    process.exit(1);
  } catch {
    // Not running, continue
  }

  // Write PID file
  await fs.writeFile(PID_FILE, String(process.pid), 'utf-8');

  // Start server (dynamic import to avoid loading vite at CLI parse time)
  const { startServer } = await import('../server/server.js');
  await startServer(resolved, { openBrowser: true });
}

export async function vyncStop(): Promise<void> {
  try {
    const pid = await fs.readFile(PID_FILE, 'utf-8');
    process.kill(Number(pid), 'SIGTERM');
    await fs.unlink(PID_FILE);
    console.log(`[vync] Server stopped (PID ${pid.trim()})`);
  } catch {
    console.error('[vync] No running server found.');
  }
}
```

**Step 4: Create bin/vync.js**

```javascript
#!/usr/bin/env node

// bin/vync.js — CLI entry point
// Delegates to src/cli/ via tsx

import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.VYNC_HOME || path.resolve(__dirname, '..');

const [,, command, ...args] = process.argv;

const USAGE = `Usage: vync <command> [options]

Commands:
  init <file>    Create an empty .vync canvas file
  open <file>    Start server and open browser
  stop           Stop the running server

Examples:
  vync init plan.vync
  vync open plan.vync
  vync stop`;

if (!command || command === '--help' || command === '-h') {
  console.log(USAGE);
  process.exit(0);
}

// Run the TypeScript CLI module via tsx
const cliModule = {
  init: path.join(projectRoot, 'src/cli/init.ts'),
  open: path.join(projectRoot, 'src/cli/open.ts'),
}[command];

if (!cliModule) {
  console.error(`Unknown command: ${command}\n`);
  console.log(USAGE);
  process.exit(1);
}

// Use tsx to run TypeScript directly
const tsxArgs = ['--import', 'tsx/esm', cliModule, command, ...args];
const child = spawn('node', tsxArgs, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, VYNC_HOME: projectRoot },
});

child.on('exit', (code) => process.exit(code ?? 0));
```

Wait, this approach is complex. Simpler: bin/vync.js uses tsx to run a single entry module.

Actually, let me reconsider. The simplest approach:

```javascript
#!/usr/bin/env node
// bin/vync.js
// Uses tsx register hook to run TypeScript src/cli/ modules directly
```

Let me rethink. The cleanest approach for bin/vync.js:

Option A: bin/vync.js is a thin JS script that spawns `tsx src/cli/main.ts <args>`
Option B: bin/vync.js is itself TypeScript run via tsx shebang
Option C: bin/vync.js is JavaScript that imports compiled output

For MVP, option A is simplest and most reliable.

Let me rewrite the plan to use a single `src/cli/main.ts` entry that handles all subcommands.

**Step 5: Update package.json**

Add to `package.json`:
- `"bin": { "vync": "./bin/vync.js" }`
- `"type": "module"` (if not already)
- `open` dependency already installed in step 1

**Step 6: Verify CLI works**

Run: `node bin/vync.js --help`
Expected: Usage text printed

Run: `node bin/vync.js init /tmp/test-cli.vync`
Expected: File created, success message

Run: `cat /tmp/test-cli.vync`
Expected: `{"version":1,"viewport":{"zoom":1,"x":0,"y":0},"elements":[]}`

**Step 7: Commit**

```bash
git add src/server/server.ts src/cli/open.ts bin/vync.js package.json
git commit -m "feat(cli): add vync open/stop commands and bin entry point

- Refactor server.ts to export startServer() for reuse
- Add open.ts with PID-based server management
- Add bin/vync.js entry point routing init/open/stop
- Add 'open' npm package for cross-platform browser launch"
```

---

## Task 3: JSON Schema + 검증 스크립트

`validate.js`가 hook에서 호출되어 .vync 파일의 JSON Schema 유효성을 검증.

**Files:**
- Create: `claude-plugin/skills/vync-editing/assets/schema.json`
- Create: `claude-plugin/skills/vync-editing/scripts/validate.js`
- Create: `claude-plugin/skills/vync-editing/scripts/generate-id.js`
- Copy: `.vync.schema.json` (프로젝트 루트 복사본)

**Step 1: Create JSON Schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VyncFile",
  "description": ".vync canvas file format",
  "type": "object",
  "required": ["version", "viewport", "elements"],
  "properties": {
    "version": {
      "type": "integer",
      "const": 1
    },
    "viewport": {
      "$ref": "#/$defs/Viewport"
    },
    "elements": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/PlaitElement"
      }
    }
  },
  "additionalProperties": false,
  "$defs": {
    "Viewport": {
      "type": "object",
      "required": ["zoom", "x", "y"],
      "properties": {
        "zoom": { "type": "number", "exclusiveMinimum": 0 },
        "x": { "type": "number" },
        "y": { "type": "number" }
      },
      "additionalProperties": false
    },
    "Point": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 2,
      "maxItems": 2
    },
    "SlateText": {
      "type": "object",
      "required": ["children"],
      "properties": {
        "children": {
          "type": "array",
          "minItems": 1
        },
        "align": { "type": "string" }
      }
    },
    "PlaitElement": {
      "type": "object",
      "required": ["id"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "type": { "type": "string" },
        "children": { "type": "array" },
        "points": {
          "type": "array",
          "items": { "$ref": "#/$defs/Point" }
        },
        "groupId": { "type": "string" },
        "angle": { "type": "number" }
      }
    }
  }
}
```

Note: Schema는 유연하게 작성. PlaitElement는 `[key: string]: any` 인터페이스이므로 `additionalProperties: true` (기본값). 필수 필드(id)만 강제하고, 타입별 세부 검증은 하지 않음 (AI가 잘못 생성해도 웹 UI에서 무시되지 크래시하지 않음).

**Step 2: Create validate.js**

```javascript
#!/usr/bin/env node
// claude-plugin/skills/vync-editing/scripts/validate.js
// Usage: node validate.js <file.vync>
// Exit 0 = valid, Exit 1 = invalid (errors on stderr)

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '..', 'assets', 'schema.json');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node validate.js <file.vync>');
  process.exit(1);
}

try {
  const content = readFileSync(resolve(filePath), 'utf-8');
  const data = JSON.parse(content);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

  // Basic structural validation (no Ajv dependency — keep it lightweight)
  const errors = [];

  if (typeof data.version !== 'number') errors.push('missing or invalid "version" field');
  if (!data.viewport || typeof data.viewport !== 'object') errors.push('missing "viewport" object');
  else {
    if (typeof data.viewport.zoom !== 'number') errors.push('viewport.zoom must be a number');
    if (typeof data.viewport.x !== 'number') errors.push('viewport.x must be a number');
    if (typeof data.viewport.y !== 'number') errors.push('viewport.y must be a number');
  }
  if (!Array.isArray(data.elements)) errors.push('"elements" must be an array');
  else {
    data.elements.forEach((el, i) => {
      if (!el.id || typeof el.id !== 'string') errors.push(`elements[${i}]: missing or invalid "id"`);
      if (el.id && el.id.length < 1) errors.push(`elements[${i}]: "id" must not be empty`);
    });

    // Check for duplicate IDs (recursive)
    const ids = new Set();
    function collectIds(elements) {
      for (const el of elements) {
        if (el.id) {
          if (ids.has(el.id)) errors.push(`duplicate id: "${el.id}"`);
          ids.add(el.id);
        }
        if (Array.isArray(el.children)) collectIds(el.children);
      }
    }
    collectIds(data.elements);
  }

  if (errors.length > 0) {
    console.error(`[vync-validate] ${filePath}: ${errors.length} error(s)`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(`[vync-validate] ${filePath}: OK`);
  process.exit(0);
} catch (err) {
  if (err instanceof SyntaxError) {
    console.error(`[vync-validate] ${filePath}: Invalid JSON — ${err.message}`);
  } else {
    console.error(`[vync-validate] ${filePath}: ${err.message}`);
  }
  process.exit(1);
}
```

Note: 의존성 0 (Ajv 불필요). 기본 구조 검증 + 중복 ID 검사. 전역 스크립트이므로 node_modules 없이 실행 가능해야 함.

**Step 3: Create generate-id.js**

```javascript
#!/usr/bin/env node
// claude-plugin/skills/vync-editing/scripts/generate-id.js
// Usage: node generate-id.js [count]
// Generates idCreator(5) compatible IDs

const CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz';
const LENGTH = 5;

function generateId() {
  let id = '';
  for (let i = 0; i < LENGTH; i++) {
    id += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return id;
}

const count = parseInt(process.argv[2] || '1', 10);
for (let i = 0; i < count; i++) {
  console.log(generateId());
}
```

**Step 4: Copy schema to project root**

Run: `cp claude-plugin/skills/vync-editing/assets/schema.json .vync.schema.json`

**Step 5: Test validate.js**

Run: `echo '{"version":1,"viewport":{"zoom":1,"x":0,"y":0},"elements":[]}' > /tmp/valid.vync && node claude-plugin/skills/vync-editing/scripts/validate.js /tmp/valid.vync`
Expected: `[vync-validate] /tmp/valid.vync: OK`

Run: `echo '{"bad":true}' > /tmp/invalid.vync && node claude-plugin/skills/vync-editing/scripts/validate.js /tmp/invalid.vync; echo "exit: $?"`
Expected: errors printed, `exit: 1`

**Step 6: Test generate-id.js**

Run: `node claude-plugin/skills/vync-editing/scripts/generate-id.js 3`
Expected: 3 lines of 5-character IDs

**Step 7: Commit**

```bash
git add claude-plugin/skills/vync-editing/assets/schema.json \
        claude-plugin/skills/vync-editing/scripts/validate.js \
        claude-plugin/skills/vync-editing/scripts/generate-id.js \
        .vync.schema.json
git commit -m "feat(plugin): add JSON Schema and validation scripts

- schema.json: VyncFile structure validation
- validate.js: zero-dependency structural validator + duplicate ID check
- generate-id.js: idCreator(5) compatible ID generator"
```

---

## Task 4: Skill — SKILL.md + references

핵심 지식 패키지. Claude Code가 .vync 편집 시 자동 로드되는 가이드.

**Files:**
- Create: `claude-plugin/skills/vync-editing/SKILL.md`
- Create: `claude-plugin/skills/vync-editing/references/mindmap.md`
- Create: `claude-plugin/skills/vync-editing/references/geometry.md`
- Create: `claude-plugin/skills/vync-editing/references/arrow-line.md`
- Create: `claude-plugin/skills/vync-editing/references/coordinates.md`

**Step 1: Create SKILL.md**

```markdown
---
name: vync-editing
description: Edit .vync canvas files (PlaitElement JSON). Use when creating or modifying mindmaps, flowcharts, diagrams in .vync format. Triggers on .vync file editing, mindmap/diagram creation, PlaitElement manipulation, Plait/Drawnix canvas operations.
---

# Vync Canvas Editing

## .vync File Format

```json
{
  "version": 1,
  "viewport": { "zoom": 1, "x": 0, "y": 0 },
  "elements": [ /* PlaitElement[] */ ]
}
```

## ID Generation Rule

`idCreator(5)` — 5-char random string from: `ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz`
All IDs must be unique across the entire file (including nested children).
Generate with: `node ~/.claude/skills/vync-editing/scripts/generate-id.js`

## Editing Workflow

1. **Read** the target .vync file first
2. **Load** the relevant reference for your element type:
   - Mindmap: `references/mindmap.md`
   - Geometry (shapes): `references/geometry.md`
   - Arrow lines: `references/arrow-line.md`
   - Coordinate system: `references/coordinates.md`
3. **Generate** valid PlaitElement[] JSON following the reference
4. **Write** to file — PostToolUse hook will auto-validate

## Critical Rules

- `children` arrays in Slate text nodes must never be empty — minimum: `[{ "text": "" }]`
- Mindmap child nodes do NOT need `points` — layout engine auto-places them
- Bounding box points: `[[x1,y1], [x2,y2]]` where x1 < x2, y1 < y2
- When modifying existing files, preserve all fields you don't intend to change
- Do NOT modify `viewport` unless explicitly asked

## Element Types

| Type | Difficulty | Primary Use |
|------|-----------|-------------|
| `mindmap` / `mind_child` | Easy | Planning, brainstorming |
| `geometry` | Easy | Flowcharts, diagrams |
| `arrow-line` | Medium-Hard | Connecting shapes (boundId binding) |
| `vector-line` | Easy | Free-form lines |
| `image` | Hard (avoid) | Use web UI instead |

## Quick Templates

### Minimal Mindmap (most common)
```json
{
  "id": "<5-char>", "type": "mindmap",
  "data": { "topic": { "children": [{ "text": "Root Topic" }] } },
  "children": [
    {
      "id": "<5-char>", "type": "mind_child",
      "data": { "topic": { "children": [{ "text": "Child 1" }] } },
      "children": []
    }
  ],
  "width": 100, "height": 50, "points": [[0, 0]], "isRoot": true
}
```

### Minimal Rectangle
```json
{
  "id": "<5-char>", "type": "geometry", "shape": "rectangle",
  "points": [[0, 0], [200, 80]],
  "text": { "children": [{ "text": "Label" }] },
  "children": []
}
```
```

**Step 2: Create references/mindmap.md**

Content based on ARCHITECTURE.md §4.2 (PlaitMind) + §7.5 (마인드맵 난이도 평가).
Include: MindElement interface, data.topic structure, children tree, rightNodeCount, styling fields, complete 3-level mindmap example.

**Step 3: Create references/geometry.md**

Content based on ARCHITECTURE.md §4.2 (PlaitGeometry) + §7.6.
Include: shape enum full list (BasicShapes + FlowchartSymbols), points bounding box, text ParagraphElement, autoSize, complete flowchart example with 3 shapes.

**Step 4: Create references/arrow-line.md**

Content based on ARCHITECTURE.md §4.2 (PlaitArrowLine) + §7.7.
Include: source/target handles, boundId binding, connection coordinate mapping table (`[0.5,0]`=top center, `[1,0.5]`=right center, etc.), marker types, texts, complete example of 2 shapes + 1 arrow connecting them.

**Step 5: Create references/coordinates.md**

Content based on ARCHITECTURE.md §4.3.
Include: Point type, bounding box rules, mindmap root positioning, grid layout strategy for placing multiple shapes without overlap, viewport coordinates.

**Step 6: Commit**

```bash
git add claude-plugin/skills/vync-editing/SKILL.md \
        claude-plugin/skills/vync-editing/references/
git commit -m "feat(plugin): add vync-editing skill with references

- SKILL.md: trigger metadata, overview, editing workflow, quick templates
- references/: detailed guides for mindmap, geometry, arrow-line, coordinates"
```

---

## Task 5: Skill Assets — 예시 .vync 파일

Claude가 참조할 수 있는 실제 .vync 파일 예시.

**Files:**
- Create: `claude-plugin/skills/vync-editing/assets/mindmap.vync`
- Create: `claude-plugin/skills/vync-editing/assets/flowchart.vync`
- Copy: `examples/mindmap.vync`, `examples/flowchart.vync`

**Step 1: Create mindmap.vync example**

3단계 마인드맵: "프로젝트 계획" 루트 → 2개 브랜치("설계", "구현") → 각 2개 리프.
모든 ID는 generate-id.js로 생성. data.topic은 Slate 텍스트 노드 형식.

```json
{
  "version": 1,
  "viewport": { "zoom": 1, "x": 0, "y": 0 },
  "elements": [
    {
      "id": "AbCdE",
      "type": "mindmap",
      "data": { "topic": { "children": [{ "text": "Project Plan" }] } },
      "children": [
        {
          "id": "FgHjK",
          "type": "mind_child",
          "data": { "topic": { "children": [{ "text": "Design" }] } },
          "children": [
            {
              "id": "MnPqR",
              "type": "mind_child",
              "data": { "topic": { "children": [{ "text": "Architecture" }] } },
              "children": []
            },
            {
              "id": "StWxY",
              "type": "mind_child",
              "data": { "topic": { "children": [{ "text": "Data Model" }] } },
              "children": []
            }
          ]
        },
        {
          "id": "aBcDe",
          "type": "mind_child",
          "data": { "topic": { "children": [{ "text": "Implementation" }] } },
          "children": [
            {
              "id": "fGhJk",
              "type": "mind_child",
              "data": { "topic": { "children": [{ "text": "Backend" }] } },
              "children": []
            },
            {
              "id": "mNpQr",
              "type": "mind_child",
              "data": { "topic": { "children": [{ "text": "Frontend" }] } },
              "children": []
            }
          ]
        }
      ],
      "width": 100,
      "height": 50,
      "points": [[0, 0]],
      "isRoot": true
    }
  ]
}
```

**Step 2: Create flowchart.vync example**

도형 3개(Start → Process → End) + 연결선 2개.

```json
{
  "version": 1,
  "viewport": { "zoom": 1, "x": 0, "y": 0 },
  "elements": [
    {
      "id": "sT1aB",
      "type": "geometry",
      "shape": "process",
      "points": [[0, 0], [160, 60]],
      "text": { "children": [{ "text": "Start" }], "align": "center" },
      "children": []
    },
    {
      "id": "pR2cD",
      "type": "geometry",
      "shape": "process",
      "points": [[0, 120], [160, 180]],
      "text": { "children": [{ "text": "Process Data" }], "align": "center" },
      "children": []
    },
    {
      "id": "eN3eF",
      "type": "geometry",
      "shape": "process",
      "points": [[0, 240], [160, 300]],
      "text": { "children": [{ "text": "End" }], "align": "center" },
      "children": []
    },
    {
      "id": "aR4gH",
      "type": "arrow-line",
      "shape": "elbow",
      "source": {
        "marker": "none",
        "boundId": "sT1aB",
        "connection": [0.5, 1]
      },
      "target": {
        "marker": "arrow",
        "boundId": "pR2cD",
        "connection": [0.5, 0]
      },
      "points": [[80, 60], [80, 120]],
      "texts": [],
      "opacity": 1,
      "children": []
    },
    {
      "id": "aR5jK",
      "type": "arrow-line",
      "shape": "elbow",
      "source": {
        "marker": "none",
        "boundId": "pR2cD",
        "connection": [0.5, 1]
      },
      "target": {
        "marker": "arrow",
        "boundId": "eN3eF",
        "connection": [0.5, 0]
      },
      "points": [[80, 180], [80, 240]],
      "texts": [],
      "opacity": 1,
      "children": []
    }
  ]
}
```

**Step 3: Copy to examples/**

```bash
mkdir -p examples
cp claude-plugin/skills/vync-editing/assets/mindmap.vync examples/
cp claude-plugin/skills/vync-editing/assets/flowchart.vync examples/
```

**Step 4: Validate examples**

Run: `node claude-plugin/skills/vync-editing/scripts/validate.js examples/mindmap.vync`
Expected: OK

Run: `node claude-plugin/skills/vync-editing/scripts/validate.js examples/flowchart.vync`
Expected: OK

**Step 5: Commit**

```bash
git add claude-plugin/skills/vync-editing/assets/mindmap.vync \
        claude-plugin/skills/vync-editing/assets/flowchart.vync \
        examples/
git commit -m "feat(plugin): add example .vync files

- mindmap.vync: 3-level mind map (root + 2 branches + 4 leaves)
- flowchart.vync: 3 shapes + 2 arrow connections"
```

---

## Task 6: Slash Commands

`/vync` (유틸리티 CLI wrapper)와 `/vync-create` (핵심 편집 진입점).

**Files:**
- Create: `claude-plugin/commands/vync.md`
- Create: `claude-plugin/commands/vync-create.md`

**Step 1: Create /vync command**

```markdown
---
description: Vync server and file management (init, open, stop, read)
allowed-tools: Bash(vync:*), Read
argument-hint: <init|open|stop|read> [file]
---

Run the Vync CLI command: `vync $ARGUMENTS`

## Subcommands

- `init <file>` — Create an empty .vync canvas file. Appends .vync extension if missing.
- `open <file>` — Start the Vync server (port 3100) and open browser. Server runs in foreground.
- `stop` — Stop the running Vync server.
- `read <file>` — Read a .vync file. Use the Read tool to read the file, then summarize the canvas contents in human-readable form: list all elements with their types, text content, and hierarchy.

For `open`, the server will keep running in this terminal. The .vync file will be watched for changes and auto-synced to the web UI.

For `read`, after reading the file with the Read tool, present a structured summary:
- Total element count
- Element tree (for mindmaps: indented hierarchy with topic text)
- For geometries: shape type + label + position
- For arrow-lines: source → target connections
```

**Step 2: Create /vync-create command**

```markdown
---
description: Create diagrams in .vync format (mindmap, flowchart, diagram)
allowed-tools: Read, Write, Edit, Bash(node:*)
argument-hint: <mindmap|flowchart|diagram> <description>
---

Create a .vync diagram based on the user's description.

**You MUST use the vync-editing skill.** Load it now and follow its editing workflow.

## Instructions

1. **Parse arguments**: `$ARGUMENTS` contains `<type> <description>`.
   - Type: `mindmap`, `flowchart`, or `diagram` (free-form).
   - Description: natural language description of what to create.

2. **Find or create target file**: Look for .vync files in the current directory. If none exist, ask the user for a filename, then run `vync init <filename>` first.

3. **Load the appropriate reference** from the vync-editing skill:
   - mindmap → `references/mindmap.md`
   - flowchart → `references/geometry.md` + `references/arrow-line.md`
   - diagram → `references/coordinates.md` + relevant type references

4. **Generate IDs**: Use `node ~/.claude/skills/vync-editing/scripts/generate-id.js <count>` to generate unique 5-char IDs for all elements.

5. **Create the elements** following the skill's templates and references exactly.

6. **Write the .vync file** using the Write tool. If the file already has elements, Read it first and merge your new elements into the existing elements array.

7. **Validation** will run automatically via the PostToolUse hook. If errors are reported, fix them.
```

**Step 3: Commit**

```bash
git add claude-plugin/commands/
git commit -m "feat(plugin): add /vync and /vync-create slash commands

- /vync: CLI wrapper for init, open, stop, read
- /vync-create: diagram creation with skill-guided workflow"
```

---

## Task 7: Hooks 설정 + install/uninstall 스크립트

PostToolUse 자동 검증과 SessionEnd 서버 정리 hook. install.sh로 ~/.claude/에 설치.

**Files:**
- Create: `claude-plugin/hooks.json`
- Create: `claude-plugin/install.sh`
- Create: `claude-plugin/uninstall.sh`

**Step 1: Create hooks.json**

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
            "command": "[ -f /tmp/vync-server.pid ] && kill $(cat /tmp/vync-server.pid) 2>/dev/null && rm -f /tmp/vync-server.pid; exit 0"
          }
        ]
      }
    ]
  }
}
```

**Step 2: Create install.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "[vync] Installing Claude Code plugin..."

# 1. Skills
mkdir -p "$CLAUDE_DIR/skills"
if [ -L "$CLAUDE_DIR/skills/vync-editing" ]; then
  rm "$CLAUDE_DIR/skills/vync-editing"
fi
ln -s "$SCRIPT_DIR/skills/vync-editing" "$CLAUDE_DIR/skills/vync-editing"
echo "  [ok] Skill: vync-editing"

# 2. Commands
mkdir -p "$CLAUDE_DIR/commands"
for cmd in vync.md vync-create.md; do
  target="$CLAUDE_DIR/commands/$cmd"
  [ -L "$target" ] && rm "$target"
  ln -s "$SCRIPT_DIR/commands/$cmd" "$target"
  echo "  [ok] Command: /${cmd%.md}"
done

# 3. Hooks — merge into settings.json
SETTINGS="$CLAUDE_DIR/settings.json"
if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi

# Use node to safely merge hooks (jq may not be available everywhere)
node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf-8'));
const hooks = JSON.parse(fs.readFileSync('$SCRIPT_DIR/hooks.json', 'utf-8'));

// Merge hooks: append vync hooks to existing arrays
if (!settings.hooks) settings.hooks = {};
for (const [event, entries] of Object.entries(hooks.hooks)) {
  if (!settings.hooks[event]) settings.hooks[event] = [];
  // Remove existing vync hooks first (idempotent)
  settings.hooks[event] = settings.hooks[event].filter(
    e => !JSON.stringify(e).includes('vync')
  );
  settings.hooks[event].push(...entries);
}

// Set VYNC_HOME env
if (!settings.env) settings.env = {};
settings.env.VYNC_HOME = '$PROJECT_ROOT';

fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2));
"
echo "  [ok] Hooks: PostToolUse, SessionEnd"
echo "  [ok] Env: VYNC_HOME=$PROJECT_ROOT"

# 4. npm link (global CLI)
cd "$PROJECT_ROOT"
npm link 2>/dev/null || echo "  [warn] npm link failed — run manually if needed"
echo "  [ok] CLI: vync (global)"

echo ""
echo "[vync] Installation complete!"
echo "  Restart Claude Code to activate."
```

**Step 3: Create uninstall.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

CLAUDE_DIR="$HOME/.claude"

echo "[vync] Uninstalling Claude Code plugin..."

# 1. Remove symlinks
rm -f "$CLAUDE_DIR/skills/vync-editing"
rm -f "$CLAUDE_DIR/commands/vync.md"
rm -f "$CLAUDE_DIR/commands/vync-create.md"
echo "  [ok] Removed skills and commands"

# 2. Remove hooks from settings.json
SETTINGS="$CLAUDE_DIR/settings.json"
if [ -f "$SETTINGS" ]; then
  node -e "
  const fs = require('fs');
  const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf-8'));
  if (settings.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      settings.hooks[event] = settings.hooks[event].filter(
        e => !JSON.stringify(e).includes('vync')
      );
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  if (settings.env) delete settings.env.VYNC_HOME;
  fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2));
  "
  echo "  [ok] Removed hooks and VYNC_HOME"
fi

# 3. npm unlink
npm unlink -g vync 2>/dev/null || true
echo "  [ok] Removed global CLI"

echo ""
echo "[vync] Uninstallation complete."
```

**Step 4: Make scripts executable**

```bash
chmod +x claude-plugin/install.sh claude-plugin/uninstall.sh
chmod +x claude-plugin/skills/vync-editing/scripts/validate.js
chmod +x claude-plugin/skills/vync-editing/scripts/generate-id.js
```

**Step 5: Test install (dry run)**

Run: `bash claude-plugin/install.sh`
Expected: All `[ok]` messages, no errors.

Verify: `ls -la ~/.claude/skills/vync-editing` → symlink to project
Verify: `ls -la ~/.claude/commands/vync.md` → symlink to project
Verify: `cat ~/.claude/settings.json | grep VYNC_HOME` → project path present
Verify: `cat ~/.claude/settings.json | grep PostToolUse` → hook present

**Step 6: Test uninstall**

Run: `bash claude-plugin/uninstall.sh`
Expected: All `[ok]` messages.
Verify: `ls ~/.claude/skills/vync-editing 2>/dev/null; echo $?` → 2 (not found)

**Step 7: Re-install for actual use**

Run: `bash claude-plugin/install.sh`

**Step 8: Commit**

```bash
git add claude-plugin/hooks.json claude-plugin/install.sh claude-plugin/uninstall.sh
git commit -m "feat(plugin): add hooks config and install/uninstall scripts

- PostToolUse hook: auto-validate .vync files on Edit/Write
- SessionEnd hook: cleanup server PID on session end
- install.sh: symlink skills/commands, merge hooks, set VYNC_HOME
- uninstall.sh: clean removal of all plugin components"
```

---

## Task 8: PLAN.md 업데이트 + 문서 동기화

Phase 4 완료 상태 반영.

**Files:**
- Modify: `docs/PLAN.md`

**Step 1: Update PLAN.md Phase 4 checklist**

Mark all Phase 4 tasks as complete. Update 태스크 설명 to reflect new structure:

```markdown
## Phase 4: CLI 도구 + Claude Code 통합 플러그인

**목표**: CLI로 파일 관리, Claude Code 플러그인으로 .vync 편집의 전체 라이프사이클 관리.
**의존**: Phase 3 완료

- [x] 4.1 `vync init <file>` — 빈 캔버스 .vync 파일 생성
- [x] 4.2 `vync open <file>` — 서버 시작 + 브라우저 열기 + PID 관리
- [x] 4.3 Claude Code Skill (vync-editing) — .vync 편집 가이드 + references
- [x] 4.4 .vync.schema.json + validate.js — JSON Schema + 자동 검증
- [x] 4.5 examples/*.vync — 마인드맵, 플로우차트 예시
- [x] 4.6 Slash Commands — /vync (CLI wrapper), /vync-create (편집 진입점)
- [x] 4.7 Hooks — PostToolUse 자동 검증 + SessionEnd 서버 정리
- [x] 4.8 install.sh / uninstall.sh — 전역 설치/제거
```

**Step 2: Update 현재 상태**

```markdown
**Phase**: 4 완료 → Phase 5 (E2E 검증) 진행 예정
```

**Step 3: Commit**

```bash
git add docs/PLAN.md
git commit -m "docs: update PLAN.md for Phase 4 completion"
```

---

## Summary

| Task | Description | Files | Estimated Steps |
|------|-------------|-------|----------------|
| 1 | CLI init command | 2 files | 5 steps |
| 2 | CLI open/stop + bin entry | 4 files | 7 steps |
| 3 | JSON Schema + scripts | 4 files | 7 steps |
| 4 | Skill SKILL.md + references | 5 files | 6 steps |
| 5 | Example .vync files | 4 files | 5 steps |
| 6 | Slash commands | 2 files | 3 steps |
| 7 | Hooks + install/uninstall | 3 files | 8 steps |
| 8 | PLAN.md update | 1 file | 3 steps |

**Total:** ~25 files, ~44 steps, 8 commits
