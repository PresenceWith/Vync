# Server Process Lifecycle Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Electron EADDRINUSE recovery + CLI/Server identity 검증을 추가하여 포트 충돌 시 자동 복구되도록 한다.

**Architecture:** 서버 health endpoint에 `pid`를 추가하고, Electron과 CLI 양쪽에서 포트 충돌 시 기존 서버를 발견·재사용하는 recovery 경로를 추가한다. 기존 happy path는 변경하지 않는다.

**Tech Stack:** TypeScript, Node.js, Express, Electron, vitest

---

## 배경

3개 에이전트 리뷰 결과 도출된 근본 원인 1개:
- **Electron이 EADDRINUSE 시 기존 서버에 연결하는 recovery 경로가 없다**
- 부수적으로 `runElectron`이 `registerFile`을 호출하지 않는 비대칭 존재

수정 우선순위: Task 1(health pid) → Task 2(Electron recovery) → Task 3(CLI 포트 감지) → Task 4(runElectron registerFile)

---

### Task 1: Health Endpoint에 `pid` 추가

**Files:**
- Modify: `tools/server/server.ts:57-58`
- Test: `tools/server/__tests__/server.test.ts` (기존 health 테스트가 있으면 수정, 없으면 확인)

**Step 1: health endpoint에 process.pid 추가**

```typescript
// tools/server/server.ts:57-58
// Before:
app.get('/api/health', (_req, res) => {
  res.json({ version: 2, mode: 'hub', fileCount: registry.listFiles().length });
});

// After:
app.get('/api/health', (_req, res) => {
  res.json({ version: 2, mode: 'hub', pid: process.pid, fileCount: registry.listFiles().length });
});
```

**Step 2: 기존 테스트 확인 및 실행**

Run: `npx vitest run --reporter=verbose 2>&1 | head -80`
Expected: 기존 테스트 모두 PASS (health 응답 shape이 바뀌므로 관련 assertion 업데이트 필요할 수 있음)

**Step 3: Commit**

```bash
git add tools/server/server.ts
git commit -m "feat(server): add pid to health endpoint for identity verification"
```

---

### Task 2: Electron EADDRINUSE Recovery

**Files:**
- Modify: `tools/electron/main.ts:82-101` (openFile의 server start catch 블록)

**Step 1: Electron에 기존 서버 연결 recovery 로직 추가**

`tools/electron/main.ts`의 `openFile` 함수에서 `startServer` 실패 시 EADDRINUSE를 감지하고, 기존 서버에 연결을 시도한다.

```typescript
// tools/electron/main.ts — openFile 함수의 else 블록 교체
// Before (line 82-101):
  } else {
    try {
      const { startServer } = await import('../server/server.js');
      const isDev = !app.isPackaged;
      const staticDir = isDev
        ? undefined
        : path.join(process.resourcesPath, 'dist', 'apps', 'web');
      serverHandle = await startServer({
        initialFile: resolved,
        port: 3100,
        mode: isDev ? 'development' : 'production',
        staticDir,
      });
    } catch (err: any) {
      dialog.showErrorBox('Vync Error', err.message);
      app.quit();
      return;
    }
  }

// After:
  } else {
    try {
      const { startServer } = await import('../server/server.js');
      const isDev = !app.isPackaged;
      const staticDir = isDev
        ? undefined
        : path.join(process.resourcesPath, 'dist', 'apps', 'web');
      serverHandle = await startServer({
        initialFile: resolved,
        port: 3100,
        mode: isDev ? 'development' : 'production',
        staticDir,
      });
    } catch (err: any) {
      // EADDRINUSE: try connecting to existing server
      if (err.message.includes('already in use')) {
        const existingUrl = 'http://localhost:3100';
        try {
          const res = await fetch(`${existingUrl}/api/health`, {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) {
            const body = await res.json();
            if (body.version === 2) {
              // Reuse existing server (no shutdown responsibility)
              serverHandle = { shutdown: async () => {}, url: existingUrl };
              console.log(`[vync] Reusing existing server (PID ${body.pid})`);
            } else {
              dialog.showErrorBox('Vync Error', 'Incompatible server on port 3100');
              app.quit();
              return;
            }
          } else {
            dialog.showErrorBox('Vync Error', `Port 3100 in use by non-Vync process`);
            app.quit();
            return;
          }
        } catch {
          dialog.showErrorBox('Vync Error', 'Port 3100 in use but server not responding');
          app.quit();
          return;
        }
      } else {
        dialog.showErrorBox('Vync Error', err.message);
        app.quit();
        return;
      }
    }
  }
```

