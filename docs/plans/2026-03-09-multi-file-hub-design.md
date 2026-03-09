# Design: Multi-File Hub Server

**Date:** 2026-03-09
**Status:** Approved
**Decision:** D-014 (Multi-file hub server)

## Goal

여러 `.vync` 파일을 동시에 열고 편집할 수 있도록 서버를 단일 파일 → 허브 아키텍처로 전환한다.

- `vync open A.vync` + `vync open B.vync` → 두 파일 모두 동시 접근 가능
- 각 브라우저 탭/Electron 윈도우에서 서로 다른 파일을 볼 수 있음
- 서버는 하나(:3100), 파일은 여러 개

## Implementation Stages

| Stage | Scope | Deliverable |
|-------|-------|-------------|
| **1단계** | 허브 서버 + 멀티 윈도우 | 서버 리팩토링, CLI 변경, 프론트엔드 `?file=` 지원. 브라우저 탭 여러 개로 다른 파일 동시 접근 |
| **2단계** | 멀티 탭 UI | 프론트엔드 탭 바, Electron 멀티 윈도우. **1단계 완료 후 계획 문서 동기화 및 업데이트 필수** |

> **중요:** 2단계 계획은 1단계 결과에 따라 반드시 재검토한다. 1단계에서 API 계약, WsMessage 프로토콜, 컴포넌트 구조가 확정되면 이를 기반으로 2단계 세부 계획을 업데이트한다.

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| M-1 | 허브 서버 (단일 서버, 다중 파일) | 멀티 인스턴스 대비 리소스 효율적. Vite 1개로 충분. 탭+윈도우 모두 가능한 유일한 선택. |
| M-2 | 명시적 파일 등록 (`vync open`) | 파일이 여러 디렉토리에 분산됨. 디렉토리 감시 불가. CLI 호출 패턴과 완벽 일치. |
| M-3 | 절대경로를 파일 식별자로 사용 | 자가복구 아님(제거됨). 프론트엔드 POST 재등록으로 대체. CLI가 서버 없이 URL 구성 가능. 디버깅 가독성. |
| M-4 | 자가복구(auto-register on GET) 제거 | GET은 부작용 없어야 함(REST). LFI 보안 취약점. 프론트엔드 명시적 POST로 대체. |
| M-5 | 하위 호환 폐기 (`?file=` 필수) | 암묵적 단일 파일 폴백은 상태 전이 시 간헐적 장애 유발. 모든 클라이언트 동시 업데이트. |
| M-6 | PID 파일 JSON 포맷 전환 | port 포함 필요. 버전 마커로 구/신 포맷 구분. 자기 서술적. |
| M-7 | 뷰포트 WebSocket 브로드캐스트 제외 | 두 탭이 같은 파일 열면 zoom/pan 충돌. 뷰포트는 초기 로드에만 적용. |
| M-8 | 보안: validateFilePath + Host 검증 | 경로 기반 접근은 LFI 벡터. allowlist + `.vync` 확장자 + realpath + Host 헤더 검증. |

## Architecture

### Overview

```
vync open A.vync  ─→  CLI  ─→  POST /api/files  ─→  Hub Server :3100
vync open B.vync  ─→  CLI  ─→  POST /api/files  ─→       ↓
                                                    ┌──────────────┐
                                                    │  FileRegistry │
                                                    │  ┌─ A.vync ──┐│
                                                    │  │ SyncService││
                                                    │  │ FileWatcher││
                                                    │  │ WS Clients ││
                                                    │  └────────────┘│
                                                    │  ┌─ B.vync ──┐│
                                                    │  │ SyncService││
                                                    │  │ FileWatcher││
                                                    │  │ WS Clients ││
                                                    │  └────────────┘│
                                                    └──────────────┘
                                                         ↓
Browser Tab /?file=A  ←─ WS(file=A) ──────────────────→ A.vync
Browser Tab /?file=B  ←─ WS(file=B) ──────────────────→ B.vync
```

