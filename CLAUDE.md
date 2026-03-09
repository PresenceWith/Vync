# Vync — Claude Code Project Guide

## What is Vync?

A local-first visual planning tool. `.vync` JSON files are the source of truth, synced in real-time between web UI, desktop app, and external editors (Claude Code, vim, etc.).

## Project Structure

- **Monorepo**: npm + nx (`apps/web`, `packages/board`, `packages/react-board`, `packages/react-text`, `packages/shared`)
- **Server**: `tools/server/server.ts` — Express + Vite middleware mode + WebSocket (:3100)
- **CLI**: `bin/vync.js` → `tools/cli/main.ts` (init, open, close, stop)
- **Electron**: `tools/electron/main.ts` (thin shell, in-process server)
- **Shared types**: `packages/shared/src/types.ts` — `VyncFile<T>`, `WsMessage<T>`
- **Path alias**: `@vync/shared` → `packages/shared/src/index.ts`

## Key Commands

```bash
npm run dev:server       # Dev server on :3100
npm run dev:desktop      # Electron dev mode
npm run build:web        # Build web app
npm run package:desktop  # Package macOS DMG
```

## Claude Code Plugin

The plugin is in `.claude-plugin/`. Install with `bash .claude-plugin/install.sh`.

- `/vync init|open|close|stop` — CLI operations (direct execution)
- `/vync create|read|update` — AI diagram operations (delegated to `vync-translator` sub-agent)
- `vync-editing` skill — `.vync` file editing guide with validation
- `vync-translator` agent — Prose ↔ .vync JSON translator (context window protection)

## Editing .vync Files

When editing `.vync` files, **always** use the `vync-editing` skill. Key rules:
- IDs: 5-char random strings via `idCreator(5)`
- Text nodes: `children` arrays must never be empty — minimum `[{ "text": "" }]`
- Mindmap children: do NOT add `points` — layout engine handles positioning
- PostToolUse hook auto-validates on Write/Edit

## Architecture Decisions

See `docs/DECISIONS.md` for the full registry (D-001 to D-014). Key ones:
- **D-004**: Custom Node Server (not Next.js)
- **D-008**: Last Write Wins (conflict resolution)
- **D-009**: SHA-256 content hash + isWriting flag (echo prevention)
- **D-011**: npm + nx monorepo (not pnpm)
- **D-012**: Electron thin shell
- **D-013**: Sub-agent translator layer (context window protection)
- **D-014**: Hub Server (multi-file, FileRegistry, file-scoped WS)

## Documentation

- `docs/PLAN.md` — Implementation plan (phases, criteria)
- `docs/ARCHITECTURE.md` — System architecture
- `docs/DECISIONS.md` — Design decision registry
- `docs/FUTURE.md` — Future roadmap (MCP, AI Agent, pipelines)
- `docs/WRAP.md` — Documentation sync rules

## Git Workflow

**Branch model**: `main` ← `develop` ← `feat/*`

```
main        ●────────────────●────── (stable, always deployable)
             ↑                ↑
develop     ●──●──●──────●──●──── (integration branch)
                  ↑       ↑
feat/xyz        ●──●    ●──●     (short-lived feature branches)
```

**Rules (mandatory)**:
1. **Never commit directly to `main` or `develop`** — always branch from `develop`
2. **Branch naming**: `feat/<name>`, `fix/<name>`, `docs/<name>`, `refactor/<name>`
3. **PR flow**: `feat/*` → `develop` (squash merge) → `main` (merge commit)
4. **After merge**: delete the feature branch (local + remote)
5. **Before starting work**: `git checkout develop && git pull && git checkout -b feat/<name>`
6. **Commit messages**: `type(scope): description` (feat, fix, docs, refactor, test, chore)
7. **Push frequency**: push feature branch before creating PR; push main+develop together after merge

**PR checklist**:
- [ ] All tests pass (`npm test`)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] Feature branch is up-to-date with develop (`git rebase develop` or merge)
- [ ] Commit messages follow convention

**When NOT to use a PR** (direct develop commit OK):
- Single-file doc-only changes (typo fixes, comment updates)
- .gitignore or config tweaks with no code impact

## Sync Mechanism

```
.vync file ←→ chokidar ←→ Hub Server ←→ WebSocket (?file=) ←→ Browser (?file=)
```

- Hub Server: single server (:3100) manages multiple files via FileRegistry (→ D-014)
- Echo prevention: SHA-256 hash comparison + isWriting flag
- Atomic writes: tmp file → rename
- Frontend: onChange → 300ms debounce → PUT /api/sync?file=<path>
- WebSocket: file-scoped broadcast (A.vync changes only reach A.vync clients)
