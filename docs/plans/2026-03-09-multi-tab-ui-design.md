# Design: Multi-Tab UI (Phase 8 Stage 2)

**Date:** 2026-03-09
**Status:** Implemented
**Depends on:** Phase 8 Stage 1 (완료)

## Goal

단일 브라우저 탭/Electron 윈도우 안에서 여러 `.vync` 파일을 탭으로 전환하며 작업할 수 있는 UI를 구현한다.

- 상단 수평 탭 바 (Chrome/VS Code 스타일)
- `vync open B.vync` → 기존 브라우저의 탭 바에 실시간 추가
- 탭 전환으로 파일 간 빠른 이동
- Electron에서도 동일한 UI (프론트엔드 공유)

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| M-9 | 상단 수평 탭 바 | Chrome/VS Code 익숙한 UX. 캔버스 영역 최대화. |
| M-10 | Active 탭만 마운트 (mount/unmount) | Plait board re-init ~0.6초 허용 가능. WS 연결 1개만 유지. `display:none` 시 canvas/SVG 호환성 리스크 회피. |
| M-11 | Hub-level WebSocket | 파일 등록/해제를 실시간으로 모든 프론트엔드에 알림. polling 불필요. 향후 대시보드/파일 간 링크에도 재사용 가능. |
| M-12 | 탭 닫기(×) ≠ vync close | 탭 × = UI에서 숨기기 (되돌릴 수 있음). vync close = 서버 해제 (watcher/WS 정리). 다른 세션 보호. |
| M-13 | Electron = 프론트엔드 탭 UI | thin shell 아키텍처(D-012) 유지. 프론트엔드 변경만으로 자동 적용. 추가 Electron 코드 최소. |
| M-14 | CLI에서만 파일 열기 | Vync 철학(CLI 중심, D-006) 유지. + 버튼은 등록된 파일 중 탭에 없는 것 선택. 파일 시스템 브라우저 없음. |
| M-15 | 중복 파일명 disambiguate | 같은 basename 존재 시 상위 디렉토리 포함 (`proj1/plan.vync`). 고유하면 basename만. |

## Architecture

### Component Structure

```
App
  ├─ useHubWebSocket()        ← hub WS 연결 (파일 등록/해제 이벤트)
  ├─ tabs state               ← [{filePath, label}, ...]
  ├─ activeFilePath state
  │
  ├─ TabBar
  │    ├─ Tab (plan.vync) [active]   ← 클릭: setActiveFilePath
  │    ├─ Tab (arch.vync)            ← × 클릭: 탭 목록에서 제거 (서버 유지)
  │    └─ AddTabButton (+)           ← 드롭다운: 등록 파일 중 탭에 없는 것
  │
  └─ FileBoard (key={activeFilePath})  ← active만 마운트. key 변경 시 unmount/mount.
       ├─ file-scoped WS 연결
       ├─ API calls
       └─ Plait Board
```

### Hub WebSocket Protocol

**연결:** `ws://localhost:3100/ws` (file 파라미터 없음)

현재 `?file=` 없는 WS 연결은 에러(4400)로 거부됨. 이를 hub client 모드로 변경.

**서버 → 클라이언트:**

```typescript
// 연결 시 — 현재 등록 파일 목록 전달
{ type: "connected", data: { files: ["/path/A.vync", "/path/B.vync"] } }

// 파일 등록 시
{ type: "hub-file-registered", filePath: "/path/to/C.vync" }

// 파일 해제 시 (vync close, idle timeout, etc.)
{ type: "hub-file-unregistered", filePath: "/path/to/C.vync" }
```

**WsMessage 타입 확장:**
```typescript
interface WsMessage<T = unknown> {
  type: 'file-changed' | 'connected' | 'file-closed' | 'file-deleted' | 'error'
    | 'hub-file-registered' | 'hub-file-unregistered';  // 신규
  filePath?: string;
  data?: VyncFile<T> | { files: string[] };  // connected에서 hub 모드 시 파일 목록
  code?: string;
}
```

### Tab State Management

```typescript
interface TabInfo {
  filePath: string;   // 절대경로 (식별자)
  label: string;      // 표시명 (basename or disambiguated)
}

// App state
const [tabs, setTabs] = useState<TabInfo[]>([]);
const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
```

**초기화 흐름:**
1. App 마운트 → Hub WS 연결
2. Hub WS `connected` 수신 → `data.files`로 탭 초기화
3. URL `?file=` 파라미터 → 해당 파일을 active로 설정
4. URL에 `?file=` 없음 → 첫 번째 등록 파일 active (없으면 빈 화면)

