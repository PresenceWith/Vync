# Vync — 구현 계획

> Phase별 작업 목록과 완료 기준. 현재 진행 상태를 추적한다.
> 설계 근거는 [DECISIONS.md](./DECISIONS.md), 시스템 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md) 참조.

---

## 현재 상태

**Phase**: 8 완료 (멀티 파일 Hub Server 1단계) — 2026-03-09

---

## Phase 1: Drawnix 포크 + 데이터 모델 파악

**목표**: Drawnix를 로컬에서 실행하고 PlaitElement[] 데이터 모델을 완전히 이해한다.

- [x] 1.1 Drawnix 저장소 포크 및 로컬 실행 확인
- [x] 1.2 PlaitElement[] JSON 구조 분석 (마인드맵, 플로우차트, 자유 캔버스 각각)
- [x] 1.3 기존 저장/불러오기 메커니즘 코드 파악 (localforage 위치, 교체 방법)
- [x] 1.4 Plait board 업데이트 API 조사 (외부에서 데이터 주입 가능 여부)
- [x] 1.5 markdown-to-drawnix / mermaid-to-drawnix 동작 확인
  - MVP에서 사용하지 않지만 (→ D-003), 데이터 모델 파악의 일환으로 변환기 출력 구조를 확인하여 PlaitElement[] 이해를 심화
- [x] 1.6 데이터 모델 문서화 → ARCHITECTURE.md 섹션 4 업데이트
- [x] 1.7 AI 편집 난이도 평가 (쉬운 필드 vs 어려운 필드 분류) → ARCHITECTURE.md §7

**완료 기준**:
- Drawnix가 로컬에서 정상 실행됨
- PlaitElement[] 구조가 문서화됨
- AI 편집 난이도가 평가됨 (JSON 직접 편집 단일 경로 유지 여부 판단)

**결정 시점**:
- Drawnix 포크 전략 확정 (→ Q-001)
- Plait v0.92.1 API 안정성 평가
- JSON 직접 편집이 AI에게 너무 어려우면 변환 파이프라인 재검토 (→ D-003)

---

## Phase 2: 파일 동기화 레이어

**목표**: 파일 ↔ 웹 양방향 동기화의 기본 골격을 구현한다.
**의존**: Phase 1 완료 (1.2, 1.3, 1.4 필수 — 데이터 모델과 저장 메커니즘 이해 후)

- [x] 2.1 Custom Node Server 설정 (HTTP + WS + chokidar + Vite middleware, 단일 프로세스)
  - [x] 2.1.1 server.ts 진입점 작성 (http.createServer + express + Vite middleware mode)
  - [x] 2.1.2 WS 서버를 HTTP 서버에 마운트 (ws 라이브러리, noServer 모드 + /ws 경로)
  - [x] 2.1.3 개발 모드 HMR과 동기화 WS 공존 확인 (Vite HMR은 별도 내부 WS, 동기화는 /ws 경로)
- [x] 2.2 API Route: GET/PUT /api/sync (파일 읽기/쓰기)
- [x] 2.3 chokidar 파일 감시 서비스
- [x] 2.4 WebSocket 서버 (변경 알림 채널)
- [x] 2.5 프론트엔드 WebSocket 클라이언트 → Plait board 업데이트

**완료 기준**:
- Custom Server가 :3100에서 실행됨
- 파일 변경 시 WebSocket 알림이 발송됨
- 프론트엔드가 WebSocket 수신 후 board 갱신

---

## Phase 3: 양방향 동기화 완성

**목표**: 안정적인 양방향 동기화를 완성한다.
**의존**: Phase 2 완료 (2.1~2.5 모두 필수)

- [x] 3.1 웹 UI onChange → 디바운싱(300ms) → PUT /api/sync → 파일 저장
- [x] 3.2 localforage 저장소 → API Route 호출로 교체 (syncMode 시 API, 아닐 때 localforage fallback)
- [x] 3.3 에코 방지 메커니즘 구현 (content hash)
  - [x] 3.3.1 SHA-256 해시 유틸리티 (packages/shared/src/hash.ts)
  - [x] 3.3.2 쓰기 시 해시 저장 로직
  - [x] 3.3.3 chokidar 감지 시 해시 비교 로직
  - [x] 3.3.4 Race condition 처리 (isWriting 플래그, → ARCHITECTURE.md §6.1)
- [x] 3.4 원자적 파일 쓰기 (tmp + rename)
- [x] 3.5 JSON 유효성 검증 (파싱 실패 시 이전 상태 유지)
- [x] 3.6 에러 핸들링 (PUT 입력 검증, 파일 읽기 fallback, WebSocket 에러 핸들링)