### FileRegistry (핵심 추상화)

```typescript
class FileRegistry extends EventEmitter {
  private files: Map<string, {
    sync: SyncService;
    watcher: FSWatcher;
    clients: Set<WebSocket>;
  }>;
  private pendingUnregister: Set<string>;  // race condition 방지

  static readonly MAX_FILES = 50;  // VYNC_MAX_FILES env로 오버라이드

  async register(filePath: string): Promise<void>
  // - validateFilePath() 통과 필수
  // - 이미 등록: 무시 (멱등)
  // - Map에 동기적 슬롯 확보 → 비동기 초기화 (실패 시 롤백)
  // - emit('registered', filePath)

  async unregister(filePath: string): Promise<void>
  // - pendingUnregister에 추가 (재등록 차단)
  // - sync.drain() 대기 (writeQueue 완료)
  // - watcher 닫기
  // - clients에 file-closed 메시지 전송 + 소켓 닫기
  // - Map에서 삭제
  // - pendingUnregister에서 제거
  // - emit('unregistered', filePath)
  // - files.size === 0 이면 emit('empty')

  getSync(filePath: string): SyncService | undefined
  listFiles(): string[]
}
```

### Security Layer

```typescript
// tools/server/security.ts

const ALLOWED_DIRS: Set<string> = new Set();

function addAllowedDir(dir: string): void {
  // realpath로 심링크 해석 후 등록
}

async function validateFilePath(rawPath: string): Promise<string> {
  const resolved = path.resolve(rawPath);

  // 1. .vync 확장자 필수
  if (!resolved.endsWith('.vync'))
    throw new SecurityError('Only .vync files permitted');

  // 2. realpath로 심링크 해석
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch {
    // 파일 미존재 (create 케이스) — 부모 디렉토리만 해석
    const parentReal = await fs.realpath(path.dirname(resolved));
    real = path.join(parentReal, path.basename(resolved));
  }

  // 3. allowlist 확인
  const allowed = [...ALLOWED_DIRS].some(
    dir => real.startsWith(dir + path.sep) || real === dir
  );
  if (!allowed)
    throw new SecurityError(`Path outside allowed directories: ${real}`);

  return real;  // 정규화된 경로 반환
}

// Host 헤더 검증 미들웨어 (DNS rebinding 방어)
function hostGuard(port: number): RequestHandler {
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
  return (req, res, next) => {
    if (!req.headers.host || !allowed.includes(req.headers.host)) {
      res.status(421).json({ error: 'Invalid Host header' });
      return;
    }
    next();
  };
}
```

### API Design

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `GET` | `/api/health` | 서버 상태 + 버전 | — |
| `POST` | `/api/files` | 파일 등록 (body: `{filePath}`) | validateFilePath |
| `DELETE` | `/api/files?file=<path>` | 파일 해제 | validateFilePath |
| `GET` | `/api/files` | 등록 파일 목록 | — |
| `GET` | `/api/sync?file=<path>` | 파일 읽기 | validateFilePath |
| `PUT` | `/api/sync?file=<path>` | 파일 쓰기 | validateFilePath |

**`GET /api/health` 응답:**
```json
{ "version": 2, "mode": "hub", "fileCount": 3 }
```

**`POST /api/files` 멱등성:**
- 신규 파일: `201 Created` + `{ filePath, status: "registered" }`
- 이미 등록: `200 OK` + `{ filePath, status: "already_registered" }`
- 파일 미존재: `404`
- 잘못된 JSON: `422`
- 상한 초과: `429`

**`?file=` 필수 (M-5):**
- `GET /api/sync` (`?file=` 없음) → `400` + `{ error: "file_required", files: [...] }`
- 모든 클라이언트를 동시 업데이트하므로 하위 호환 불필요

### WebSocket Protocol

**연결:**
```
ws://localhost:3100/ws?file=<encoded_absolute_path>
```