**실시간 업데이트:**
- `hub-file-registered` → 탭 목록에 추가 (active 전환 안 함 — 현재 작업 방해 방지)
- `hub-file-unregistered` → 탭 목록에서 제거. active가 해당 파일이면 다음 탭으로 전환.

**탭 닫기(×):**
- 탭 목록에서만 제거 (서버 등록 유지)
- + 버튼 드롭다운에 다시 나타남
- 마지막 탭 닫기 → 빈 화면 ("No file selected")

**URL 동기화:**
- 탭 전환 시 `history.replaceState`로 `?file=` 갱신
- 새로고침 시 같은 파일 active
- pushState 아님 (뒤로가기 이력 오염 방지)

### Tab Label Disambiguate

```typescript
function computeLabels(filePaths: string[]): Map<string, string> {
  const basenames = filePaths.map(fp => path.basename(fp));
  const counts = new Map<string, number>();
  for (const bn of basenames) {
    counts.set(bn, (counts.get(bn) || 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const fp of filePaths) {
    const bn = path.basename(fp);
    if (counts.get(bn)! > 1) {
      // 중복: 상위 디렉토리 포함
      const parent = path.basename(path.dirname(fp));
      labels.set(fp, `${parent}/${bn}`);
    } else {
      labels.set(fp, bn);
    }
  }
  return labels;
}
```

### Add Tab (+) Dropdown

```
[+] 클릭 시:
┌────────────────────────┐
│  arch.vync             │  ← 서버에 등록되었지만 현재 탭에 없는 파일
│  notes.vync            │
├────────────────────────┤
│  (no more files)       │  ← 모든 파일이 이미 탭에 있을 때
│  Use `vync open` to    │
│  register new files    │
└────────────────────────┘
```

- 드롭다운 항목 = `registeredFiles.filter(f => !tabs.some(t => t.filePath === f))`
- 클릭 → 탭 추가 + active 설정

### No File State

등록 파일 0개이거나 모든 탭을 닫았을 때:

```
┌──────────────────────────────────────┐
│  [+]                                 │
├──────────────────────────────────────┤
│                                      │
│     No file selected                 │
│     Use `vync open <file>` to start  │
│                                      │
└──────────────────────────────────────┘
```

## Server Changes

### 1. `packages/shared/src/types.ts`

WsMessage type에 `hub-file-registered`, `hub-file-unregistered` 추가.

### 2. `tools/server/file-registry.ts`

```typescript
class FileRegistry extends EventEmitter {
  // 기존 필드...
  private hubClients = new Set<WebSocket>();

  addHubClient(ws: WebSocket): void {
    this.hubClients.add(ws);
  }

  removeHubClient(ws: WebSocket): void {
    this.hubClients.delete(ws);
  }

  private broadcastToHub(message: WsMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.hubClients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }

  async register(filePath: string): Promise<void> {
    // ... 기존 로직 ...
    this.emit('registered', validated);
    this.broadcastToHub({ type: 'hub-file-registered', filePath: validated });
  }

  async unregister(filePath: string): Promise<void> {
    // ... 기존 로직 ...
    this.emit('unregistered', filePath);
    this.broadcastToHub({ type: 'hub-file-unregistered', filePath });
    // ...
  }

  async shutdown(): Promise<void> {
    // 기존 파일 정리 + hub 클라이언트 정리
    for (const ws of this.hubClients) {
      ws.close(1001, 'Server shutting down');
    }
    this.hubClients.clear();
  }
}
```

### 3. `tools/server/ws-handler.ts`

```typescript
wss.on('connection', (ws, _request, filePath) => {
  if (!filePath) {
    // Hub mode: 파일에 바인딩되지 않은 허브 클라이언트
    registry.addHubClient(ws);
    ws.send(JSON.stringify({
      type: 'connected',
      data: { files: registry.listFiles() },
    } satisfies WsMessage));

    ws.on('close', () => {
      registry.removeHubClient(ws);
    });
    return;
  }

  // 기존 file-scoped 로직...
});
```

## Frontend Changes

### 4. `apps/web/src/app/tab-bar.tsx` (신규)

```typescript
interface TabBarProps {
  tabs: TabInfo[];
  activeFilePath: string | null;
  registeredFiles: string[];
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onAddFile: (filePath: string) => void;
}
```

