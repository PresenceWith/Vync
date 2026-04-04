# Vync Teammate Design — canvas / codex / sync

## 설계 원칙

Vync의 고유성은 **".vync 파일이 곧 진실"인 다중 클라이언트 시각화 도구**라는 점이다.
팀 구조는 ".vync 파일에 어떻게 접근하는가"를 축으로 도출했다:

```
            .vync 파일
           ╱     │     ╲
     시각적으로   자동으로   프로그래밍적으로
     (보고 그린다) (중재한다)  (읽고 쓴다)
         │        │         │
     [ canvas ] [ sync ] [ codex ]
```

### 기각된 대안과 이유

| 대안 | 기각 이유 |
|------|-----------|
| 수평 레이어 (ui/core/platform) | platform이 허구 (Electron 2파일), AI 통합 소유권 불명확 |
| 기능별 (Canvas/Graph/Sync) | 하나의 기능이 UI~서버를 관통 → 파일 충돌 |
| 역할별 (Architect/Implementer) | 병렬 작업 시 같은 파일을 건드림 |
| 2팀 (surface/engine) | AI 인터페이스(codex)가 시각적 렌더링(canvas)과 전혀 다른 전문성 |

---

## 팀 정의

### 1. canvas — 시각적 표면

**정체성**: Human이 보고 만지는 모든 것

**소유 파일**:
- `apps/web/` — React SPA
- `packages/board/` — Plait 화이트보드 코어 (Drawnix fork)
- `packages/react-board/` — React-Plait 브릿지
- `packages/react-text/` — Slate 텍스트 편집
- `tools/electron/` — Electron thin shell

**전문성**: React, Plait, React Flow, Slate, SCSS, Electron

**핵심 아키텍처 결정**: D-002 (Drawnix fork), D-012 (Electron thin shell), D-019 (Graph View)

**테스트**: `npx nx test web`, `npx nx test react-board`, `npx nx e2e web-e2e`

---

### 2. codex — 프로그래밍적 표면

**정체성**: AI와 CLI를 통해 .vync를 코드로 다루는 모든 것 (Vync만의 차별점)

**소유 파일**:
- `tools/cli/` — CLI 명령 (init, open, close, stop, diff, discover)
- `agents/` — sub-agent 정의
- `skills/` — vync-editing skill
- `commands/` — 슬래시 커맨드
- `hooks/` — PostToolUse 검증, SessionEnd 정리

**전문성**: Claude Code 플러그인 시스템, diff 알고리즘, 시맨틱 싱크, 신뢰도 보정

**핵심 아키텍처 결정**: D-013 (sub-agent translator), D-015 (ID-based diff), D-017 (Semantic Sync)

**테스트**: `npx nx test cli`, `node skills/vync-editing/scripts/validate.js <file>`

---

### 3. sync — 데이터 백본

**정체성**: 모든 표면이 같은 진실을 보도록 보장

**소유 파일**:
- `tools/server/` — Hub Server (Express + WS)
- `packages/shared/` — VyncFile<T>, WsMessage<T>, sha256

**전문성**: Express, WebSocket, 파일 I/O, 동시성, echo prevention

**핵심 아키텍처 결정**: D-004 (Custom Node Server), D-008 (LWW), D-009 (SHA-256 echo prevention), D-014 (Hub Server)

**테스트**: `npx nx test server`

---

## 팀 간 인터페이스

### 소유권 규칙

| 자원 | 소유 팀 | 다른 팀의 권한 |
|------|---------|---------------|
| `packages/shared/types.ts` | sync | 읽기 전용 |
| HTTP/WS API 시그니처 | sync | 읽기 전용 |
| .vync 파일 포맷 구조 | sync(정의) + codex(검증) | canvas(렌더링) |
| `docs/` | 변경한 팀이 갱신 | — |

### 통보 프로토콜

```
sync가 types.ts 변경 시:
  → SendMessage to canvas: "VyncGraphFile 타입에 metadata 필드 추가됨"
  → SendMessage to codex: "VyncGraphFile 타입에 metadata 필드 추가됨"

canvas가 .vync 렌더링 구조 변경 시:
  → SendMessage to codex: "mindmap children의 렌더링 순서가 변경됨"

codex가 검증 규칙 변경 시:
  → SendMessage to canvas: "validate.js에서 빈 children 배열 reject 추가"
```

### 의존성 패턴

```
새 데이터 타입 추가:
  sync (타입 정의) → [canvas + codex] 병렬

새 뷰 타입:
  [canvas (프로토타입) + sync (타입)] → codex (편집 가이드)

Claude Code 통합 개선:
  codex 단독

동기화 버그 수정:
  sync 단독
```

---

## 운영 패턴

### TeamCreate 사용법

```
1. TeamCreate("vync-dev")
2. TaskCreate로 태스크 분배 (blockedBy로 의존성 표현)
3. Agent(team_name="vync-dev", name="sync/canvas/codex") 로 팀원 spawn
4. 팀원이 태스크 완료 → TaskList로 다음 작업 자동 탐색
5. 모든 태스크 완료 → shutdown_request
```

### 팀 규모 유연성

모든 세션에서 3팀 전부 필요하지 않음:

| 작업 유형 | 필요한 팀 |
|-----------|-----------|
| UI 전용 작업 | canvas만 |
| AI 통합 작업 | codex만 |
| 프로토콜 변경 | sync → canvas + codex |
| 새 기능 추가 | sync → canvas + codex |
| 단독 버그 수정 | 원인 소재 팀 1개 |

### 종료 프로토콜

1. 모든 태스크 completed 확인
2. 각 teammate에 `SendMessage({ type: "shutdown_request" })`
3. esbuild 번들 리빌드 (server/electron/shared 변경 시)
4. `npm test` (전체 검증)

---

## 파일 구조

```
agents/
  canvas.md          # 시각적 표면 팀 정의
  codex.md           # 프로그래밍적 표면 팀 정의
  sync.md            # 데이터 백본 팀 정의
  vync-translator.md # 기존 sub-agent (codex 팀 산하)
```