**서버 측:**
- upgrade 시 `?file=` 파싱 → `validateFilePath()` → FileRegistry에서 조회
- 미등록 파일: `{ type: 'error', code: 'FILE_NOT_FOUND' }` 전송 후 close(4404)
- 등록 파일: `clients` Set에 추가
- **Origin 검사 강화**: `!origin || !allowedOrigins.includes(origin)` → reject

**메시지 포맷 (변경):**
```typescript
interface WsMessage<T = unknown> {
  type: 'file-changed' | 'connected' | 'file-closed' | 'file-deleted' | 'error';
  filePath?: string;       // 신규: 어떤 파일의 이벤트인지
  data?: VyncFile<T>;
  code?: string;           // error 시
}
```

**브로드캐스트:** 파일별 구독 모델. 같은 파일의 clients에게만 전송.

**뷰포트 제외 (M-7):**
- `file-changed` 브로드캐스트 시 `data.viewport` 제외
- 뷰포트는 `GET /api/sync?file=` 초기 로드에서만 수신
- 각 탭의 뷰포트는 독립적

### startServer() 변경

```typescript
// 현재
export async function startServer(
  resolvedPath: string,
  options?: { port?; mode?; staticDir?; openBrowser? }
)

// 이후
export async function startServer(options?: {
  initialFile?: string;   // 첫 파일 (없으면 빈 허브)
  port?: number;          // default 3100
  mode?: 'development' | 'production';
  staticDir?: string;
})
// → 파일 없이 시작 가능 (데몬 먼저 시작, API로 파일 등록)
```

**서버 시작 순서:**
1. Express + Vite 미들웨어 초기화
2. FileRegistry 생성
3. hostGuard 미들웨어 등록
4. API 라우트 등록
5. WebSocket 핸들러 등록
6. `server.listen(port)` → 건강 검사 가능
7. (옵션) `initialFile` 있으면 `registry.register(initialFile)`

## CLI Changes

### `vync open` — 2-state

```
server-down:
  1. startServer (파일 없이, 또는 initialFile로)
  2. poll GET /api/health until 200
  3. POST /api/files { filePath: resolved }
  4. open browser: localhost:PORT/?file=<encoded_path>

server-up:
  1. POST /api/files { filePath: resolved }
  2. open browser: localhost:PORT/?file=<encoded_path>
```

**서버 버전 감지:**
- `GET /api/health` → 200 + `version: 2` → 허브 모드
- `GET /api/health` → 404 → 구 서버 → `vyncStop()` 후 새 서버 시작

### `vync close <file>` — 신규

```
1. resolveVyncPath(file)
2. DELETE /api/files?file=<resolved>
3. 서버가 등록 0개면 자동 종료
   → "[vync] Last file closed. Server stopped."
4. --keep-server 옵션: 파일만 해제, 서버 유지
```

### `vync stop` — 기존 유지

```
[vync] Warning: 3 files currently registered
[vync] Server stopped (PID 12345)
```

### PID 파일 — JSON (M-6)

```json
{ "version": 2, "pid": 12345, "mode": "daemon", "port": 3100 }
```

**마이그레이션:** `readServerInfo()`가 JSON 파싱 실패 시 구 3줄 포맷으로 폴백:
```typescript
function readServerInfo(): ServerInfo | null {
  const raw = fs.readFileSync(PID_PATH, 'utf-8');
  try {
    return JSON.parse(raw);  // 신 포맷
  } catch {
    const lines = raw.trim().split('\n');
    if (lines.length >= 2) {
      return { version: 1, pid: Number(lines[0]), mode: lines[1], port: 3100 };
    }
    return null;  // stale
  }
}
```

## Frontend Changes (Stage 1)

### FileBoard 컴포넌트 분리 (Stage 2 대비)

```
App
  └─ FileBoard (filePath prop)
       ├─ value state
       ├─ WebSocket connection (file-scoped)
       ├─ API calls (file-scoped)
       ├─ localforage (file-scoped key)
       └─ Drawnix Wrapper
```

