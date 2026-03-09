# Smart Restart + Auto-Open 검증 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `vync open` 스마트 재시작과 `/vync-create` 자동 열기의 정확한 동작을 유닛 테스트 + 수동 E2E로 검증한다.

**Architecture:** `readServerInfo`/`writeServerInfo`/`handleExistingServer` 등 순수 함수는 vitest 유닛 테스트로, 프로세스 spawn/서버 기동이 필요한 통합 시나리오는 수동 CLI로 검증한다. 테스트 격리를 위해 PID_FILE/VYNC_DIR을 tmp 디렉토리로 오버라이드하는 테스트 헬퍼를 사용한다.

**Tech Stack:** Vitest, Node.js fs mock (실제 tmp 디렉토리), Bash CLI

---

## Task 1: 테스트 가능하도록 상수/헬퍼 export

현재 `readServerInfo`, `writeServerInfo`, `handleExistingServer` 등이 모듈 내부 함수로 export되지 않아 직접 테스트 불가. 테스트에 필요한 최소 항목만 export한다.

**Files:**
- Modify: `tools/cli/open.ts`
- Create: `tools/cli/__tests__/open.test.ts`

**Step 1: export 추가**

`tools/cli/open.ts`에서 테스트에 필요한 타입과 함수를 export:

```typescript
// 기존 interface를 export로 변경
export interface ServerInfo {
  pid: number;
  mode: 'daemon' | 'electron' | 'foreground';
  filePath: string;
}

// 기존 함수를 export로 변경
export async function readServerInfo(): Promise<ServerInfo | null> { ... }
export async function writeServerInfo(info: ServerInfo): Promise<void> { ... }

// 테스트에서 경로를 오버라이드할 수 있도록 getter 추가
export function getPidFilePath(): string { return PID_FILE; }
export function getVyncDir(): string { return VYNC_DIR; }
```

변경 대상 (각각 앞에 `export` 키워드 추가):
- L17: `interface ServerInfo` → `export interface ServerInfo`
- L23: `async function readServerInfo` → `export async function readServerInfo`
- L43: `async function writeServerInfo` → `export async function writeServerInfo`
- 파일 끝에 `getPidFilePath`와 `getVyncDir` 추가

**Step 2: 기존 테스트가 깨지지 않는지 확인**

Run: `npx nx run-many -t=test 2>&1 | tail -20`
Expected: init.test.ts PASS (기존 테스트 영향 없음)

**Step 3: Commit**

```bash
git add tools/cli/open.ts
git commit -m "refactor: export ServerInfo helpers for testability"
```

---

## Task 2: readServerInfo / writeServerInfo 유닛 테스트

PID 파일 포맷의 읽기/쓰기 정확성을 검증한다.

**Files:**
- Create: `tools/cli/__tests__/open.test.ts`

**Step 1: 테스트 파일 작성**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  readServerInfo,
  writeServerInfo,
  getPidFilePath,
  getVyncDir,
  type ServerInfo,
} from '../open.js';

// readServerInfo/writeServerInfo는 모듈 상수 VYNC_DIR/PID_FILE을 사용하므로
// 실제 ~/.vync/server.pid를 건드림. 테스트 전후에 백업/복원한다.
const REAL_PID_FILE = getPidFilePath();
const REAL_VYNC_DIR = getVyncDir();
let pidBackup: string | null = null;

beforeEach(async () => {
  // 기존 PID 파일 백업
  try {
    pidBackup = await fs.readFile(REAL_PID_FILE, 'utf-8');
  } catch {
    pidBackup = null;
  }
});

afterEach(async () => {
  // PID 파일 복원
  if (pidBackup !== null) {
    await fs.writeFile(REAL_PID_FILE, pidBackup, 'utf-8');
  } else {
    await fs.unlink(REAL_PID_FILE).catch(() => {});
  }
});

describe('writeServerInfo + readServerInfo', () => {
  it('round-trips ServerInfo correctly', async () => {
    const info: ServerInfo = {
      pid: 12345,
      mode: 'daemon',
      filePath: '/tmp/test.vync',
    };
    await writeServerInfo(info);
    const result = await readServerInfo();
    expect(result).toEqual(info);
  });

  it('handles all three modes', async () => {
    for (const mode of ['daemon', 'electron', 'foreground'] as const) {
      await writeServerInfo({ pid: 99, mode, filePath: '/tmp/x.vync' });
      const result = await readServerInfo();
      expect(result?.mode).toBe(mode);
    }
  });

  it('handles filePath with spaces', async () => {
    const info: ServerInfo = {
      pid: 42,
      mode: 'daemon',
      filePath: '/Users/test user/my project/plan.vync',
    };
    await writeServerInfo(info);
    const result = await readServerInfo();
    expect(result).toEqual(info);
  });
});

