# Directory Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up Drawnix leftovers, move `src/shared/` to `packages/shared/`, rename `src/` to `tools/` for clarity in the nx monorepo structure.

**Architecture:** Three-phase approach — (1) delete Drawnix-only files, (2) extract `packages/shared/` with `@vync/shared` alias, (3) rename `src/` to `tools/` and update all 15 path references. Each phase is independently committable.

**Tech Stack:** TypeScript path aliases (tsconfig), tsx, esbuild `--alias`, nx monorepo

---

### Task 1: Delete Drawnix Leftovers

**Files:**
- Delete: `CFPAGE-DEPLOY.md`
- Delete: `CHANGELOG.md`
- Delete: `README_en.md`
- Delete: `SECURITY.md`
- Delete: `Dockerfile`
- Delete: `.dockerignore`
- Delete: `scripts/release-version.js`
- Delete: `scripts/publish.js`
- Delete: `.github/workflows/publish.yml`
- Modify: `.gitignore`
- Modify: `.github/workflows/ci.yml`

**Step 1: Delete files**

```bash
git rm CFPAGE-DEPLOY.md CHANGELOG.md README_en.md SECURITY.md Dockerfile .dockerignore
git rm -r scripts/
git rm .github/workflows/publish.yml
```

**Step 2: Add .DS_Store to .gitignore**

In `.gitignore`, after `Thumbs.db`, the `.DS_Store` entry already exists. Verify no .DS_Store files are tracked:

```bash
git ls-files '*.DS_Store'
```

If any are tracked, run `git rm --cached <file>`.

**Step 3: Update CI workflow**

Replace `.github/workflows/ci.yml` with Vync-appropriate version:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  actions: read
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci
      - uses: nrwl/nx-set-shas@v4

      - run: npx nx affected -t lint test build --verbose
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove Drawnix-specific files and update CI"
```

---

### Task 2: Create `packages/shared/` from `src/shared/`

**Files:**
- Create: `packages/shared/src/index.ts`
- Move: `src/shared/types.ts` → `packages/shared/src/types.ts`
- Move: `src/shared/hash.ts` → `packages/shared/src/hash.ts`
- Modify: `tsconfig.base.json` (update `@vync/shared` path)

**Step 1: Create directory and move files**

```bash
mkdir -p packages/shared/src
git mv src/shared/types.ts packages/shared/src/types.ts
git mv src/shared/hash.ts packages/shared/src/hash.ts
rmdir src/shared
```

**Step 2: Create barrel export**

Create `packages/shared/src/index.ts`:

```typescript
export type { VyncFile, VyncViewport, WsMessage } from './types.js';
export { sha256 } from './hash.js';
```

**Step 3: Update tsconfig.base.json**

Change line 21:

```
"@vync/shared": ["src/shared/types.ts"]
```

→

```
"@vync/shared": ["packages/shared/src/index.ts"]
```

**Step 4: Create root tsconfig.json**

tsx needs `tsconfig.json` (not `tsconfig.base.json`) to resolve path aliases at runtime. Create `tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json"
}
```

Note: `apps/web/tsconfig.json` already extends `../../tsconfig.base.json`, so this doesn't conflict.

**Step 5: Update imports in src/server/ and src/cli/**

These files currently use relative `../shared/` imports. Change to `@vync/shared` alias:

`src/server/server.ts` line 7:
```
- import type { VyncFile } from '../shared/types.js';
+ import type { VyncFile } from '@vync/shared';
```

`src/server/sync-service.ts` lines 3-4:
```
- import { sha256 } from '../shared/hash.js';
- import type { VyncFile } from '../shared/types.js';
+ import { sha256 } from '@vync/shared';
+ import type { VyncFile } from '@vync/shared';
```

(Combine into one import: `import { sha256, type VyncFile } from '@vync/shared';`)

`src/server/ws-handler.ts` line 3:
```
- import type { WsMessage } from '../shared/types.js';
+ import type { WsMessage } from '@vync/shared';
```

`src/cli/init.ts` line 3:
```
- import type { VyncFile } from '../shared/types.js';
+ import type { VyncFile } from '@vync/shared';
```

`apps/web/src/app/app.tsx` line 4: already uses `@vync/shared` — no change needed.

**Step 6: Verify**

```bash
npx tsx src/server/server.ts --help 2>&1 || true  # Should parse without import errors
```

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract packages/shared from src/shared"
```

---

### Task 3: Rename `src/` → `tools/`

**Files:**
- Move: `src/server/` → `tools/server/`
- Move: `src/cli/` → `tools/cli/`
- Move: `src/electron/` → `tools/electron/`
- Modify: `bin/vync.js` (line 7)
- Modify: `package.json` (scripts lines 13-15)
- Modify: `tools/cli/open.ts` (line 146)
- Modify: `tools/server/server.ts` (line 181)

**Step 1: Move directories**

```bash
mkdir tools
git mv src/server tools/server
git mv src/cli tools/cli
git mv src/electron tools/electron
rmdir src
```

**Step 2: Update `bin/vync.js`**

Line 7:
```
- const main = path.join(projectRoot, 'src', 'cli', 'main.ts');
+ const main = path.join(projectRoot, 'tools', 'cli', 'main.ts');
```

