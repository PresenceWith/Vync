# Design: Electron Desktop App Integration

**Date:** 2026-03-08
**Status:** Approved

## Goal

Vync를 Electron으로 감싸서 네이티브 데스크톱 앱처럼 동작하게 한다.
- `.vync` 파일 더블클릭 → 앱 열림 (서버 자동 시작)
- 창 닫기 → 서버 자동 종료
- CLI (`vync init/open/stop`) 그대로 유지, `vync open`은 Electron 앱을 실행

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| E-1 | Electron + Express in-process (단일 프로세스) | 서버가 경량. 프로세스 분리는 과잉. |
| E-2 | Dev: Vite middleware / Prod: express.static | 기존 아키텍처 최소 변경. 웹 독립 실행 유지. |
| E-3 | `src/electron/` (not `apps/desktop/`) | src/cli, src/server와 동일 패턴. Nx 프로젝트 불필요. |
| E-4 | esbuild로 main.ts 빌드 | ~50ms, 설정 파일 없음, Vite 내부 포함. |
| E-5 | electron-builder로 macOS DMG 패키징 | 파일 연결 내장, electron-forge 대비 단순. |
| E-6 | macOS: 창 닫기 = 앱 종료 | 파일 편집 세션 도구. 창 = 세션. |
| E-7 | macOS만 타겟 (현재) | 개발 환경 기준. 최소 범위. |

## Architecture

```
[User double-clicks .vync]
  → macOS launches Vync.app
  → Electron main process
    → startServer(filePath, { mode, port })
      → Express + WS + chokidar (in-process)
    → BrowserWindow → http://localhost:<port>
  → User closes window
    → shutdown() → app.quit()

[User runs `vync open plan.vync`]
  → CLI spawns Electron app as detached process
  → Same flow as above
```

## Project Structure

```
src/electron/
  main.ts              # Electron main process
  preload.ts           # Minimal preload (placeholder)

electron-builder.yml   # macOS packaging config
build/                 # App icons, resources
```

## Key Changes to Existing Code

### 1. `src/server/server.ts` — API Refactoring

```typescript
// BEFORE
export async function startServer(resolvedPath: string, options: { openBrowser?: boolean })

// AFTER
export async function startServer(resolvedPath: string, options: {
  port?: number;                         // default 3100
  mode?: 'development' | 'production';
  staticDir?: string;                    // prod: path to dist/apps/web
  openBrowser?: boolean;
}): Promise<{ shutdown: () => Promise<void>; server: Server; url: string }>
```

Critical fixes:
- Remove `process.exit()` → throw errors
- Remove SIGINT/SIGTERM handlers → caller wires up
- Conditional Vite import (dynamic, dev only)
- `express.static` branch for production
- `server.close()` with timeout + WS client termination
- Error handler on `server.listen` for EADDRINUSE

### 2. `src/cli/open.ts` — Electron Spawn

`vync open` spawns Electron app (detached) instead of `tsx server.ts`.
Fallback to current tsx spawn if Electron not available.

### 3. `apps/web/index.html` — Analytics Gate

Umami script conditional on non-Electron environment.

## Electron Main Process (`src/electron/main.ts`)

Key behaviors:
- `app.requestSingleInstanceLock()` — 단일 인스턴스
- `app.on('open-file')` — 파일 연결 (ready 전 버퍼링)
- `app.on('window-all-closed')` → `shutdown()` → `app.quit()`
- Port conflict detection: 기존 서버 감지 시 재사용
- No file argument → `dialog.showOpenDialog()`

## Build & Scripts

```json
{
  "dev:desktop": "esbuild src/electron/main.ts --bundle --platform=node --outdir=dist/electron --external:electron && electron dist/electron/main.js",
  "build:desktop": "nx build web && esbuild src/electron/main.ts src/electron/preload.ts --bundle --platform=node --outdir=dist/electron --external:electron",
  "package:desktop": "npm run build:desktop && electron-builder"
}
```

## Pre-requisites (server.ts refactoring)

Before any Electron code, these must be fixed in `server.ts`:

1. **CRITICAL**: `process.exit()` → throw
2. **CRITICAL**: SIGINT/SIGTERM handlers → remove from startServer
3. **HIGH**: PORT configurable via options
4. **HIGH**: Vite import conditional (dynamic)
5. **HIGH**: shutdown() properly awaits server.close() with timeout
6. **HIGH**: WS clients terminated before server close

## Dependencies to Add

```
devDependencies:
  electron: latest
  electron-builder: latest
```

esbuild is already available (Vite internal).

## Out of Scope

- Windows/Linux support
- Multi-file simultaneous editing
- Code signing / notarization (future)
- Auto-update mechanism