describe('readServerInfo edge cases', () => {
  it('returns null when PID file does not exist', async () => {
    await fs.unlink(REAL_PID_FILE).catch(() => {});
    expect(await readServerInfo()).toBeNull();
  });

  it('returns null and cleans up old single-line PID format', async () => {
    await fs.mkdir(REAL_VYNC_DIR, { recursive: true });
    await fs.writeFile(REAL_PID_FILE, '12345', 'utf-8');
    expect(await readServerInfo()).toBeNull();
    // PID file should be deleted
    await expect(fs.access(REAL_PID_FILE)).rejects.toThrow();
  });

  it('returns null and cleans up two-line PID format', async () => {
    await fs.mkdir(REAL_VYNC_DIR, { recursive: true });
    await fs.writeFile(REAL_PID_FILE, '12345\ndaemon', 'utf-8');
    expect(await readServerInfo()).toBeNull();
    await expect(fs.access(REAL_PID_FILE)).rejects.toThrow();
  });

  it('returns null for empty file', async () => {
    await fs.mkdir(REAL_VYNC_DIR, { recursive: true });
    await fs.writeFile(REAL_PID_FILE, '', 'utf-8');
    expect(await readServerInfo()).toBeNull();
  });
});
```

**Step 2: 테스트 실행하여 실패 확인**

Run: `npx vitest run tools/cli/__tests__/open.test.ts`
Expected: FAIL — `readServerInfo`가 아직 export되지 않았으면 import 에러, Task 1 완료 후면 PASS

**Step 3: Task 1이 완료되었으면 테스트 통과 확인**

Run: `npx vitest run tools/cli/__tests__/open.test.ts`
Expected: 모든 테스트 PASS

**Step 4: Commit**

```bash
git add tools/cli/__tests__/open.test.ts
git commit -m "test: add readServerInfo/writeServerInfo unit tests"
```

---

## Task 3: vyncStop 유닛 테스트

SIGTERM 전송, ESRCH 가드, PID 파일 삭제를 검증한다. 실제 프로세스를 spawn하여 종료 동작을 테스트한다.

**Files:**
- Modify: `tools/cli/__tests__/open.test.ts`

**Step 1: vyncStop 테스트 추가**

```typescript
import { vyncStop } from '../open.js';

