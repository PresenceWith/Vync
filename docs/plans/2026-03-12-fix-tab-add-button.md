# Fix: Tab Bar "+" Button Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "+" 버튼이 정상 동작하여, 사용자가 디스크의 미등록 `.vync` 파일을 브라우저에서 직접 열 수 있게 한다.

**Architecture:** 두 가지 독립 버그 수정 — (1) CSS overflow 클리핑으로 드롭다운이 보이지 않는 문제, (2) 드롭다운에 파일이 없는 문제. (1)은 탭 바 DOM 구조 분리로, (2)는 서버 `GET /api/files/discover` 엔드포인트 + 프론트엔드 연동으로 해결.

**Tech Stack:** TypeScript, React 19, Express, vitest

---

## Root Cause

### Bug 1 (Primary): CSS overflow 클리핑

```
.vync-tab-bar { height: 36px; overflow-x: auto; }
  └─ CSS 스펙: overflow-x: auto → overflow-y도 auto로 강제
  └─ .vync-tab-dropdown { position: absolute; top: 100%; }
     └─ top: 100% = 36px = 탭 바 밖 → 스크롤 컨테이너에 의해 클리핑됨
     └─ 드롭다운이 렌더링되지만 사용자에게 보이지 않음
```

### Bug 2 (Secondary): 파일 목록 항상 비어있음

```
app.tsx: hub-file-registered → registeredFiles + tabs 모두에 추가
  └─ unopenedFiles = registeredFiles - tabs = 항상 빈 배열
  └─ 드롭다운: "No more files" 메시지만 표시
```

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `apps/web/src/app/tab-bar.tsx` | TabBar 컴포넌트 | DOM 분리 + 드롭다운 두 섹션 + 새 props |
| `apps/web/src/app/tab-bar.scss` | TabBar 스타일 | scroll 영역 분리 + 섹션 헤더 + dropdown max-height |
| `apps/web/src/app/app.tsx` | App 상태 관리 | discovery state + handlers + TabBar props |
| `tools/server/server.ts` | Express 서버 | `GET /api/files/discover` 엔드포인트 |
| `tools/server/security.ts` | 보안 유틸 | 변경 없음 (`getAllowedDirs` 이미 export) |
| `tools/server/__tests__/discover.test.ts` | 디스커버리 테스트 | 신규 생성 |

---

## Chunk 1: CSS overflow 클리핑 수정 + 서버 디스커버리 엔드포인트

### Task 1: CSS overflow 클리핑 수정

**Files:**
- Modify: `apps/web/src/app/tab-bar.tsx`
- Modify: `apps/web/src/app/tab-bar.scss`

- [ ] **Step 1: SCSS — 탭 바에서 overflow를 scroll 영역으로 분리**

`apps/web/src/app/tab-bar.scss` 수정:

```scss
.vync-tab-bar {
  display: flex;
  align-items: stretch;
  height: 36px;
  background: #f0f0f0;
  border-bottom: 1px solid #ddd;
  flex-shrink: 0;
  /* overflow-x: auto 제거 — .vync-tab-scroll로 이동 */
}

.vync-tab-scroll {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  &::-webkit-scrollbar { height: 0; }
}
```

기존 `.vync-tab-bar`에서 `overflow-x: auto`와 `&::-webkit-scrollbar` 삭제. 나머지 룰(`.vync-tab`, `.vync-tab__close`, `.vync-tab-add`, `.vync-tab-dropdown`, etc)은 그대로 유지.

- [ ] **Step 2: TSX — 탭 바 DOM 구조에 scroll wrapper 추가**

`apps/web/src/app/tab-bar.tsx`의 return문 수정:

