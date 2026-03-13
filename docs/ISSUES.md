# Vync — 이슈 레지스트리

> 발견된 버그와 기술적 문제를 추적한다. 해결되면 상태를 `resolved`로 변경하고 해결 내용을 기록한다.
> 설계 결정은 [DECISIONS.md](./DECISIONS.md), 구현 계획은 [PLAN.md](./PLAN.md) 참조.

---

## 이슈 목록

| ID | 제목 | 심각도 | 상태 | 컴포넌트 | 발견일 |
|----|------|--------|------|----------|--------|
| I-001 | [Sub-agent `.lastread` Write 실패](#i-001) | minor | open | vync-translator | 2026-03-14 |
| I-002 | [PUT /api/sync가 WebSocket 브로드캐스트 안 함](#i-002) | major | resolved | server | 2026-03-14 |
| I-003 | [Electron 모드에서 `vync open` 시 브라우저 중복 열림](#i-003) | minor | resolved | CLI (open.ts) | 2026-03-14 |
| I-004 | [probePort()가 mode를 항상 'daemon'으로 덮어씀](#i-004) | minor | resolved | CLI (open.ts) | 2026-03-14 |

---

## 상태 정의

| 상태 | 설명 |
|------|------|
| `open` | 발견됨, 미착수 |
| `in-progress` | 수정 진행 중 |
| `resolved` | 해결 완료 (해결일 + 방법 기록) |
| `won't-fix` | 수정하지 않기로 결정 (사유 기록) |

## 심각도 정의

| 심각도 | 설명 |
|--------|------|
| `critical` | 데이터 손실 또는 핵심 기능 불가 |
| `major` | 기능 저하, 워크어라운드 존재 |
| `minor` | 불편하지만 기능에 영향 없음 |

---

## 상세

### I-001

**Sub-agent `.lastread` Write 실패**

심각도: `minor` · 상태: `open` · 발견일: 2026-03-14
컴포넌트: `vync-translator` sub-agent / diff pipeline

**현상**:
Sub-agent가 `.vync` 파일 수정 후 `.lastread` 스냅샷 파일을 직접 Write하려 할 때, Claude Code의 Write 도구 안전 장치에 의해 차단됨.

```
Write(/Users/presence/projects/Vync/.vync/roadmap.vync.lastread)
→ Error: File has not been read yet. Read it first before writing to it.
```

**근본 원인**:
1. **직접 원인**: Write 도구는 기존 파일을 덮어쓰려면 먼저 Read해야 하는 안전 장치가 있음. Sub-agent가 `.vync` 파일은 읽었지만 `.lastread` 파일은 읽지 않고 Write 시도.
2. **구조적 원인**: `.lastread` 스냅샷 갱신은 `vync diff` 명령이 `Snapshot updated`로 자동 처리하는 영역. Sub-agent가 이 역할을 직접 수행하려 한 것 자체가 역할 경계 위반.

**영향**:
- `.lastread` 스냅샷이 갱신되지 않아, 다음 `vync diff` 실행 시 이미 확인된 변경이 다시 보고될 수 있음
- `.vync` 파일 자체는 정상 수정됨 — 데이터 손실 없음

**워크어라운드**:
`vync diff <file>` 한 번 실행하면 스냅샷이 동기화됨.

**해결 방향**:
- `agents/vync-translator.md`에 `.lastread` 파일을 직접 조작하지 말라는 명시적 지침 추가
- 또는 MCP 서버 전환 시 스냅샷 관리를 Tool API로 캡슐화하여 구조적으로 방지

---

### I-002

**PUT /api/sync가 WebSocket 브로드캐스트 안 함**

심각도: `major` · 상태: `resolved` · 발견일: 2026-03-14 · 해결일: 2026-03-14
컴포넌트: `tools/server/server.ts` (PUT /api/sync 핸들러)

**현상**:
브라우저 A가 캔버스 편집 → PUT /api/sync → 서버가 디스크에 쓰기 → chokidar가 감지하지만 `isWriting=true`로 에코 방지됨 → 다른 클라이언트(B)에 브로드캐스트 안 됨. 멀티 탭/멀티 윈도우 환경에서 편집이 다른 클라이언트에 반영되지 않음.

**근본 원인**:
PUT 핸들러가 `sync.writeFile()` 후 `res.json({ ok: true })`만 반환. chokidar 경로는 에코 방지(isWriting=true + hash 일치)로 항상 억제됨. 결과적으로 PUT으로 들어온 변경이 어떤 WS 클라이언트에도 전달되지 않음.

**해결**:
PUT 핸들러에서 `sync.writeFile()` 후 `registry.broadcastToFile(filePath, { type: 'file-changed', filePath, data })` 추가. PUT 클라이언트는 `remoteUpdateUntilRef` 메커니즘으로 수신 무시 (에코 방지).

---

### I-003

**Electron 모드에서 `vync open` 시 브라우저 중복 열림**

심각도: `minor` · 상태: `resolved` · 발견일: 2026-03-14 · 해결일: 2026-03-14
컴포넌트: `tools/cli/open.ts` (vyncOpen)

**현상**:
Electron 서버가 실행 중일 때 `vync open <file2>` 호출 시 파일 등록 후 시스템 브라우저도 열림. Electron 내에서 Hub WS로 탭이 자동 추가되므로 브라우저 열기는 불필요.

**근본 원인**:
`vyncOpen()`에서 서버가 이미 실행 중일 때 `info?.mode`를 확인하지 않고 항상 `openBrowserWithFile()` 호출.

**해결**:
`info?.mode !== 'electron'` 조건 추가. Electron 모드이면 파일 등록만 하고 브라우저 열기 생략.

---

### I-004

**probePort()가 mode를 항상 'daemon'으로 덮어씀**

심각도: `minor` · 상태: `resolved` · 발견일: 2026-03-14 · 해결일: 2026-03-14
컴포넌트: `tools/cli/open.ts` (probePort)

**현상**:
Electron 서버 실행 중 PID 파일이 없거나 stale일 때, `probePort()`가 포트에서 서버를 발견하면 PID 파일을 `mode: 'daemon'`으로 항상 복구. 이로 인해 Electron 서버임에도 `mode: 'daemon'`으로 기록됨.

**근본 원인**:
`probePort()`의 recoveredInfo에서 `mode: 'daemon'`으로 하드코딩.

**해결**:
`readServerInfo()`로 기존 PID 파일의 mode를 읽어서 보존. 기존 PID 파일이 없으면 `'daemon'` 기본값 사용.

---