**Step 3: Update `package.json` scripts**

Line 13:
```
- "dev:server": "tsx src/server/server.ts",
+ "dev:server": "tsx tools/server/server.ts",
```

Line 14:
```
- "dev:desktop": "npx esbuild src/electron/main.ts --bundle --platform=node --outdir=dist/electron --external:electron --packages=external --sourcemap && electron dist/electron/main.js",
+ "dev:desktop": "npx esbuild tools/electron/main.ts --bundle --platform=node --outdir=dist/electron --external:electron --packages=external --alias:@vync/shared=./packages/shared/src/index.ts --sourcemap && electron dist/electron/main.js",
```

Line 15:
```
- "build:desktop": "nx build web && npx esbuild src/electron/main.ts src/electron/preload.ts --bundle --platform=node --outdir=dist/electron --external:electron --packages=external",
+ "build:desktop": "nx build web && npx esbuild tools/electron/main.ts tools/electron/preload.ts --bundle --platform=node --outdir=dist/electron --external:electron --packages=external --alias:@vync/shared=./packages/shared/src/index.ts",
```

Note: `--alias:@vync/shared=...` is needed because esbuild does not read tsconfig paths. It resolves `@vync/shared` imports in server code that gets bundled via dynamic import from electron/main.ts.

**Step 4: Update hardcoded runtime path in `tools/cli/open.ts`**

Line 146:
```
- const serverScript = path.join(projectRoot, 'src', 'server', 'server.ts');
+ const serverScript = path.join(projectRoot, 'tools', 'server', 'server.ts');
```

**Step 5: Update usage message in `tools/server/server.ts`**

Line 181:
```
- console.error('Usage: npx tsx src/server/server.ts <file.vync>');
+ console.error('Usage: npx tsx tools/server/server.ts <file.vync>');
```

**Step 6: Verify relative imports still work**

These dynamic relative imports are UNCHANGED because the relative positions within tools/ are preserved:
- `tools/cli/open.ts:43` → `import('../server/server.js')` ✓ (../server/ relative to tools/cli/)
- `tools/electron/main.ts:76` → `import('../server/server.js')` ✓ (../server/ relative to tools/electron/)
- `tools/electron/main.ts:107` → `path.join(__dirname, 'preload.js')` ✓ (same directory)
- `tools/cli/main.ts:1-2` → `./init.js`, `./open.js` ✓ (same directory)

**Step 7: Verify test path**

The test at `tools/cli/__tests__/init.test.ts` imports `../init.js` — relative, still works.

**Step 8: Verify**

```bash
npx tsx tools/server/server.ts --help 2>&1 || true  # Should not error on imports
node bin/vync.js --help                              # Should print usage
```

**Step 9: Commit**

```bash
git add -A
git commit -m "refactor: rename src/ to tools/ for monorepo clarity"
```

---

### Task 4: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/ARCHITECTURE.md`

**Step 1: Update README.md architecture section**

Replace the architecture tree to reflect `tools/` and `packages/shared/`:

```
Vync/
├── apps/web/               # Vite SPA (React 19 + Plait)
├── packages/
│   ├── drawnix/             # Whiteboard UI library
│   ├── react-board/         # Plait ↔ React bridge
│   ├── react-text/          # Text rendering (Slate)
│   └── shared/              # Shared types and utilities (@vync/shared)
├── tools/
│   ├── server/              # Express + Vite middleware + WebSocket
│   ├── cli/                 # CLI commands (init, open, stop)
│   └── electron/            # Electron main + preload
├── .claude-plugin/          # Claude Code integration (marketplace plugin)
│   ├── plugin.json          # Plugin metadata
│   ├── skills/vync-editing/ # AI editing skill
│   ├── commands/            # Slash commands
│   └── hooks.json           # PostToolUse + SessionEnd hooks
└── bin/vync.js              # CLI entry point
```

**Step 2: Update CLAUDE.md**

Update project structure section: replace `src/server/`, `src/cli/`, `src/electron/`, `src/shared/` with `tools/server/`, `tools/cli/`, `tools/electron/`, `packages/shared/`. Update key commands and path alias.

**Step 3: Update docs/ARCHITECTURE.md**

Find the directory tree section (around line 270-318) and update all `src/` references to `tools/` and `packages/shared/`.

**Step 4: Commit**

```bash
git add README.md CLAUDE.md docs/ARCHITECTURE.md
git commit -m "docs: update paths for tools/ and packages/shared/ restructure"
```

---

### Task 5: Final Verification

**Step 1: Dev server smoke test**

```bash
npx tsx tools/server/server.ts /tmp/test-verify.vync &
SERVER_PID=$!
sleep 2
curl -s http://localhost:3100/api/sync | head -c 100
kill $SERVER_PID
```

Expected: JSON response with version, viewport, elements.

**Step 2: CLI smoke test**

```bash
node bin/vync.js init /tmp/verify-cli.vync
cat /tmp/verify-cli.vync
```

Expected: Valid .vync JSON with version 1.

**Step 3: Type check (optional)**

```bash
npx nx build web --skip-nx-cache 2>&1 | tail -5
```

Expected: Build succeeds.

**Step 4: Clean up test files**

```bash
rm -f /tmp/test-verify.vync /tmp/verify-cli.vync
```