핵심 변경:
- `serverHandle.shutdown`이 no-op이므로 Electron 창 닫힘 시 기존 서버를 죽이지 않음
- `body.version === 2`로 Vync 서버 identity 확인
- 기존 서버 연결 후 `registerFile`은 아래 코드 흐름(line 67-81)에서 처리됨... 아닌데, 현재 코드에서는 `!serverHandle`일 때만 서버를 시작하고, `serverHandle`이 있으면 register를 한다. 하지만 recovery 후에는 `serverHandle`이 설정되므로 다음 `openFile` 호출부터는 register 경로를 탄다.

문제: recovery 직후의 **첫 번째 파일**은 register되지 않는다. 기존 서버의 `startServer(initialFile)` 경로를 타지 않기 때문이다. 따라서 recovery 후 명시적 register가 필요하다.

수정된 recovery 블록 끝에 register 추가:

```typescript
              serverHandle = { shutdown: async () => {}, url: existingUrl };
              console.log(`[vync] Reusing existing server (PID ${body.pid})`);
              // Register the file with existing server
              await fetch(`${existingUrl}/api/files`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: resolved }),
              });
```

**Step 2: 수동 검증 (Electron은 vitest로 테스트 어려움)**

검증 방법: 서버를 foreground로 먼저 시작한 뒤, Electron을 실행하여 recovery 되는지 확인.

```bash
# Terminal 1: 서버 먼저 시작
node bin/vync.js open some-file --foreground

# Terminal 2: Electron이 recovery하는지 확인
npx electron dist/electron/main.js /path/to/other.vync
# Expected: "[vync] Reusing existing server" 로그 + 파일 열림
```

**Step 3: Commit**

```bash
git add tools/electron/main.ts
git commit -m "fix(electron): recover from EADDRINUSE by reusing existing server"
```

---

### Task 3: CLI `isServerRunning` 포트 기반 감지 추가

**Files:**
- Modify: `tools/cli/open.ts:67-96` (isServerRunning 함수)
- Test: `tools/cli/__tests__/open.test.ts`

**Step 1: isServerRunning에 포트 프로브 fallback 추가**

현재 `isServerRunning`은 PID 파일이 없으면 즉시 `running: false`를 반환한다. PID 파일이 없어도 포트에서 Vync 서버가 발견되면 PID 파일을 복구하고 `running: true`를 반환하도록 한다.

```typescript
// tools/cli/open.ts — isServerRunning 함수
// Before:
async function isServerRunning(): Promise<{ running: boolean; info: ServerInfo | null }> {
  const info = await readServerInfo();
  if (!info) return { running: false, info: null };
  // ... PID check, health check ...
}

// After:
async function isServerRunning(): Promise<{ running: boolean; info: ServerInfo | null }> {
  const info = await readServerInfo();

  if (info) {
    // Check if process is alive
    try {
      process.kill(info.pid, 0);
    } catch {
      await fs.unlink(PID_FILE).catch(() => {});
      // Fall through to port probe below
      return probePort();
    }

    // Health check
    try {
      const res = await fetch(`http://localhost:${info.port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.version === 2) return { running: true, info };
        // Old server -> stop it
        await vyncStop();
        return { running: false, info: null };
      }
    } catch {}

    // PID alive but HTTP dead -> stale
    await fs.unlink(PID_FILE).catch(() => {});
    return { running: false, info: null };
  }

  // No PID file — probe port as fallback
  return probePort();
}