```tsx
return (
  <div className="vync-tab-bar">
    <div className="vync-tab-scroll">
      {tabs.map((tab) => (
        <div
          key={tab.filePath}
          className={`vync-tab ${activeFilePath === tab.filePath ? 'vync-tab--active' : ''}`}
          title={tab.filePath}
          onClick={() => onTabClick(tab.filePath)}
        >
          <span>{tab.label}</span>
          <button
            className="vync-tab__close"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.filePath);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
    <div className="vync-tab-add" ref={dropdownRef}>
      <span onClick={() => setDropdownOpen(!dropdownOpen)}>+</span>
      {dropdownOpen && (
        <div className="vync-tab-dropdown">
          {unopenedFiles.length > 0 ? (
            unopenedFiles.map((fp) => {
              const parts = fp.split('/');
              const label = parts[parts.length - 1] || fp;
              return (
                <div
                  key={fp}
                  className="vync-tab-dropdown__item"
                  title={fp}
                  onClick={() => {
                    onAddFile(fp);
                    setDropdownOpen(false);
                  }}
                >
                  {label}
                </div>
              );
            })
          ) : (
            <div className="vync-tab-dropdown__empty">
              No more files.
              <br />
              Use <code>vync open</code> to register new files.
            </div>
          )}
        </div>
      )}
    </div>
  </div>
);
```

핵심 변경: `{tabs.map(...)}`을 `<div className="vync-tab-scroll">` 안에 넣고, `.vync-tab-add`는 그 바깥에 둔다.

- [ ] **Step 3: 브라우저에서 드롭다운 표시 확인**

Run: `npm run dev:server`

브라우저에서 `http://localhost:3100/?file=<path>` 열고 "+" 클릭 → 드롭다운이 탭 바 아래에 정상 표시되는지 확인. "No more files" 메시지가 보이면 Bug 1 수정 완료.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/tab-bar.tsx apps/web/src/app/tab-bar.scss
git commit -m "fix(ui): separate tab scroll container to prevent dropdown clipping

