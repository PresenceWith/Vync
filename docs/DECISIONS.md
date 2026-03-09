# Vync — 설계 결정 레지스트리

> 확정된 모든 설계 결정을 번호로 추적한다. 각 결정은 대안과 근거를 포함한다.
> 새 결정이 추가되면 번호를 부여하고, 변경 시 이력을 남긴다.

---

## 결정 목록

| ID | 결정 | 상태 | 결정일 |
|----|------|------|--------|
| D-001 | [프로젝트 범위: MVP](#d-001) | 확정 | 2026-03-07 |
| D-002 | [기반 전략: Drawnix 포크](#d-002) | 확정 | 2026-03-07 |
| D-003 | [AI 편집 경로: JSON 직접 편집](#d-003) | 확정 | 2026-03-07 |
| D-004 | [서버 아키텍처: Custom Node Server + Vite Middleware](#d-004) | **변경** | 2026-03-07 (변경: 2026-03-08) |
| D-005 | [파일 포맷: 래핑된 JSON](#d-005) | 확정 | 2026-03-07 |
| D-006 | [파일 관리 UX: CLI 중심](#d-006) | 확정 | 2026-03-07 |
| D-007 | [변경 알림: 조용히 자동 반영](#d-007) | 확정 | 2026-03-07 |
| D-008 | [충돌 해결: Last Write Wins](#d-008) | 확정 | 2026-03-07 |
| D-009 | [에코 방지: Content Hash](#d-009) | 확정 | 2026-03-07 |
| D-010 | [MCP 서버: MVP 제외](#d-010) | 확정 | 2026-03-07 |
| D-011 | [패키지 매니저: npm](#d-011) | **변경** | 2026-03-07 (변경: 2026-03-08) |
| D-012 | [데스크톱 앱: Electron Thin Shell](#d-012) | 확정 | 2026-03-08 |
| D-013 | [AI 편집 위임: Sub-agent 번역 레이어](#d-013) | 확정 | 2026-03-09 |
| D-014 | [멀티 파일: Hub Server](#d-014) | 확정 | 2026-03-09 |

---

## 상세

### D-001

**프로젝트 범위: MVP (실사용 가능)**

PoC가 아닌 MVP 수준. 실제로 Claude Code와 함께 계획 수립에 사용할 수 있는 도구.

**포함**: CLI 도구, 안정적 양방향 파일 동기화, 에러 핸들링, AI 편집 지원 (CLAUDE.md + Schema + 예시)
**제외**: 패키징/배포, 다중 사용자, 문서화 사이트, MCP 서버, AI Agent 파이프라인

**근거**: "자기 자신이 실제로 쓸 수 있는 도구"가 적절한 목표. PoC는 버려지기 쉽고, 프로덕트 수준은 과도.

**재검토 조건**: 사용 패턴에 따라 MVP 범위 확대/축소 필요 시

---

### D-002

**기반 전략: Drawnix 포크 + 수정**

Drawnix 저장소를 포크하여 저장 메커니즘만 교체한다.

| 대안 | 기각 사유 |
|------|----------|
| Plait 직접 사용 (자체 앱) | UI를 처음부터 구축해야 하여 개발 시간 2~3배 |
| Drawnix를 컴포넌트로 임베드 | 외부 데이터 주입 API 존재 불확실, 통합 복잡 |

**수정 범위**: localforage(IndexedDB) → 파일 API, WebSocket 레이어 추가, Custom Node Server, 불필요 기능 비활성화
**Fallback**: Drawnix가 요구에 맞지 않으면 Plait 직접 사용으로 전환

**재검토 조건**: Phase 1에서 Drawnix API 안정성이 불충분할 때

---

### D-003

**AI 편집 경로: PlaitElement[] JSON 직접 편집 (단일 경로)**

AI(Claude Code)는 .vync 파일의 PlaitElement[] JSON을 직접 읽고 수정한다. Markdown/Mermaid 변환 파이프라인은 MVP에서 제외.

| 대안 | 기각 사유 |
|------|----------|
| 소스 파일 기반 (.md → 변환) | 웹 UI 편집의 소스 역변환이 기술적으로 매우 어려움 |
| 하이브리드 (생성은 .md, 수정은 JSON) | 복잡성 증가, AI에게 두 모드 안내 필요 |

**장점**: 양방향 완전 호환, 단일 파일로 동기화 단순, 충돌 해결 간단
**도전**: JSON 복잡성 → CLAUDE.md + JSON Schema + 예시로 완화
**재검토 조건**: Phase 1에서 PlaitElement[] 복잡도 평가 후 변환 파이프라인 필요성 재평가

---

### D-004

**서버 아키텍처: Custom Node Server + Vite Middleware Mode (단일 프로세스)**

> **변경 이력**: 2026-03-08 — "Next.js Custom Server" → "Custom Node Server + Vite Middleware Mode"로 변경. Phase 1에서 Drawnix가 **Vite 6 + React** 기반임을 확인 (Next.js 사용하지 않음). D-004의 핵심 원칙(단일 프로세스, 단일 포트)은 유지하되 구현 기술을 변경.

HTTP + WebSocket + chokidar를 단일 Custom Node Server 프로세스(:3100)에 통합. 개발 모드에서는 Vite를 미들웨어 모드로 마운트하여 HMR 제공, 프로덕션에서는 정적 파일 서빙.

```
┌─ Custom HTTP Server (:3100) ──┐
│  ├─ ws (WebSocket)            │  ← 동기화 알림
│  ├─ chokidar                  │  ← 파일 감시
│  ├─ /api/sync                 │  ← REST API
│  ├─ Vite middleware (dev)     │  ← HMR + 에셋
│  └─ sirv/static (prod)        │  ← 빌드된 파일
└───────────────────────────────┘
```

| 대안 | 기각 사유 |
|------|----------|
| Vite Plugin (`configureServer`) | `configureServer`는 dev 전용 — 프로덕션에서 동작하지 않아 두 개의 코드 경로 필요 |
| 별도 Node.js 서버 (포트 분리) | 두 프로세스 관리, CORS/proxy 설정, CLI 복잡성 증가 |
| Next.js Custom Server | Drawnix가 Vite 기반 — Next.js 전환은 비용만 크고 이점 없음 (SSR 불필요) |
| Electron (서버 대체) | ~~배포 복잡성 극대화, 로컬 웹앱으로 충분~~ → Phase 6에서 Electron을 "thin shell"로 채택 (→ D-012). 서버 아키텍처(D-004)는 유지하되 Electron이 감싸는 구조. |

**근거**: 로컬 전용 도구이므로 단일 프로세스 = 단일 포트 = 단순한 UX. `vync open` 한 번으로 모든 것 시작. WS/API/chokidar 코드가 dev/prod에서 100% 동일한 코드 경로를 사용.
**트레이드오프**: express 의존성 추가, Vite middleware mode 학습 필요 (잘 문서화됨)

**재검토 조건**: 단일 프로세스에서 성능 병목(CPU/메모리) 발생 시

---

### D-005

**파일 포맷: 래핑된 JSON (.vync)**

```json
{
  "version": 1,
  "viewport": { "zoom": 1, "x": 0, "y": 0 },
  "elements": []
}
```

- `version`: 향후 포맷 마이그레이션 지원
- `viewport`: 마지막 뷰 상태 복원
- `elements`: PlaitElement[] — Plait 데이터 모델과 직접 호환

| 대안 | 기각 사유 |
|------|----------|
| 네이키드 PlaitElement[] | 메타데이터(version, viewport) 넣을 곳 없음 |
| YAML 포맷 | JSON 대비 파싱 복잡, Plait 출력이 JSON |
| SQLite | 텍스트 편집기/AI 편집 불가, 바이너리 |

**후속 확장 (P2)**: `version: 2`로 변경 추적 메타데이터(`lastModified`, `lastModifiedBy`) 추가 가능. → [FUTURE.md §4-1](./FUTURE.md) 참조

**재검토 조건**: 포맷 호환성 문제 발생 시 (버전 마이그레이션 필요 등), 또는 세션 간 변경 출처 추적이 필요할 때

---

### D-006

**파일 관리 UX: CLI 중심**

```bash
$ vync init plan             # CWD/.vync/plan.vync 생성
$ vync open plan             # .vync/plan.vync 서버 시작 + 브라우저 열기
```

bare filename은 `CWD/.vync/` 하위에 저장 (`.git/`, `.vscode/`와 같은 관례). 명시적 상대/절대 경로는 그대로 해석.

웹 UI에는 파일 목록, 사이드바, 프로젝트 탐색기 없음. 순수 캔버스 에디터.

**근거**: 사용자가 이미 터미널에서 Claude Code와 작업 중이므로 CLI가 자연스러운 진입점.

**재검토 조건**: 웹 UI에서 파일 관리 필요성이 반복적으로 발생 시

---

### D-007

**변경 알림: 조용히 자동 반영**

외부에서 파일이 변경되면 알림 없이 자동으로 캔버스를 업데이트.

**"조용히" 정의**: 토스트/다이얼로그/배너 등 시각적 알림 UI 없이 자동 반영. 서버 콘솔 로그에는 변경 이벤트를 기록한다.

| 대안 | 기각 사유 |
|------|----------|
| 토스트 + 자동 반영 | AI 빈번 수정 시 토스트가 스팸 |
| 확인 팝업 | 작업 흐름 방해, AI 협업에서 최악의 UX |

**근거**: Google Docs처럼 자연스러운 실시간 경험.

**재검토 조건**: 사용자가 의도치 않은 변경을 인지하지 못하는 문제가 빈번히 발생 시

---

### D-008

**충돌 해결: Last Write Wins**

가장 마지막에 저장된 내용이 우선. 복잡한 머지 로직 없음.

**"마지막" 정의**: 파일 시스템 타임스탬프(mtime) 기준이 아닌, 서버 프로세스에 도착한 순서 기준. 동일 프로세스 내 단일 쓰기 큐에서 순차 처리하므로 도착 순서가 곧 쓰기 순서.

| 대안 | 기각 사유 |
|------|----------|
| OT (Operational Transform) | 구현 복잡성 극대화, 단일 사용자 시나리오에 과도 |
| CRDT | OT와 동일, 라이브러리 의존성 추가 |
| 3-way merge | 기반 버전 관리 필요, 구현 복잡 |
| 수동 충돌 해결 UI | UX 방해, AI 협업에서 부적합 |

**근거**: MVP에서는 단순함 우선. 실사용에서 충돌 빈도가 높으면 후속 개선.

**재검토 조건**: 실사용에서 데이터 손실이 반복 발생 시 (충돌로 인한 작업 유실)

---

### D-009

**에코 방지: Content Hash (SHA-256)**

서버가 파일을 쓸 때 내용의 해시를 저장. chokidar가 변경 감지 시 해시 비교로 자체 쓰기를 식별.

**근거**: 타이밍 독립적, 신뢰성 높음. 감시 일시 중지 방식보다 안정적.

**재검토 조건**: SHA-256 해시 계산이 대용량 파일에서 성능 병목이 될 때

---

### D-010

**MCP 서버: MVP 제외**

Claude Code는 이미 Read/Write/Edit으로 .vync JSON을 편집할 수 있으므로, MCP 없이도 핵심 가치 전달 가능.

MCP 서버(구조화된 AI 조작 + 피드백 루프)는 MVP 이후 확장으로 배치. → [FUTURE.md](./FUTURE.md) 참조

---

### D-011

**패키지 매니저: npm**

> **변경 이력**: 2026-03-08 — "pnpm" → "npm"으로 변경. Phase 1에서 Drawnix가 **npm + nx monorepo** 구성임을 확인 (package-lock.json 존재, pnpm-workspace.yaml 없음). 기존 빌드 체인을 유지하여 불필요한 마이그레이션을 방지.

Drawnix가 npm + nx monorepo를 사용하므로 그대로 유지.

| 대안 | 기각 사유 |
|------|----------|
| pnpm | Drawnix의 npm + nx 설정을 pnpm으로 재구성 필요, 이점 불명확 |
| yarn | 동일하게 재구성 필요, npm 대비 이점 없음 |
| bun | Drawnix/nx 호환성 미검증, 안정성 리스크 |

**재검토 조건**: npm이 의존성 해결이나 빌드 속도에서 병목이 될 때

---

### D-012

**데스크톱 앱: Electron Thin Shell (in-process server + BrowserWindow)**

Electron main process가 `startServer()`를 in-process로 호출하고, BrowserWindow가 `http://localhost:3100`을 로드. 개발 모드에서는 Vite middleware, 프로덕션에서는 `express.static`.

```
Electron main process
  → startServer(filePath, { mode, port, staticDir })
    → Express + WS + chokidar (in-process)
  → BrowserWindow → http://localhost:<port>
  → 창 닫기 → shutdown() → app.quit()
```

| 대안 | 기각 사유 |
|------|----------|
| Tauri | Drawnix가 Node.js 서버(Express + WS + chokidar) 의존 — Rust 백엔드로 재구현 필요 |
| 별도 프로세스 (Electron + 외부 서버) | 프로세스 관리 복잡, 서버가 경량이므로 in-process가 적합 |
| PWA | 파일 연결(더블클릭 → 앱 열림) 불가, 네이티브 느낌 부족 |

**빌드**: esbuild (main.ts → dist/electron/main.js), electron-builder (macOS DMG)
**파일 연결**: `.vync` 확장자 → Vync.app (macOS)
**단일 인스턴스**: `app.requestSingleInstanceLock()`
**CLI 통합**: `vync open`이 Electron spawn, 폴백으로 기존 tsx daemon

**재검토 조건**: 크로스 플랫폼(Windows/Linux) 지원이 필요할 때, 또는 Electron 번들 크기가 문제될 때

---

### D-013

**AI 편집 위임: Sub-agent 번역 레이어 (vync-translator)**

.vync JSON 편집을 전담 sub-agent에 위임하여 메인 세션의 context window를 보호한다.

```
메인 세션 (prose) ↔ vync-translator sub-agent ↔ .vync JSON ↔ 브라우저
```

- **커스텀 에이전트**: `.claude-plugin/agents/vync-translator.md` (model: sonnet, skills: vync-editing)
- **커맨드 통합**: `/vync` 하나의 진입점 (init/open/stop: CLI, create/read/update: sub-agent)
- **Prose 프로토콜**: 메인→Sub: 구조화된 트리 prose, Sub→메인: 한 줄 요약
- **Context 절감**: 2,000~5,000 → ~630 토큰 (3~8x)

| 대안 | 기각 사유 |
|------|----------|
| 메인 세션에서 직접 편집 (기존) | context window 오염, 대화 흐름 단절 |
| general-purpose sub-agent + 반복 프롬프트 | Skill 자동 로드 불가, 매번 프롬프트 전달 비용 |
| MCP 서버 (구조화 API) | MVP 범위 초과, 별도 프로세스 관리 필요 (→ D-010) |

**설계 문서**: `docs/plans/2026-03-09-subagent-translator-design.md`

**재검토 조건**: Claude Code의 에이전트 시스템이 변경되어 커스텀 에이전트 방식이 더 이상 유효하지 않을 때

---

### D-014

**멀티 파일: Hub Server (단일 서버, 다중 파일)**

단일 서버(:3100)가 여러 `.vync` 파일을 동시에 관리하는 허브 아키텍처로 전환한다.

```
vync open A.vync  ─→  POST /api/files  ─→  Hub Server :3100
vync open B.vync  ─→  POST /api/files  ─→       ↓
                                          FileRegistry
                                          ├─ A.vync (SyncService + FileWatcher + WS Clients)
                                          └─ B.vync (SyncService + FileWatcher + WS Clients)
```

| 대안 | 기각 사유 |
|------|----------|
| 멀티 인스턴스 (파일당 서버) | 포트 충돌, Vite 인스턴스 중복, 멀티 탭 UI 불가 |
| 디렉토리 감시 | 파일이 여러 디렉토리에 분산됨. 감시 범위 설정 불가 |
| 파일 식별자로 해시/UUID | 디버깅 어려움. CLI가 서버 없이 URL 구성 불가 |

**핵심 설계 (M-1~M-8)**:
- **M-1**: 허브 서버 — 리소스 효율, 탭+윈도우 모두 지원
- **M-2**: 명시적 파일 등록 (`vync open` → POST /api/files)
- **M-3**: 절대경로를 파일 식별자 (`?file=/path/to/file.vync`)
- **M-4**: 자가복구(auto-register on GET) 제거 — REST 원칙 + LFI 방지
- **M-5**: 하위 호환 폐기 (`?file=` 필수, 암묵적 폴백 없음)
- **M-6**: PID 파일 JSON 포맷 전환 (port 포함, 버전 마커)
- **M-7**: 뷰포트 WebSocket 브로드캐스트 제외 (탭 간 zoom/pan 충돌 방지)
- **M-8**: 보안 — validateFilePath(allowlist + `.vync` 확장자 + realpath) + Host 헤더 검증

**구현**: 2단계 — 1단계: 허브 서버 + 멀티 윈도우, 2단계: 멀티 탭 UI
**설계 문서**: `docs/plans/2026-03-09-multi-file-hub-design.md`
**구현 계획**: `docs/plans/2026-03-09-multi-file-hub-implementation.md`

**재검토 조건**: 단일 서버에서 동시 파일 수가 50개 이상으로 증가하여 성능 병목 발생 시