- 각 탭: 파일 라벨 + × 닫기 버튼
- Active 탭: 하단 border accent + 배경색 구분
- × 버튼: hover 시 표시, active는 항상 표시
- + 버튼: 클릭 시 드롭다운
- 오버플로우: `overflow-x: auto` + `flex-nowrap`
- Tooltip: 전체 절대경로 (title 속성)

### 5. `apps/web/src/app/tab-bar.scss` (신규)

```scss
.vync-tab-bar {
  display: flex;
  align-items: stretch;
  height: 36px;
  background: #f0f0f0;
  border-bottom: 1px solid #ddd;
  overflow-x: auto;
  flex-shrink: 0;

  &::-webkit-scrollbar { height: 0; }
}

.vync-tab {
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 6px;
  cursor: pointer;
  border-right: 1px solid #ddd;
  white-space: nowrap;
  font-size: 13px;
  color: #666;
  user-select: none;
  min-width: 0;

  &:hover { background: #e8e8e8; }

  &--active {
    background: #fff;
    color: #333;
    border-bottom: 2px solid #4a9eff;
  }
}

.vync-tab__close {
  opacity: 0;
  border: none;
  background: none;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  font-size: 12px;
  color: #999;

  .vync-tab:hover &,
  .vync-tab--active & { opacity: 1; }
  &:hover { background: #ddd; color: #333; }
}

.vync-tab-add {
  display: flex;
  align-items: center;
  padding: 0 10px;
  cursor: pointer;
  color: #999;
  font-size: 16px;
  position: relative;

  &:hover { color: #333; background: #e8e8e8; }
}

.vync-tab-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  min-width: 180px;
  z-index: 100;
  padding: 4px 0;
}

.vync-tab-dropdown__item {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  &:hover { background: #f0f0f0; }
}

.vync-tab-dropdown__empty {
  padding: 8px 12px;
  color: #999;
  font-size: 12px;
}
```

### 6. `apps/web/src/app/app.tsx` (리팩토링)

```typescript
function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [registeredFiles, setRegisteredFiles] = useState<string[]>([]);

  // URL ?file= → 초기 active 파일
  const initialFile = useMemo(
    () => new URLSearchParams(window.location.search).get('file'),
    []
  );

  // Hub WebSocket
  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;  // file 파라미터 없음
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.type === 'connected' && msg.data?.files) {
          const files: string[] = msg.data.files;
          setRegisteredFiles(files);
          setTabs(files.map(fp => ({ filePath: fp, label: '' })));
          setActiveFilePath(prev => prev || initialFile || files[0] || null);
        }

        if (msg.type === 'hub-file-registered') {
          setRegisteredFiles(prev => [...new Set([...prev, msg.filePath])]);
          setTabs(prev => {
            if (prev.some(t => t.filePath === msg.filePath)) return prev;
            return [...prev, { filePath: msg.filePath, label: '' }];
          });
        }

        if (msg.type === 'hub-file-unregistered') {
          setRegisteredFiles(prev => prev.filter(f => f !== msg.filePath));
          setTabs(prev => prev.filter(t => t.filePath !== msg.filePath));
          setActiveFilePath(prev =>
            prev === msg.filePath
              ? tabs.find(t => t.filePath !== msg.filePath)?.filePath || null
              : prev
          );
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  // URL 동기화
  useEffect(() => {
    if (activeFilePath) {
      const url = new URL(window.location.href);
      url.searchParams.set('file', activeFilePath);
      history.replaceState(null, '', url.toString());
    }
  }, [activeFilePath]);

  // Label 계산 (disambiguate)
  const tabsWithLabels = useMemo(() => computeLabels(tabs), [tabs]);

  // 탭 닫기
  const handleTabClose = (filePath: string) => {
    setTabs(prev => prev.filter(t => t.filePath !== filePath));
    if (activeFilePath === filePath) {
      const remaining = tabs.filter(t => t.filePath !== filePath);
      setActiveFilePath(remaining[0]?.filePath || null);
    }
  };

  // 파일 추가 (+ 드롭다운에서 선택)
  const handleAddFile = (filePath: string) => {
    setTabs(prev => {
      if (prev.some(t => t.filePath === filePath)) return prev;
      return [...prev, { filePath, label: '' }];
    });
    setActiveFilePath(filePath);
  };

  if (tabs.length === 0 && !activeFilePath) {
    return <NoFileView />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TabBar
        tabs={tabsWithLabels}
        activeFilePath={activeFilePath}
        registeredFiles={registeredFiles}
        onTabClick={setActiveFilePath}
        onTabClose={handleTabClose}
        onAddFile={handleAddFile}
      />
      {activeFilePath
        ? <FileBoard key={activeFilePath} filePath={activeFilePath} />
        : <NoFileView />
      }
    </div>
  );
}
```