async function probePort(): Promise<{ running: boolean; info: ServerInfo | null }> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return { running: false, info: null };
    const body = await res.json();
    if (body.version !== 2) return { running: false, info: null };

    // Recover PID file from health response
    const recoveredInfo: ServerInfo = {
      version: 2,
      pid: body.pid,
      mode: 'daemon',  // best guess
      port: PORT,
    };
    await writeServerInfo(recoveredInfo);
    console.log(`[vync] Discovered existing server (PID ${body.pid}), recovered PID file.`);
    return { running: true, info: recoveredInfo };
  } catch {
    return { running: false, info: null };
  }
}
```

**Step 2: 테스트 작성**

```typescript
// tools/cli/__tests__/open.test.ts — 추가
describe('probePort', () => {
  // probePort는 private이므로 isServerRunning을 통해 간접 테스트
  // 실제 서버 없이 테스트하기 어려우므로 통합 테스트로 검증
});
```

주의: `probePort`는 실제 네트워크 호출이므로 유닛 테스트보다 수동 E2E로 검증한다.

**Step 3: 기존 테스트 실행**

Run: `npx vitest run tools/cli/__tests__/open.test.ts --reporter=verbose`
Expected: 기존 10개 테스트 모두 PASS

**Step 4: Commit**

```bash
git add tools/cli/open.ts
git commit -m "fix(cli): add port probe fallback when PID file is missing"
```

---

### Task 4: `runElectron`에 `registerFile` 추가 (비대칭 해소)

**Files:**
- Modify: `tools/cli/open.ts:193-215` (runElectron의 폴링 성공 후)

**Step 1: runElectron 폴링 성공 시 registerFile + openBrowser 추가**

`runDaemon`(line 282-284)과 동일하게 health check 성공 후 `registerFile`과 `openBrowserWithFile`을 호출한다.

```typescript
// tools/cli/open.ts — runElectron 폴링 루프 내
// Before (line 203-208):
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        console.log(`[vync] Vync app running (PID ${childPid})`);
        console.log(`[vync] Log: ${LOG_FILE}`);
        return;
      }
    } catch {

// After:
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        const body = await res.json();
        // Verify this is our server, not a ghost
        if (body.pid !== childPid) {
          // Ghost server detected — reuse it instead
          console.log(`[vync] Existing server found (PID ${body.pid}), reusing.`);
          await writeServerInfo({ version: 2, pid: body.pid, mode: 'daemon', port: PORT });
        } else {
          console.log(`[vync] Vync app running (PID ${childPid})`);
        }
        // Register file (same as runDaemon)
        await registerFile(PORT, resolved);
        console.log(`[vync] Log: ${LOG_FILE}`);
        return;
      }
    } catch {
```

핵심 변경:
- `body.pid !== childPid` 비교로 고스트 서버 오인 방지 (Task 1의 health pid에 의존)
- 고스트 서버일 경우 PID 파일을 실제 서버 PID로 교정
- `registerFile` 호출 추가 (runDaemon과 동일)
- `openBrowserWithFile`은 Electron 모드에서는 불필요 (Electron이 자체 윈도우를 관리)

**Step 2: 기존 테스트 실행**

Run: `npx vitest run --reporter=verbose`
Expected: 전체 PASS

**Step 3: Commit**

```bash
git add tools/cli/open.ts
git commit -m "fix(cli): add registerFile to runElectron, verify server identity"
```

---

### Task 5: 통합 E2E 검증

**Files:** 없음 (수동 검증)

**Step 1: 시나리오 A — 정상 시작 (regression 없음)**

```bash
node bin/vync.js stop 2>/dev/null  # 기존 서버 정리
node bin/vync.js open project-status
# Expected: 서버 시작 + 브라우저 열림
node bin/vync.js stop
```

**Step 2: 시나리오 B — 고스트 서버 + vync open (핵심 시나리오)**

```bash
# 서버를 foreground로 시작 (PID 파일 있음)
node bin/vync.js open some-file --foreground &
FOREGROUND_PID=$!

# PID 파일 삭제 (고스트 상태 시뮬레이션)
rm ~/.vync/server.pid

# vync open이 포트 프로브로 기존 서버를 발견하는지 확인
node bin/vync.js open project-status
# Expected: "[vync] Discovered existing server" + 파일 열림

kill $FOREGROUND_PID
```

**Step 3: 시나리오 C — Electron EADDRINUSE recovery**

```bash
# daemon 서버 먼저 시작
node bin/vync.js open some-file --foreground &

# Electron 직접 실행 (EADDRINUSE 발생해야 함)
npx electron dist/electron/main.js .vync/project-status.vync
# Expected: "[vync] Reusing existing server" + 윈도우 열림

kill %1
```

**Step 4: 전체 테스트 실행**

Run: `npx vitest run --reporter=verbose`
Expected: 전체 PASS

**Step 5: Commit (모든 검증 통과 시)**

```bash
git add -A
git commit -m "test: verify server lifecycle recovery scenarios"
```

---

## 변경 요약

| Task | 파일 | 변경량 | 해결하는 문제 |
|------|------|--------|--------------|
| 1 | server.ts | ~1 LOC | health에 pid 추가 (기반) |
| 2 | electron/main.ts | ~25 LOC | Electron EADDRINUSE recovery |
| 3 | cli/open.ts | ~25 LOC | PID 파일 없을 때 포트 프로브 |
| 4 | cli/open.ts | ~10 LOC | runElectron registerFile + identity 검증 |
| 5 | (수동) | 0 LOC | 통합 E2E 검증 |

**총 변경: ~60 LOC, 3개 파일**
