# Vync — Claude Code Project Guide

## What is Vync?

A local-first visual planning tool. `.vync` JSON files are the source of truth, synced in real-time between web UI, desktop app, and external editors (Claude Code, vim, etc.).

## Project Structure

- **Monorepo**: npm + nx (`apps/web`, `packages/drawnix`, `packages/react-board`, `packages/react-text`)
- **Server**: `src/server/server.ts` — Express + Vite middleware mode + WebSocket (:3100)
- **CLI**: `bin/vync.js` → `src/cli/main.ts` (init, open, stop)
- **Electron**: `src/electron/main.ts` (thin shell, in-process server)
- **Shared types**: `src/shared/types.ts` — `VyncFile<T>`, `WsMessage<T>`
- **Path alias**: `@vync/shared` → `src/shared/types.ts`

## Key Commands

```bash
npm run dev:server       # Dev server on :3100
npm run dev:desktop      # Electron dev mode
npm run build:web        # Build web app
npm run package:desktop  # Package macOS DMG
```

## Claude Code Plugin

The plugin is in `.claude-plugin/`. Install with `/plugin install vync` or `bash .claude-plugin/install.sh`.

- `/vync init|open|stop|read` — CLI operations
- `/vync-create mindmap|flowchart|diagram` — AI diagram creation
- `vync-editing` skill — `.vync` file editing guide with validation

## Editing .vync Files

When editing `.vync` files, **always** use the `vync-editing` skill. Key rules:
- IDs: 5-char random strings via `idCreator(5)`
- Text nodes: `children` arrays must never be empty — minimum `[{ "text": "" }]`
- Mindmap children: do NOT add `points` — layout engine handles positioning
- PostToolUse hook auto-validates on Write/Edit

## Architecture Decisions

See `docs/DECISIONS.md` for the full registry (D-001 to D-012). Key ones:
- **D-004**: Custom Node Server (not Next.js)
- **D-008**: Last Write Wins (conflict resolution)
- **D-009**: SHA-256 content hash + isWriting flag (echo prevention)
- **D-011**: npm + nx monorepo (not pnpm)
- **D-012**: Electron thin shell

## Documentation

- `docs/PLAN.md` — Implementation plan (phases, criteria)
- `docs/ARCHITECTURE.md` — System architecture
- `docs/DECISIONS.md` — Design decision registry
- `docs/FUTURE.md` — Future roadmap (MCP, AI Agent, pipelines)
- `docs/WRAP.md` — Documentation sync rules

## Sync Mechanism

```
.vync file ←→ chokidar ←→ Server ←→ WebSocket ←→ Browser
```

- Echo prevention: SHA-256 hash comparison + isWriting flag
- Atomic writes: tmp file → rename
- Frontend: onChange → 300ms debounce → PUT /api/sync
- WebSocket: full file broadcast on change
