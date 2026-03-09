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

**Install**: `npm install` (postinstall → marketplace 등록 + 캐시 동기화)
**Update**: `git pull && npm install` (프로젝트 + 플러그인 동시 갱신)
**Dev sync**: plugin 파일(commands/, skills/, agents/, hooks/) 수정 후 `bash .claude-plugin/install.sh` → 새 세션에서 반영

Plugin layout (marketplace standard — root-level):
- `commands/vync.md` — `/vync init|open|close|stop` (CLI), `/vync create|read|update` (sub-agent)
- `skills/vync-editing/` — `.vync` file editing guide with validation
- `agents/vync-translator.md` — Prose ↔ .vync JSON translator (context window protection)
- `hooks/hooks.json` — PostToolUse (.vync auto-validation), SessionEnd (server cleanup)
- `.claude-plugin/` — plugin.json, marketplace.json, install.sh, uninstall.sh

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

**develop → main 머지 절차 (반드시 준수)**:
1. PR이 develop에 머지된 후, main을 업데이트할 때는 **반드시 `develop` 브랜치 자체를 main에 머지**한다
2. 절대로 피처 커밋을 main에 직접 cherry-pick하거나 독립적으로 머지하지 않는다
3. 구체적 명령:
   ```bash
   git checkout main && git pull
   git merge develop -m "merge: <설명> into main"
   git push origin main
   git checkout develop
   ```
4. 이 절차를 생략하면 main과 develop의 히스토리가 분기되어 "unmerged" 상태가 된다

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
                              ↕ Hub WS (no ?file=)
                           TabBar (multi-tab UI)
```

- Hub Server: single server (:3100) manages multiple files via FileRegistry (→ D-014)
- Echo prevention: SHA-256 hash comparison + isWriting flag
- Atomic writes: tmp file → rename
- Frontend: onChange → 300ms debounce → PUT /api/sync?file=<path>
- WebSocket: file-scoped broadcast (A.vync changes only reach A.vync clients)
- Hub WS: no `?file=` param → receives file registration/unregistration events for multi-tab UI
- Multi-tab UI: TabBar component, active tab only mounted, `+` dropdown for reopening closed tabs