Stage 1에서는 `App`이 `FileBoard`를 하나만 렌더링. Stage 2에서 탭 바 + 여러 `FileBoard` 인스턴스.

### URL 파라미터

```typescript
const filePath = new URLSearchParams(window.location.search).get('file');
if (!filePath) {
  // 에러 UI: "No file specified. Use `vync open <file>` to start."
  return;
}
```

### API 호출

```typescript
// 초기 로드
const res = await fetch(`/api/sync?file=${encodeURIComponent(filePath)}`);
if (res.status === 404) {
  // 서버 재시작 후 → 프론트엔드가 재등록
  await fetch('/api/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  // 재시도
}
```

### WebSocket

```typescript
const ws = new WebSocket(
  `${protocol}//${host}/ws?file=${encodeURIComponent(filePath)}`
);
```

### LocalStorage 마이그레이션

```typescript
const storageKey = `vync_board_${filePath}`;

// 일회성 마이그레이션
const legacy = await localforage.getItem('main_board_content');
if (legacy && !await localforage.getItem(storageKey)) {
  await localforage.setItem(storageKey, legacy);
  // 롤백 대비: 구 키 삭제하지 않음
}
```

### 뷰포트 처리

- 초기 로드: `GET /api/sync?file=` 응답의 viewport 적용
- WebSocket `file-changed`: **viewport 무시**, elements만 업데이트
- 각 탭의 viewport는 독립적 (state로 유지)

## Electron Changes (Stage 1)

```typescript
async function openFile(filePath: string) {
  if (serverHandle) {
    // 서버 실행 중 → 파일 등록만 (재시작 아님)
    await fetch(`${serverHandle.url}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
  } else {
    // 서버 시작
    const mod = await import('../server/server.js');
    serverHandle = await mod.startServer({
      initialFile: filePath,
      port: 3100,
      mode: isDev ? 'development' : 'production',
    });
  }

  const url = `${serverHandle.url}/?file=${encodeURIComponent(filePath)}`;
  if (mainWindow) {
    // beforeunload로 pending debounce flush 후 URL 변경
    mainWindow.loadURL(url);
  } else {
    createWindow(url);
  }
}
```

Stage 1: 단일 윈도우, URL 변경으로 파일 전환.
Stage 2: 멀티 윈도우 또는 탭 UI.

## Plugin Changes

### Sub-agent (vync-translator)

**변경 없음.** `node "$VYNC_HOME/bin/vync.js" open <absolute_path>` 호출은 CLI 내부에서 파일 등록으로 전환됨.

### /vync 커맨드

`close` 서브커맨드 문서 추가:
```
- close [file] — 파일 서버 등록 해제 (서버는 유지)
```

### Hooks

**SessionEnd 변경 (M-7 연관):**
```bash
# 기존: kill server
# 수정: 등록 파일 전체 해제 (서버가 파일 0개면 자동 종료)
curl -s -X DELETE "http://localhost:3100/api/files?all=true" 2>/dev/null || true
[ -f "$HOME/.vync/server.pid" ] && { pid=$(jq -r '.pid' "$HOME/.vync/server.pid" 2>/dev/null || head -1 "$HOME/.vync/server.pid"); kill "$pid" 2>/dev/null; rm -f "$HOME/.vync/server.pid"; }; exit 0
```

## Race Condition Handling

| Race | Mechanism | Resolution |
|------|-----------|------------|
| 동시 register (같은 파일) | Map에 동기적 슬롯 확보 | 두 번째 호출은 즉시 return (멱등) |
| 동시 register (다른 파일) | 독립적 — 충돌 없음 | 병렬 처리 |
| 동시 `vync open` (서버 미시작) | 둘 다 서버 시작 시도 | EADDRINUSE → PID 재확인 → POST /api/files |
| unregister 중 write 진행 | `sync.drain()` 대기 | writeQueue 완료 후 watcher 닫기 |
| unregister 중 register (같은 파일) | `pendingUnregister` Set | unregister 완료까지 재등록 차단 |

## File Lifecycle Events

| Event | Source | Server Action | Client Notification |
|-------|--------|---------------|---------------------|
| 파일 등록 | `POST /api/files` | SyncService + Watcher 생성 | — |
| 파일 해제 | `DELETE /api/files` | drain → watcher 닫기 → cleanup | `{ type: 'file-closed' }` |
| 파일 삭제 (디스크) | chokidar `unlink` | 클라이언트 알림, SyncService 유지 (PUT으로 재생성 가능) | `{ type: 'file-deleted' }` |
| 파일 재등장 | chokidar `add` | 재로드 + 브로드캐스트 | `{ type: 'file-changed' }` |
| 유휴 30분 (WS 0개) | 타이머 | 자동 unregister + watcher 정리 | — |
| 서버 종료 | SIGTERM/`vync stop` | 모든 SyncService drain → watcher 닫기 → WS 닫기 | 연결 끊김 |

## Backward Compatibility

| 항목 | 전략 |
|------|------|
| PID 파일 (구 3줄) | `readServerInfo()` JSON 우선 → 실패 시 3줄 폴백 파싱 |
| localStorage (`main_board_content`) | 새 키로 복사 (이동 아님). 구 키 유지 (롤백 대비) |
| 구 서버 실행 중 + 신 CLI | `GET /api/health` → 404면 구 서버 → stop + 새 서버 시작 |
| 신 서버 + 구 프론트엔드(캐시) | `?file=` 없음 → 400 + 파일 목록. HMR이 새 코드 로드 유도 |
| Sub-agent | 변경 없음. `vync open` CLI 인터페이스 동일 |
| Hooks | SessionEnd 변경 필요. install.sh 재실행으로 적용 |

**롤백 절차:**
```bash
vync stop                        # 현재 코드로 서버 정지
git checkout <stable-tag>        # 코드 복원
npm install                      # 의존성
bash .claude-plugin/install.sh   # 훅 재설치
```

## Stage 2 Preview (멀티 탭 UI)

> 1단계 완료 후 이 섹션을 재검토하고 세부 계획을 작성한다.

**예상 범위:**
- 프론트엔드: 탭 바 UI 컴포넌트
- `App` → 여러 `FileBoard` 인스턴스 관리
- `GET /api/files`로 등록 파일 목록 표시
- 탭 전환: 기존 WS 유지 + 새 WS 연결 (파일별 독립 연결)
- Electron: 멀티 윈도우 지원 (BrowserWindow 여러 개)
- `remoteUpdateUntilRef` → `Map<string, number>` (파일별 echo 방지)

**1단계에서 미리 준비한 것들:**
- `FileBoard` 컴포넌트 분리
- `WsMessage.filePath` 필드
- 파일별 localStorage 키
- `GET /api/files` 엔드포인트

## Testing Strategy

### 유닛 테스트
- `FileRegistry`: register/unregister/idempotent/max-limit/race
- `validateFilePath`: allowlist/extension/.realpath/symlink/traversal
- `readServerInfo`: JSON/legacy 3-line/stale/corrupt
- WsMessage 라우팅: file-scoped broadcast

### 통합 테스트
- 서버 시작 (파일 없이) → 파일 등록 → 파일 읽기/쓰기 → 파일 해제
- 두 파일 동시 등록 → 각각 독립 편집 → echo 방지 확인
- WebSocket: 파일 A 변경 → 파일 B 구독자는 수신 안 함
- 뷰포트: WS 업데이트에서 뷰포트 변경 안 됨

### E2E 테스트
- `vync open A` → `vync open B` → 두 브라우저 탭 모두 동작
- 서버 재시작 → 브라우저 새로고침 → 프론트엔드가 POST로 재등록 → 정상 동작
- `vync close A` → A 탭에 "file closed" 알림 → B 탭 영향 없음
- 보안: `/api/sync?file=/etc/passwd` → 403