describe('vyncStop', () => {
  it('handles missing PID file gracefully', async () => {
    await fs.unlink(REAL_PID_FILE).catch(() => {});
    // Should not throw
    await vyncStop();
  });

  it('handles stale PID (process already gone)', async () => {
    // Write a PID that doesn't exist (very high number)
    await writeServerInfo({
      pid: 2147483647,
      mode: 'daemon',
      filePath: '/tmp/test.vync',
    });
    await vyncStop();
    // PID file should be cleaned up
    await expect(fs.access(REAL_PID_FILE)).rejects.toThrow();
  });

  it('stops a real spawned process', async () => {
    // Spawn a long-running sleep process
    const { spawn } = await import('node:child_process');
    const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
    const pid = child.pid!;
    child.unref();

    await writeServerInfo({
      pid,
      mode: 'daemon',
      filePath: '/tmp/test.vync',
    });

    await vyncStop();

    // Process should be dead
    expect(() => process.kill(pid, 0)).toThrow();
    // PID file should be gone
    await expect(fs.access(REAL_PID_FILE)).rejects.toThrow();
  });
});
```

**Step 2: 테스트 실행**

Run: `npx vitest run tools/cli/__tests__/open.test.ts`
Expected: 모든 테스트 PASS

**Step 3: Commit**

```bash
git add tools/cli/__tests__/open.test.ts
git commit -m "test: add vyncStop unit tests (stale PID, real process)"
```

---

## Task 4: 수동 E2E — Fresh start + PID 파일 검증

서버가 없는 상태에서 `vync open`이 정상 동작하고 PID 파일이 올바른 3줄 포맷으로 생성되는지 확인한다.

**Files:** (수정 없음, 수동 검증)

**Step 1: 기존 서버 정리**

```bash
node bin/vync.js stop 2>/dev/null; rm -f ~/.vync/server.pid
```

**Step 2: 테스트 파일 생성**

```bash
node bin/vync.js init /tmp/smart-restart-test.vync 2>/dev/null || true
```

**Step 3: Fresh start**

```bash
node bin/vync.js open /tmp/smart-restart-test.vync
```

Expected:
- 서버 시작 로그 출력
- 브라우저 열림 (또는 Electron 시작)

**Step 4: PID 파일 검증**

```bash
cat ~/.vync/server.pid
```

Expected: 3줄 출력
```
<pid-number>
daemon
/tmp/smart-restart-test.vync
```

(또는 Electron 빌드가 있으면 `electron` 모드)

**Step 5: 결과 기록 후 서버 유지 (Task 5에서 사용)**

---

## Task 5: 수동 E2E — Same-file 재실행

서버가 이미 같은 파일을 서빙 중일 때 `vync open`이 서버를 재시작하지 않고 브라우저만 여는지 확인한다.

**Step 1: Task 4에서 서버가 실행 중인 상태에서 동일 파일로 open**

```bash
node bin/vync.js open /tmp/smart-restart-test.vync
```

Expected 출력:
```
[vync] Server already running, opening browser...
```

**Step 2: PID 변경 없음 확인**

```bash
cat ~/.vync/server.pid
```

Expected: Task 4와 동일한 PID

---

## Task 6: 수동 E2E — Different-file 자동 전환

서버가 다른 파일을 서빙 중일 때 `vync open`이 자동으로 stop → 새 파일로 시작하는지 확인한다.

**Step 1: 두 번째 파일 생성**

```bash
node bin/vync.js init /tmp/smart-restart-test2.vync 2>/dev/null || true
```

**Step 2: 다른 파일로 open**

```bash
node bin/vync.js open /tmp/smart-restart-test2.vync
```

Expected 출력:
```
[vync] Switching to: /tmp/smart-restart-test2.vync
[vync] Server stopped (PID <old-pid>)
[vync] Server running at http://localhost:3100 (PID <new-pid>)
```

**Step 3: PID 파일에 새 경로 확인**

```bash
cat ~/.vync/server.pid
```

Expected: 새 PID + 새 파일 경로

---

## Task 7: 수동 E2E — Stale PID 처리

죽은 PID가 남아있을 때 `vync open`이 cleanup 후 정상 시작하는지 확인한다.

**Step 1: 서버 종료**

```bash
node bin/vync.js stop
```

**Step 2: 가짜 stale PID 파일 생성**

```bash
mkdir -p ~/.vync
printf '99999\ndaemon\n/tmp/nonexistent.vync' > ~/.vync/server.pid
```

**Step 3: open 실행**

```bash
node bin/vync.js open /tmp/smart-restart-test.vync
```

Expected: stale PID cleanup 후 정상 시작 (에러 없음)

**Step 4: 정리**

```bash
node bin/vync.js stop
```

---

## Task 8: 수동 E2E — vync stop SIGKILL 에스컬레이션은 불필요

정상 종료를 확인한다 (SIGKILL까지 가지 않는 것이 정상).

**Step 1: 서버 시작**

```bash
node bin/vync.js open /tmp/smart-restart-test.vync
```

**Step 2: stop 실행**

```bash
node bin/vync.js stop
```

Expected:
- `[vync] Server stopped (PID <pid>)` 출력
- "Force-killing" 메시지 없음
- `~/.vync/server.pid` 삭제됨

**Step 3: 포트 확인**

```bash
lsof -i :3100
```

Expected: 출력 없음 (포트 해제 완료)

---

## Task 9: 테스트 정리 + 최종 커밋

**Step 1: 전체 테스트 실행**

Run: `npx vitest run tools/cli/__tests__/`
Expected: 모든 테스트 PASS

**Step 2: E2E 테스트 잔여물 정리**

```bash
rm -f /tmp/smart-restart-test.vync /tmp/smart-restart-test2.vync
node bin/vync.js stop 2>/dev/null || true
```

**Step 3: 최종 커밋 (필요 시)**

```bash
git add -A
git commit -m "test: smart restart verification complete"
```

---

## 검증 매트릭스

| # | 시나리오 | 검증 방법 | Task |
|---|---------|----------|------|
| V1 | PID 파일 3줄 포맷 round-trip | 유닛 테스트 | 2 |
| V2 | Old 1줄 포맷 → null + cleanup | 유닛 테스트 | 2 |
| V3 | 공백 포함 경로 처리 | 유닛 테스트 | 2 |
| V4 | vyncStop stale PID 처리 | 유닛 테스트 | 3 |
| V5 | vyncStop 실제 프로세스 종료 | 유닛 테스트 | 3 |
| V6 | Fresh start + PID 파일 생성 | 수동 E2E | 4 |
| V7 | Same-file → 브라우저만 열기 | 수동 E2E | 5 |
| V8 | Different-file → 자동 전환 | 수동 E2E | 6 |
| V9 | Stale PID cleanup → 정상 시작 | 수동 E2E | 7 |
| V10 | vync stop 정상 종료 + 포트 해제 | 수동 E2E | 8 |