overflow-x: auto on .vync-tab-bar forced overflow-y: auto per CSS spec,
clipping the absolutely positioned dropdown. Split into .vync-tab-scroll
(overflow-x: auto) and keep .vync-tab-add outside the scroll container."
```

---

### Task 2: 서버 디스커버리 엔드포인트 — 테스트 먼저

**Files:**
- Create: `tools/server/__tests__/discover.test.ts`

- [ ] **Step 1: 디스커버리 테스트 작성**

`tools/server/__tests__/discover.test.ts` 생성:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { addAllowedDir, clearAllowedDirs } from '../security.js';

const VYNC_STUB = JSON.stringify({
  version: 1,
  viewport: { zoom: 1, x: 0, y: 0 },
  elements: [],
});

describe('GET /api/files/discover', () => {
  const tmpDir = path.join(os.tmpdir(), `vync-discover-${Date.now()}`);
  let shutdownFn: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (shutdownFn) {
      await shutdownFn();
      shutdownFn = null;
    }
    clearAllowedDirs();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  async function startWithFile(filePath: string) {
    addAllowedDir(path.dirname(filePath));
    const { startServer } = await import('../server.js');
    const port = 3200 + Math.floor(Math.random() * 100);
    const result = await startServer({
      port,
      mode: 'production',
      initialFile: filePath,
    });
    shutdownFn = result.shutdown;
    return { port, ...result };
  }

  it('discovers unregistered .vync files in allowed directory', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const registered = path.join(tmpDir, 'a.vync');
    const unregistered = path.join(tmpDir, 'b.vync');
    await fs.writeFile(registered, VYNC_STUB);
    await fs.writeFile(unregistered, VYNC_STUB);

    const { port } = await startWithFile(registered);

    const res = await fetch(`http://localhost:${port}/api/files/discover`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    const realUnregistered = await fs.realpath(unregistered);
    expect(body.files).toContain(realUnregistered);
    // registered file should NOT appear
    const realRegistered = await fs.realpath(registered);
    expect(body.files).not.toContain(realRegistered);
  });

  it('ignores non-.vync files', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const vyncFile = path.join(tmpDir, 'a.vync');
    const txtFile = path.join(tmpDir, 'notes.txt');
    await fs.writeFile(vyncFile, VYNC_STUB);
    await fs.writeFile(txtFile, 'hello');

    const { port } = await startWithFile(vyncFile);

    const res = await fetch(`http://localhost:${port}/api/files/discover`);
    const body = await res.json();
    expect(body.files.every((f: string) => f.endsWith('.vync'))).toBe(true);
  });

  it('scans .vync/ subdirectory of allowed dir', async () => {
    const subDir = path.join(tmpDir, '.vync');
    await fs.mkdir(subDir, { recursive: true });
    const parentFile = path.join(tmpDir, 'main.vync');
    const subFile = path.join(subDir, 'sub.vync');
    await fs.writeFile(parentFile, VYNC_STUB);
    await fs.writeFile(subFile, VYNC_STUB);

    const { port } = await startWithFile(parentFile);

    const res = await fetch(`http://localhost:${port}/api/files/discover`);
    const body = await res.json();
    const realSub = await fs.realpath(subFile);
    expect(body.files).toContain(realSub);
  });

  it('returns empty array when no unregistered files exist', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const onlyFile = path.join(tmpDir, 'only.vync');
    await fs.writeFile(onlyFile, VYNC_STUB);

    const { port } = await startWithFile(onlyFile);

    const res = await fetch(`http://localhost:${port}/api/files/discover`);
    const body = await res.json();
    expect(body.files).toEqual([]);
  });

  it('handles non-existent scan directories gracefully', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const file = path.join(tmpDir, 'a.vync');
    await fs.writeFile(file, VYNC_STUB);

    // Add a non-existent dir to allowedDirs
    addAllowedDir('/tmp/does-not-exist-' + Date.now());

    const { port } = await startWithFile(file);

    const res = await fetch(`http://localhost:${port}/api/files/discover`);
    expect(res.ok).toBe(true);
    // Should not crash
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run tools/server/__tests__/discover.test.ts`

Expected: FAIL — `GET /api/files/discover` 엔드포인트가 아직 없으므로 404 또는 fetch 에러.

- [ ] **Step 3: Commit (failing tests)**

```bash
git add tools/server/__tests__/discover.test.ts
git commit -m "test: add failing tests for GET /api/files/discover endpoint"
```

---

### Task 3: 서버 디스커버리 엔드포인트 — 구현

**Files:**
- Modify: `tools/server/server.ts:6-10` (import 수정)
- Modify: `tools/server/server.ts:125-126` (엔드포인트 추가)

- [ ] **Step 1: import에 `getAllowedDirs` 추가, `fs` import 추가**

`tools/server/server.ts` 상단 수정:

```typescript
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
```

변경: `import fs from 'node:fs/promises';` 추가 (line 3), `getAllowedDirs` import 추가 (line 10).

- [ ] **Step 2: `GET /api/files/discover` 엔드포인트 추가**

`tools/server/server.ts`의 `DELETE /api/files` 핸들러 다음, `// --- Sync API` 주석 전에 추가 (line 126 부근):

```typescript
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
            const real = await fs.realpath(path.join(dir, entry.name)).catch(
              () => null
            );
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
```

- [ ] **Step 3: 테스트 실행 → 통과 확인**

Run: `npx vitest run tools/server/__tests__/discover.test.ts`

Expected: 5/5 PASS.

- [ ] **Step 4: 전체 테스트 실행**

Run: `npm test`

Expected: 기존 테스트 + 신규 5개 모두 PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/server/server.ts tools/server/__tests__/discover.test.ts
git commit -m "feat(server): add GET /api/files/discover endpoint

Scans allowedDirs and their .vync/ subdirectories for unregistered
.vync files. Returns up to 100 discovered file paths. Enables the
frontend '+' button to show files available for opening."
```

---

## Chunk 2: 프론트엔드 드롭다운 연동

### Task 4: App + TabBar discovery 연동 (원자적 변경)

> Task 4는 app.tsx와 tab-bar.tsx를 함께 수정한다. 분리하면 TypeScript 컴파일 에러가 발생하므로 (app.tsx가 아직 없는 TabBar props를 전달) 반드시 하나의 커밋으로 묶는다.

**Files:**
- Modify: `apps/web/src/app/app.tsx`
- Modify: `apps/web/src/app/tab-bar.tsx`
- Modify: `apps/web/src/app/tab-bar.scss`

- [ ] **Step 1: TabBar props 인터페이스 확장**

`apps/web/src/app/tab-bar.tsx`의 `TabBarProps` 수정:

```typescript
interface TabBarProps {
  tabs: TabInfo[];
  activeFilePath: string | null;
  registeredFiles: string[];
  discoveredFiles: string[];
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onAddFile: (filePath: string) => void;
  onDiscoverFile: (filePath: string) => void;
  onDropdownOpen: () => void;
}
```

destructure에도 추가:

```typescript
export function TabBar({
  tabs,
  activeFilePath,
  registeredFiles,
  discoveredFiles,
  onTabClick,
  onTabClose,
  onAddFile,
  onDiscoverFile,
  onDropdownOpen,
}: TabBarProps) {
```

- [ ] **Step 2: App에 discovery state와 handlers 추가**

`apps/web/src/app/app.tsx`에 다음 추가:

state 선언 (line 33 이후, `tabsRef` 다음):

```typescript
const [discoveredFiles, setDiscoveredFiles] = useState<string[]>([]);
```

handlers (line 127 `handleAddFile` 다음):

```typescript
const handleDropdownOpen = useCallback(async () => {
  try {
    const res = await fetch('/api/files/discover');
    if (res.ok) {
      const data = await res.json();
      setDiscoveredFiles(data.files || []);
    }
  } catch {
    setDiscoveredFiles([]);
  }
}, []);

const handleDiscoverFile = useCallback(async (filePath: string) => {
  try {
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    if (res.ok) {
      const data = await res.json();
      handleAddFile(data.filePath);  // 서버 검증된 경로 사용 + 즉시 탭 추가
      setDiscoveredFiles([]);
    }
  } catch (err) {
    console.error('[vync] Failed to register discovered file:', err);
  }
}, [handleAddFile]);
```

TabBar에 새 props 전달:

```tsx
<TabBar
  tabs={tabsWithLabels}
  activeFilePath={activeFilePath}
  registeredFiles={registeredFiles}
  discoveredFiles={discoveredFiles}
  onTabClick={setActiveFilePath}
  onTabClose={handleTabClose}
  onAddFile={handleAddFile}
  onDiscoverFile={handleDiscoverFile}
  onDropdownOpen={handleDropdownOpen}
/>
```

- [ ] **Step 3: TabBar "+" 클릭 시 onDropdownOpen 호출 + 드롭다운 두 섹션 렌더링**

`<span>` onClick 수정:

```tsx
<span
  onClick={() => {
    const willOpen = !dropdownOpen;
    setDropdownOpen(willOpen);
    if (willOpen) onDropdownOpen();
  }}
>
  +
</span>
```

드롭다운 내용을 두 섹션으로 교체 (기존 `{dropdownOpen && (...)}` 블록 전체 교체):

```tsx
{dropdownOpen && (
  <div className="vync-tab-dropdown">
    {unopenedFiles.length > 0 && (
      <>
        <div className="vync-tab-dropdown__section">Reopen</div>
        {unopenedFiles.map((fp) => {
          const parts = fp.split('/');
          const label = parts[parts.length - 1] || fp;
          return (
            <div
              key={fp}
              className="vync-tab-dropdown__item"
              title={fp}
              onClick={() => {
                onAddFile(fp);
                setDropdownOpen(false);
              }}
            >
              {label}
            </div>
          );
        })}
      </>
    )}
    {discoveredFiles.length > 0 && (
      <>
        <div className="vync-tab-dropdown__section">Open</div>
        {discoveredFiles.map((fp) => {
          const parts = fp.split('/');
          const label = parts[parts.length - 1] || fp;
          return (
            <div
              key={fp}
              className="vync-tab-dropdown__item"
              title={fp}
              onClick={() => {
                onDiscoverFile(fp);
                setDropdownOpen(false);
              }}
            >
              {label}
            </div>
          );
        })}
      </>
    )}
    {unopenedFiles.length === 0 && discoveredFiles.length === 0 && (
      <div className="vync-tab-dropdown__empty">
        No files found.
        <br />
        Use <code>vync open &lt;file&gt;</code> to add files.
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: 섹션 헤더 스타일 + 드롭다운 max-height 추가**

`apps/web/src/app/tab-bar.scss`에 추가:

```scss
.vync-tab-dropdown {
  /* 기존 스타일에 추가 */
  max-height: 300px;
  overflow-y: auto;
}

.vync-tab-dropdown__section {
  padding: 4px 12px;
  font-size: 11px;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  &:not(:first-child) {
    border-top: 1px solid #eee;
    margin-top: 2px;
    padding-top: 6px;
  }
}
```

- [ ] **Step 5: TypeScript 컴파일 확인**

Run: `npx tsc --noEmit`

Expected: 에러 없음.

- [ ] **Step 6: 전체 테스트 실행**

Run: `npm test`

Expected: 전체 PASS (기존 + discover 테스트).

- [ ] **Step 7: Commit (app.tsx + tab-bar.tsx + tab-bar.scss 원자적)**

```bash
git add apps/web/src/app/app.tsx apps/web/src/app/tab-bar.tsx apps/web/src/app/tab-bar.scss
git commit -m "feat(ui): connect file discovery to tab bar dropdown

App fetches GET /api/files/discover on '+' click, passes results
to TabBar. Dropdown shows 'Reopen' (closed tabs) and 'Open'
(unregistered .vync files) sections. Uses handleAddFile with
server-validated path for reliable tab creation."
```

---

### Task 6: E2E 수동 검증

- [ ] **Step 1: 서버 시작 + 테스트 파일 준비**

```bash
# 테스트 디렉토리에 .vync 파일 2개 생성
mkdir -p /tmp/vync-test
echo '{"version":1,"viewport":{"zoom":1,"x":0,"y":0},"elements":[]}' > /tmp/vync-test/first.vync
echo '{"version":1,"viewport":{"zoom":1,"x":0,"y":0},"elements":[]}' > /tmp/vync-test/second.vync

# 서버 시작 (first.vync만 등록)
npx tsx tools/server/server.ts /tmp/vync-test/first.vync
```

- [ ] **Step 2: 6개 시나리오 확인**

| # | Action | Expected |
|---|--------|----------|
| 1 | "+" 클릭 | 드롭다운이 탭 바 아래에 **보임** (Bug 1 수정) |
| 2 | 드롭다운 내용 | "Open" 섹션에 `second.vync` 표시 (Bug 2 수정) |
| 3 | `second.vync` 클릭 | 탭에 추가, 활성화, 보드 로드 |
| 4 | 다시 "+" 클릭 | `second.vync` 더 이상 안 보임 (이미 등록) |
| 5 | `first.vync` 탭 × 닫기 | 탭 제거 |
| 6 | "+" 클릭 | "Reopen" 섹션에 `first.vync` 표시 |

- [ ] **Step 3: 정리 + 최종 Commit**

```bash
rm -rf /tmp/vync-test
```

최종 커밋이 필요한 경우만 (모든 변경이 이미 커밋되었을 수 있음).

---

## Security Notes

- `getAllowedDirs()` 범위 내에서만 스캔 (사용자가 `vync open`으로 열었던 디렉토리)
- 재귀 탐색 없음 (1단계만)
- `.vync` 확장자만 반환
- 100개 결과 제한
- 발견된 파일 클릭 → 기존 `POST /api/files` → `validateFilePath` 이중 검증