### 7. `apps/web/src/app/file-board.tsx`

변경 없음. 이미 `key={activeFilePath}`로 mount/unmount 지원.

## Electron Changes

### 8. `tools/electron/main.ts`

현재: `openFile()` → 매번 `mainWindow.loadURL(url)` (페이지 리로드).

변경:
- 첫 번째 파일: `loadURL()` (윈도우 생성)
- 두 번째 이후: `POST /api/files`만 (hub WS가 프론트엔드에 알림, 리로드 없음)

```typescript
async function openFile(filePath: string) {
  if (serverHandle) {
    await fetch(`${serverHandle.url}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
  } else {
    const mod = await import('../server/server.js');
    serverHandle = await mod.startServer({ initialFile: filePath, ... });
  }

  if (!mainWindow) {
    const url = `${serverHandle.url}/?file=${encodeURIComponent(filePath)}`;
    createWindow(url);
  }
  // 이미 윈도우 있으면 loadURL 안 함 — hub WS가 탭 추가 알림
}
```

## Implementation Tasks

| # | Task | File(s) | Depends |
|---|------|---------|---------|
| 1 | WsMessage 타입 확장 | `packages/shared/src/types.ts` | — |
| 2 | FileRegistry hub 클라이언트 관리 | `tools/server/file-registry.ts` | 1 |
| 3 | WS handler hub 모드 | `tools/server/ws-handler.ts` | 2 |
| 4 | Hub WS 서버 테스트 | `tools/server/__tests__/` | 3 |
| 5 | TabBar 컴포넌트 | `apps/web/src/app/tab-bar.tsx` | — |
| 6 | TabBar 스타일 | `apps/web/src/app/tab-bar.scss` | 5 |
| 7 | App 리팩토링 (탭 상태 + hub WS) | `apps/web/src/app/app.tsx` | 3, 5 |
| 8 | Label disambiguate 유틸리티 | `apps/web/src/app/tab-utils.ts` | — |
| 9 | Electron openFile 최적화 | `tools/electron/main.ts` | 7 |
| 10 | 통합 E2E 검증 | — | 9 |
| 11 | 문서 업데이트 | `PLAN.md`, `ARCHITECTURE.md`, `CLAUDE.md` | 10 |

**구현 순서:** 1→2→3→4 (서버) → 5,6,8 병렬 → 7 → 9 → 10 → 11

## Testing Strategy

### 서버 유닛 테스트 (Task 4)
- Hub WS 연결 시 `connected` + 파일 목록 수신
- `POST /api/files` → hub 클라이언트가 `hub-file-registered` 수신
- `DELETE /api/files` → hub 클라이언트가 `hub-file-unregistered` 수신
- Hub 클라이언트 disconnect → 정상 정리 (에러 없음)
- File-scoped WS와 hub WS 독립 동작

### 프론트엔드 E2E (Task 10, 수동)
- `vync open A.vync` → 탭 바에 [A] 표시
- `vync open B.vync` → 기존 탭 바에 [B] 실시간 추가 (active 전환 안 함)
- 탭 클릭 → FileBoard 전환 (보드 로드)
- × 클릭 → 탭 제거 (서버 등록 유지)
- + 클릭 → 드롭다운에 미열린 파일 표시
- `vync close A.vync` → A 탭 자동 제거
- 모든 탭 닫기 → "No file selected" 표시
- 새로고침 → URL ?file= 기반으로 같은 파일 active

## Scope Exclusions

| 제외 항목 | 이유 |
|-----------|------|
| 탭 드래그 정렬 | 복잡도 높음. 현재 사용 패턴에서 불필요. |
| 탭 순서 persist (localStorage) | 세션 간 탭 순서 유지는 과도한 최적화. |
| 탭 닫기 확인 다이얼로그 | 탭 닫기 = UI 숨기기라 데이터 손실 없음. |
| 탭 컨텍스트 메뉴 (우클릭) | Phase 범위 초과. |
| 탭 핀 고정 | Phase 범위 초과. |
| UI 파일 열기 (파일 시스템 브라우저) | CLI 중심 철학 유지 (M-14). |
| Electron 멀티 윈도우 | 프론트엔드 탭 UI로 충분 (M-13). |