**완료 기준**:
- 웹 편집 → 파일 자동 저장
- 외부 편집 → 웹 자동 갱신 (조용히, → D-007)
- 에코 루프 없음
- JSON 파싱 실패 시 크래시 없음

---

## Phase 4: CLI 도구 + Claude Code 통합 플러그인

**목표**: CLI로 파일 관리, Claude Code 플러그인으로 .vync 편집의 전체 라이프사이클 관리.
**의존**: Phase 3 완료
**설계**: `docs/plans/2026-03-07-phase4-claude-plugin-design.md`
**구현**: `docs/plans/2026-03-07-phase4-implementation.md`

- [x] 4.1 `vync init <file>` — 빈 캔버스 .vync 파일 생성 (tools/cli/init.ts + tests)
- [x] 4.2 `vync open <file>` + `vync stop` — server.ts 리팩토링 (startServer export, VYNC_HOME) + bin/vync.js CLI 진입점 + PID 관리 (~/.vync/server.pid)
- [x] 4.3 Claude Code Skill (vync-editing) — SKILL.md + references (mindmap, geometry, arrow-line, coordinates)
- [x] 4.4 .vync.schema.json + validate.js + generate-id.js — JSON Schema + 자동 검증 스크립트
- [x] 4.5 examples/*.vync — 마인드맵, 플로우차트 예시 파일
- [x] 4.6 Slash Commands — /vync (CLI wrapper), /vync-create (편집 진입점)
- [x] 4.7 Hooks — PostToolUse 자동 검증 + SessionEnd 서버 정리
- [x] 4.8 install.sh / uninstall.sh — 전역 설치/제거 (심볼릭 링크 + settings.json 머지)

**완료 기준**:
- `vync init plan.vync` → 빈 캔버스 파일 생성됨
- `vync open plan.vync` → 서버 시작 + 브라우저에서 캔버스 렌더링됨
- Claude Code Skill이 .vync 편집을 가이드할 수 있음
- PostToolUse hook이 .vync 파일 쓰기 시 자동 검증

---

## Phase 5: E2E 검증

**목표**: 전체 루프가 안정적으로 동작함을 검증한다.
**의존**: Phase 3, Phase 4 완료

- [x] 5.1 웹에서 도형 편집 → .vync 파일 자동 저장 확인 (syncModeRef 수정 후 동작)
- [x] 5.2 외부에서 .vync 파일 수정 → 웹 자동 갱신 확인 (WebSocket 즉시 반영)
- [x] 5.3 Claude Code가 .vync JSON 편집 → 웹 반영 확인 (shape 변경 실시간 반영)
- [x] 5.4 웹에서 편집한 내용을 Claude Code가 읽기 확인
- [x] 5.5 빠른 연속 편집(10회) → 에코 루프 없음 확인 (에코 0회)
- [x] 5.6 전체 루프 반영 시간 측정 (~0.6초, 기준 3초 이내)
- [x] 5.7 JSON 파싱 실패 시나리오 테스트 (이전 상태 유지, 크래시 없음)

**완료 기준 (= MVP 성공 기준)**:
- [x] `vync init` / `vync open` 동작
- [x] 웹 UI에서 노드 추가/이동/삭제 → .vync 파일 자동 저장
- [x] 외부에서 .vync 파일 수정 → 웹 UI 자동 갱신 (→ D-007: 시각적 알림 없이)
- [x] Claude Code가 CLAUDE.md 기반으로 .vync JSON 편집 가능
- [x] 전체 루프 3초 이내 (로컬 SSD 기준, 1KB .vync 파일) — 실측 ~0.6초
- [x] 10회 연속 편집-저장 사이클에서 에코 트리거 0회
- [x] JSON 파싱 실패 시 이전 상태 유지, 서버 크래시 없음

---

## Phase 6: Electron 데스크톱 앱

**목표**: Vync를 Electron으로 감싸서 네이티브 데스크톱 앱처럼 동작하게 한다 (.vync 더블클릭 → 앱 열림, 창 닫기 → 자동 종료).
**의존**: Phase 5 완료
**설계**: `docs/plans/2026-03-08-electron-desktop-design.md`
**구현**: `docs/plans/2026-03-08-electron-implementation.md`

- [x] 6.1 서버 리팩토링 — process.exit 제거, 시그널 핸들러 분리, 설정 가능 포트, EADDRINUSE 처리 (→ D-012)
- [x] 6.2 조건부 Vite import + 프로덕션 정적 서빙 (dev: Vite middleware, prod: express.static)
- [x] 6.3 WebSocket 클라이언트 종료 수정 (shutdown 시 client.terminate())
- [x] 6.4 Electron 의존성 + 빌드 스크립트 (dev:desktop, build:desktop, package:desktop)
- [x] 6.5 Electron main process (단일 인스턴스, macOS open-file, 파일 피커, dev/prod 모드)
- [x] 6.6 Electron preload script (window.vyncDesktop 플래그)
- [x] 6.7 electron-builder 설정 (macOS DMG, .vync 파일 연결)
- [x] 6.8 CLI → Electron 스폰 + 데몬 폴백 (dist/electron/main.js 없으면 tsx daemon)
- [x] 6.9 Analytics 게이팅 (Electron에서 Umami 비활성화)
- [x] 6.10 E2E 검증 (dev 모드 실행, CLI 스폰, vync stop, 데몬 폴백)

**완료 기준**:
- [x] Electron 앱이 .vync 파일을 열고 서버를 in-process로 실행
- [x] `vync open`이 Electron 앱을 spawn (폴백: 기존 tsx daemon)
- [x] 창 닫기 → 서버 종료 + 프로세스 종료
- [x] dev 모드에서 Vite HMR 정상 동작

---

## Phase 7: Sub-agent 번역 레이어

**목표**: .vync JSON 편집을 전담 sub-agent에 위임하여 메인 세션의 context window를 보호한다.
**의존**: Phase 4, Phase 6 완료
**설계**: `docs/plans/2026-03-09-subagent-translator-design.md`

- [x] 7.1 Spike 검증 — 커스텀 에이전트 인식, Skill 자동 로드, Prose 반환 검증 (GO 판정)
- [x] 7.2 에이전트 파일 생성 — `.claude-plugin/agents/vync-translator.md`
- [x] 7.3 커맨드 통합 — `/vync` 하나의 진입점으로 create/read/update 통합
- [x] 7.4 deprecated 제거 — `/vync-create` 삭제
- [x] 7.5 Install script 업데이트 — 에이전트 심볼릭 링크 + deprecated 정리
- [x] 7.6 E2E 검증 — create → read → update 전체 흐름 (general-purpose 시뮬레이션)
- [x] 7.7 문서 업데이트 — D-013 등록, ARCHITECTURE.md, PLAN.md, CLAUDE.md

**완료 기준**:
- [x] vync-translator sub-agent가 create/read/update 작업 수행 가능
- [x] 메인 세션이 prose만 교환하여 context window 보호

### 7-P1: Diff-Aware Read

**목표**: `/vync read` 시 마지막 읽기 이후 변경사항을 diff로 보고하여 "무엇이 바뀌었는지" 인식 가능하게 한다.
**설계**: `docs/plans/2026-03-09-diff-aware-read.md`

- [x] 7-P1.1 `.gitignore`에 `*.lastread` 추가
- [x] 7-P1.2 vync-translator 에이전트 Read 절차에 스냅샷 비교 로직 추가
- [x] 7-P1.3 vync 커맨드 Read 섹션에 diff 컨텍스트 반영
- [x] 7-P1.4 설계문서 데이터 흐름 업데이트
- [x] `/vync create` → sub-agent → 한 줄 요약 반환 흐름 동작
- [x] Install script가 에이전트 파일을 `~/.claude/agents/`에 설치

---

## Phase 8: 멀티 파일 Hub Server (1단계)

**목표**: 단일 서버(:3100)가 여러 `.vync` 파일을 동시에 관리하는 허브 아키텍처로 전환한다.
**의존**: Phase 7 완료
**설계**: `docs/plans/2026-03-09-multi-file-hub-design.md` (→ D-014)
**구현**: `docs/plans/2026-03-09-multi-file-hub-implementation.md`

- [x] 8.1 공유 타입 확장 — WsMessage에 filePath, file-closed, file-deleted, error 추가
- [x] 8.2 보안 레이어 — validateFilePath (allowlist + .vync 확장자 + realpath) + hostGuard
- [x] 8.3 SyncService drain() — 미완료 쓰기 큐 flush (graceful unregister 지원)
- [x] 8.4 FileWatcher unlink 이벤트 — 파일 삭제 감지 + 자동 unregister
- [x] 8.5 FileRegistry — 핵심 추상화 (register/unregister/getSlot + 동기적 슬롯 확보 + idle timeout)
- [x] 8.6 WebSocket 핸들러 — 파일 스코프 라우팅 (`?file=` 파라미터)
- [x] 8.7 서버 Hub 모드 리팩토링 — startServer() → FileRegistry 기반, API 엔드포인트 변경
- [x] 8.8 CLI — PID JSON 포맷 + 2-state open + close 커맨드
- [x] 8.9 프론트엔드 — FileBoard 컴포넌트 추출 + `?file=` URL 파라미터 지원
- [x] 8.10 Electron — register 방식 전환 (restart → POST /api/files)
- [x] 8.11 Hooks — SessionEnd 변경 (kill → DELETE /api/files?all=true)
- [x] 8.12 /vync 커맨드 문서 — close 서브커맨드 추가
- [x] 8.13 통합 테스트 — 멀티 파일 E2E (2개 파일 동시 등록/편집/해제)
- [x] 8.14 문서 업데이트 — ARCHITECTURE.md, PLAN.md, CLAUDE.md
- [x] 8.15 전체 테스트 + 검증

**완료 기준**:
- [x] `vync open A.vync` + `vync open B.vync` → 두 파일 동시 접근 가능
- [x] 각 브라우저 탭에서 `?file=` 파라미터로 다른 파일 표시
- [x] 파일별 독립 WebSocket 브로드캐스트 (A 편집이 B에 영향 없음)
- [x] `vync close A.vync` → A만 해제, B는 유지
- [x] 서버가 0개 파일일 때 자동 종료하지 않음 (idle timeout 30분 후 자동 해제)

> **2단계 (멀티 탭 UI)**: 1단계 완료 후 계획 문서를 동기화하고 별도 Phase로 진행. 설계 미리보기는 `docs/plans/2026-03-09-multi-file-hub-design.md` §Stage 2 참조.

---

## 리스크

| 리스크 | 영향 | 완화 방안 | 평가 시점 |
|--------|------|----------|----------|
| Drawnix가 초기 프로젝트라 API 불안정 | 높음 | Plait 직접 사용으로 Fallback | Phase 1 |
| PlaitElement[] JSON이 AI 편집에 복잡 | **평가 완료** | 마인드맵/도형은 용이, ArrowLine 바인딩은 어려움. CLAUDE.md + Schema로 충분히 완화 가능 → D-003 유지 (ARCHITECTURE.md §7) | Phase 1 |
| 양방향 동기화 시 데이터 손실 | **해소** | 원자적 쓰기(tmp+rename) + SHA-256 content hash + isWriting 플래그 + JSON 유효성 검증 + lastValidContent fallback 구현 완료 | Phase 3 |
| Custom Server에서 HMR과 WS 충돌 | **해소** | Vite HMR은 내부 WS 사용, 동기화 WS는 독립 경로 /ws — 충돌 없음 | Phase 1에서 확인 |
| 대용량 .vync 파일에서 SHA-256 해싱 지연 | 낮음 | 일반 사용 시 파일 크기 소규모 예상. 병목 시 incremental hash 검토 | Phase 3 (구현 완료, 성능 문제 미발견) |
| AI가 잘못된 PlaitElement JSON 생성 | **검증 완료** | JSON Schema 검증 + Skill 예시로 충분히 완화. Phase 5 E2E에서 Claude Code의 shape 변경/요소 추가 정상 반영 확인 → D-003 유지 | Phase 4 (Phase 5에서 검증) |
| chokidar가 빠른 연속 변경 시 이벤트 누락 | 낮음 | 디바운싱으로 완화. 누락 시 polling fallback 검토 | Phase 3 (awaitWriteFinish 300ms 설정 완료) |
| Agent tool 커스텀 에이전트 미작동 | **해소** | Spike 검증 완료: 커스텀 에이전트 인식(V1), Skill 자동 로드(V3), Prose 반환(V5) 모두 PASS. PostToolUse hook은 sub-agent에서 미발동(V4) → 명시적 validate.js 호출로 해결 | Phase 7 Spike (2026-03-09) |

---

## 미결 질문 (구현 시 결정)

| ID | 질문 | 비고 | 결정 시점 |
|----|------|------|----------|
| Q-001 | Drawnix 포크 세부 전략 (전체 복사 vs submodule) | **해결**: 전체 복사 전략 채택. upstream remote으로 cherry-pick 가능 | Phase 1.1 |
| Q-002 | WebSocket 메시지 포맷 (전체 파일 vs diff) | **해결**: 전체 파일 전송 채택. `{ type: 'file-changed', data: VyncFile }` 포맷. 파일 크기가 소규모이므로 diff 불필요 | Phase 2.4 |
| Q-003 | Plait board 업데이트 API 존재 여부 | **해결**: `<Wrapper>` value prop 변경 시 자동 갱신 + NodeTransforms API 존재 | Phase 1.4 |
| Q-004 | Custom Server에서 HMR + WS 공존 방법 | **해결**: Vite HMR은 내부 WS 사용, 동기화 WS는 독립 `ws` 라이브러리로 /ws 경로에 마운트. 서로 독립적이라 충돌 없음 | Phase 2.1 |
| Q-005 | PlaitElement의 ID 생성 규칙 (UUID? nanoid?) | **해결**: `idCreator(5)` — 커스텀 5자 랜덤 문자열 (ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz) | Phase 1.2 |
