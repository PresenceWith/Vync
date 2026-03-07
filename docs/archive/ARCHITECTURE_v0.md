# Vync 통합 아키텍처 설계서

> 4개 오픈소스 프로젝트(mcp_excalidraw, drawio-mcp, DeepDiagram, Drawnix) 분석을 기반으로 설계한 Vync의 최종 아키텍처

---

## 1. 4개 프로젝트 분석 요약 및 차용 전략

### 1.1 mcp_excalidraw (적합도: 95%)

> GitHub: yctimlin/mcp_excalidraw — Excalidraw용 MCP 서버. 26개 Tool, MIT 라이선스.

**차용하는 패턴:**

| 패턴 | 설명 | Vync 적용 |
|------|------|-----------|
| 양방향 피드백 루프 | `describe_scene`(현재 상태 텍스트 설명) + `get_screenshot`(시각적 확인). AI가 "눈을 뜨고" 편집 | `vync_describe_scene` + `vync_get_screenshot` 도구로 구현 |
| Element-level CRUD | 전체 파일 교체 대신 요소 단위 add/update/delete. 정밀하고 안전 | `vync_add/update/delete_element` 도구로 구현 |
| 스냅샷 저장/복원 | 작업 상태를 명명된 스냅샷으로 저장, 롤백 가능 | `vync_snapshot` / `vync_restore_snapshot` |
| Tool 카테고리 분류 | 26개 tool을 CRUD/Layout/Awareness/IO/State로 체계적 분류 | Tier 1~3 구조로 점진 확장 |

**아키텍처 참고 (stdio → HTTP → WebSocket → UI):**
```
Claude Code (MCP Client)
    │ stdio
    ▼
MCP Server (Node.js)
    │ HTTP REST API
    ▼
Express Canvas Server (in-memory state + WebSocket)
    │ WebSocket
    ▼
React + Excalidraw Frontend
```

**차용하지 않는 부분:**

| 항목 | 이유 |
|------|------|
| Express 별도 서버 | Vync는 Next.js가 API + UI 통합 서빙 |
| 서버 메모리 기반 상태 관리 | Vync는 파일이 SSoT, 서버 메모리는 캐시일 뿐 |
| Excalidraw 네이티브 JSON 데이터 모델 | Vync는 PlaitElement[] 사용 |

---

### 1.2 drawio-mcp (적합도: 60%)

> GitHub: jgraph/drawio-mcp — Draw.io 공식 MCP 서버. 3개 Tool, Apache 2.0 라이선스.

**차용하는 패턴:**

| 패턴 | 설명 | Vync 적용 |
|------|------|-----------|
| "단순함 우선" 철학 | 3개 tool(xml/csv/mermaid)만으로 핵심 가치 전달 | Vync도 Tier 1 (6개)부터 시작하여 점진 확장 |
| 복수 입력 형식 수용 | XML, CSV, Mermaid 3가지 형식 지원 | Markdown, Mermaid, JSON 3가지 입력 경로 |

**차용하지 않는 부분:**

| 항목 | 이유 |
|------|------|
| 단방향 생성 (피드백 없음) | Vync는 양방향 피드백 루프 필수 |
| URL 기반 렌더링 (draw.io.com 의존) | Vync는 로컬 렌더링 |
| pako 압축 + Base64 인코딩 | 로컬 파일 기반에서 불필요 |

---

### 1.3 DeepDiagram (패턴만 차용, 코드 0줄 — AGPL-3.0)

> GitHub: twwch/DeepDiagram — AI + LangGraph 기반 다이어그램 생성. 1.1k stars, AGPL-3.0 라이선스.

**기술 스택:** React 19 + Vite + Zustand (프론트) / Python 3.13 + FastAPI + LangGraph (백엔드)
**6개 Agent:** Mindmap(mind-elixir), Flow(React Flow), Mermaid, Charts(ECharts), DrawIO, Infographic(AntV)

**차용하는 패턴 (클린룸 재구현):**

| 패턴 | DeepDiagram 구현 | Vync 클린룸 구현 |
|------|----------------|-----------------|
| Router/Dispatcher | `dispatcher.py` — 3단계 의도 분류 (명시적 접두사 → 키워드 → LLM) | `router.ts` — TypeScript 순수 async 함수 |
| 다중 Agent 아키텍처 | `*_agent.py` — LangGraph agent | `*-agent.ts` — 순수 async 함수 |
| 컨텍스트 인식 라우팅 | 실행 히스토리 + 마지막 활성 agent 고려 | 동일 개념, 독립 구현 |
| AI 추론 가시성 | `<design_concept>` XML 태그로 추론 과정 스트리밍 | MCP tool 결과에 `description` 필드로 포함 |

**핵심 파이프라인 패턴:**
```
자연어 입력 → Router(의도 분류) → Agent 선택 → LLM 생성 → 중간 형식(Markdown/Mermaid/JSON) → 렌더러
```

**차용하지 않는 부분:**

| 항목 | 이유 |
|------|------|
| 모든 실제 코드 | AGPL-3.0 오염 방지 (Vync 라이선스 미정) |
| Python + FastAPI 백엔드 | Vync는 전체 TypeScript |
| LangGraph 프레임워크 | 순수 TypeScript async 함수로 경량 재구현 |
| Zustand + PostgreSQL 상태 관리 | Plait 내장 상태 + .vync 파일 |
| StreamingTagParser (XML 태그) | MCP tool 결과로 직접 반환, 스트리밍 불필요 |
| ECharts/Draw.io/Infographic Agent | Vync 범위 외 |

---

### 1.4 Drawnix (UI 기반, MIT 라이선스)

> GitHub: plait-board/drawnix — Plait 프레임워크 기반 화이트보드. Next.js + TypeScript.

**차용하는 부분 (직접 사용, MIT):**

| 항목 | 설명 |
|------|------|
| PlaitElement[] 데이터 모델 | `.vync` 파일 포맷의 기반. `{type, id, x, y, data, children}` |
| Drawnix React 컴포넌트 | 포크하여 저장소만 교체 (localforage → 파일 API) |
| onChange/onValueChange 이벤트 | 파일 동기화 트리거 포인트 |
| markdown-to-drawnix | Markdown → MindElement[] 변환 (npm 패키지) |
| mermaid-to-drawnix | Mermaid → DrawElement[] 변환 (npm 패키지) |
| Plait 플러그인 체계 | @plait/mind, @plait/draw 통합 |

**Drawnix 핵심 데이터 구조:**

```typescript
// .vync 파일 포맷 (Drawnix 호환 확장)
{
  type: "drawnix",
  version: "0.0.2",
  source: "vync",
  elements: PlaitElement[],  // 마인드맵, 플로우차트, 자유 캔버스 요소
  viewport: { x: number, y: number, zoom: number },
  theme: "light" | "dark"
}

// MindElement (마인드맵 노드)
{
  id: string,
  type: "mindmap",
  data: { topic: string },
  children: MindElement[],
  width: number, height: number,
  isRoot?: boolean,
  layout?: "right" | "left" | "indented",
  fill?: string, strokeColor?: string
}

// DrawElement (플로우차트 도형)
{
  id: string,
  type: "rectangle" | "ellipse" | "diamond" | "text",
  x: number, y: number,
  width: number, height: number,
  fill?: string, strokeColor?: string
}

// ConnectorElement (연결선)
{
  id: string,
  type: "connector",
  data: { startId: string, endId: string }
}
```

**Drawnix 이벤트 시스템 (동기화 후킹 포인트):**

```typescript
<Drawnix
  value={elements}
  viewport={viewport}
  theme={theme}
  onChange={(data: BoardChangeData) => { /* 전체 변경 */ }}
  onValueChange={(value: PlaitElement[]) => { /* 요소만 변경 */ }}
  onViewportChange={(viewport: Viewport) => { /* 줌/팬 */ }}
  onThemeChange={(theme: ThemeColorMode) => { /* 테마 */ }}
  afterInit={(board: PlaitBoard) => { /* 초기화 완료 */ }}
/>
```

**포크 시 수정 사항 4가지:**
1. localforage 저장소 → 파일 API 호출로 교체
2. WebSocket 리스너 추가 → 외부 변경 시 Plait board 갱신
3. onChange 훅 → debounce(300ms) → PUT /api/file
4. /api/describe 엔드포인트 노출

**차용하지 않는 부분:**

| 항목 | 이유 |
|------|------|
| localforage/IndexedDB 저장 | 파일 API 호출로 완전 교체 |
| 기존 Next.js 앱 구조 그대로 | WebSocket + 파일 감시 레이어 추가 필요 |

---

## 2. 최종 아키텍처: 하이브리드 (파일 SSoT + MCP)

### 2.1 아키텍처 선택 근거

| 기준 | 파일 기반만 | MCP 기반만 | 하이브리드 (선택) |
|------|-----------|-----------|-----------------|
| 파일 = SSoT 유지 | O | X | O |
| 어떤 에디터든 동작 | O | X | O |
| AI 피드백 루프 | X | O | O |
| 구조화된 AI 조작 | X | O | O |
| MCP 서버 없이도 동작 | O | X | O |

**핵심 원칙:**
- **파일이 SSoT** — MCP 서버든, 웹 UI든, vim이든, 모두 같은 `.vync` 파일을 읽고 쓴다
- **MCP는 optional enhancement** — MCP 없이도 파일 편집으로 동작. MCP는 구조화된 조작 + 피드백 루프 추가
- **graceful degradation** — MCP 서버가 꺼져도 시스템은 정상 동작

### 2.2 아키텍처 다이어그램

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  Claude Code     │   │  vim / VS Code   │   │  웹 브라우저      │
│  ┌────────────┐  │   │                  │   │  ┌────────────┐  │
│  │ MCP Client │  │   │  직접 파일 편집   │   │  │ Drawnix UI │  │
│  └─────┬──────┘  │   │                  │   │  └─────┬──────┘  │
│        │         │   │                  │   │        │         │
│  직접 편집도 가능  │   │                  │   │  onChange        │
└────────┼─────────┘   └────────┬─────────┘   │  (debounce 300ms)│
         │                      │              └────────┼─────────┘
         │ stdio                │                       │
   ┌─────▼──────────┐          │              ┌────────▼─────────┐
   │ Vync MCP Server│          │              │ Next.js API      │
   │ (독립 프로세스) │          │              │ PUT /api/file    │
   │                │          │              └────────┬─────────┘
   │ 14개 Tool      │          │                       │
   │ ├─ CRUD (6)    │          │                       │
   │ ├─ 변환 (2)    │          │                       │
   │ ├─ AI (3)      │          │                       │
   │ └─ 상태 (3)    │          │                       │
   └─────┬──────────┘          │                       │
         │                     │                       │
         └─────────────────────┼───────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  .vync JSON 파일     │
                    │  (Source of Truth)   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  chokidar 파일 감시  │
                    │  + echo prevention  │
                    │  (content hash)     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  WebSocket Server   │
                    │  (변경 알림 방송)    │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  웹 브라우저         │
                    │  WS 수신 → board    │
                    │  PlaitElement[] 갱신 │
                    └─────────────────────┘
```

### 2.3 데이터 흐름 상세

**경로 1: AI → 파일 → UI (MCP 경로)**
```
Claude Code → MCP Tool 호출 (stdio)
  → Vync MCP Server가 .vync 파일 읽기/수정/쓰기 (atomic write)
    → chokidar가 파일 변경 감지
      → WebSocket으로 브라우저에 알림
        → 프론트엔드가 새 PlaitElement[] 로드 → board 갱신
```

**경로 2: AI → 파일 → UI (직접 편집 경로)**
```
Claude Code → Write/Edit tool로 .vync 파일 직접 수정
  → chokidar가 파일 변경 감지
    → (이하 동일)
```

**경로 3: UI → 파일 (사용자 편집)**
```
사용자가 웹 UI에서 노드 추가/이동/삭제
  → Drawnix onChange 이벤트 발생
    → debounce(300ms) 후 PUT /api/file
      → 서버가 atomic write (tmp + rename)
        → echo prevention: content hash로 자기 쓴 변경 무시
```

**경로 4: 외부 에디터 → 파일 → UI**
```
vim/VS Code에서 .vync 파일 편집 → 저장
  → chokidar가 파일 변경 감지
    → content hash 비교 → 실제 변경이면 WebSocket 알림
      → 프론트엔드가 새 데이터 로드 → board 갱신
```

---

## 3. MCP Tool 정의 (Vync 전용)

### Tier 1: 핵심 CRUD (Phase 2)

| Tool | 입력 | 출력 | 설명 |
|------|------|------|------|
| `vync_read_file` | `{filePath}` | `{elements, viewport, theme, metadata}` | 파일 전체 읽기 |
| `vync_write_file` | `{filePath, elements, viewport?, theme?}` | `{success, elementCount}` | 파일 전체 쓰기 (교체) |
| `vync_describe_scene` | `{filePath}` | `{summary, diagramType, elementTree, stats}` | 장면 텍스트 설명 (피드백 루프 핵심) |
| `vync_add_element` | `{filePath, element, parentId?}` | `{success, elementId}` | 요소 추가 |
| `vync_update_element` | `{filePath, elementId, updates}` | `{success, previousState}` | 요소 수정 |
| `vync_delete_element` | `{filePath, elementId, deleteChildren?}` | `{success, deletedCount}` | 요소 삭제 |

### Tier 2: 변환 도구 (Phase 2 후반)

| Tool | 입력 | 출력 | 설명 |
|------|------|------|------|
| `vync_from_markdown` | `{filePath, markdown, mode: "replace"\|"append"}` | `{success, elementCount, rootId}` | Markdown → 마인드맵 |
| `vync_from_mermaid` | `{filePath, mermaid, mode: "replace"\|"append"}` | `{success, elementCount}` | Mermaid → 플로우차트 |

### Tier 3: AI 강화 (Phase 3)

| Tool | 입력 | 출력 | 설명 |
|------|------|------|------|
| `vync_generate` | `{filePath, instruction, diagramType?: "auto"\|"mindmap"\|"flow"\|"canvas"}` | `{success, elementCount, detectedType, description}` | 자연어 → 다이어그램 생성 |
| `vync_edit` | `{filePath, instruction}` | `{success, changes[]}` | 자연어로 기존 다이어그램 수정 |
| `vync_get_screenshot` | `{filePath, format?, width?, height?}` | `{imageData (base64)}` | 렌더링 스크린샷 |
| `vync_list_files` | `{directory?, recursive?}` | `{files[]}` | .vync 파일 목록 |
| `vync_snapshot` | `{filePath, snapshotName}` | `{success, snapshotPath}` | 스냅샷 저장 |
| `vync_restore_snapshot` | `{filePath, snapshotName}` | `{success}` | 스냅샷 복원 |

---

## 4. AI 편집 파이프라인 (Phase 3, 클린룸 재구현)

### 4.1 전체 파이프라인

```
사용자/AI 입력 (자연어 명령)
        │
   ┌────▼──────────────────────────────────┐
   │ Intent Router (router.ts)              │
   │                                        │
   │ 1단계: 명시적 접두사                     │
   │   @mindmap, @flow, @canvas, @edit      │
   │                                        │
   │ 2단계: 키워드 휴리스틱                   │
   │   "구조", "계층" → mindmap             │
   │   "프로세스", "흐름" → flow             │
   │   "수정", "변경", "삭제" → edit         │
   │                                        │
   │ 3단계: LLM 의도 분류 (Anthropic API)    │
   │   컨텍스트: 실행 히스토리 + 현재 장면    │
   └────┬──────────────────────────────────┘
        │
   ┌────▼──────────────────────────────────┐
   │         Agent 분기                      │
   ├──────────┬──────────┬────────┬────────┤
   │ Mindmap  │ Flow     │ Canvas │ Edit   │
   │ Agent    │ Agent    │ Agent  │ Agent  │
   │          │          │        │        │
   │ LLM →   │ LLM →   │ LLM →  │현재 요소│
   │ Markdown │ Mermaid  │JSON 직접│+ 명령  │
   │    │     │    │     │   │    │→ patch │
   │    ▼     │    ▼     │   │    │   │    │
   │ md-to-  │ mmd-to- │   │    │   │    │
   │ drawnix  │ drawnix  │   │    │   │    │
   └────┬─────┴────┬─────┴───┬────┴───┬────┘
        └──────────┴─────────┴────────┘
                      │
               PlaitElement[]
                      │
              .vync 파일 저장
                      │
              chokidar → WS → UI 갱신
```

### 4.2 Agent별 역할

| Agent | 입력 예시 | 중간 형식 | 출력 |
|-------|---------|---------|------|
| MindmapAgent | "프로젝트 구조를 정리해줘" | Markdown (# / ## / - ) | MindElement[] |
| FlowAgent | "배포 프로세스를 그려줘" | Mermaid (flowchart TD) | DrawElement[] + ConnectorElement[] |
| CanvasAgent | "자유롭게 노트를 배치해줘" | 없음 (직접 생성) | PlaitElement[] |
| EditAgent | "3번 노드 이름을 바꿔줘" | JSON Patch | 수정된 PlaitElement[] |

### 4.3 피드백 루프

```
AI: vync_generate("프로젝트 구조를 마인드맵으로")
  → 마인드맵 생성됨 (파일 저장, 브라우저 렌더링)

AI: vync_describe_scene(filePath)
  → "3개의 메인 브랜치를 가진 마인드맵. 총 15개 노드. 루트: '프로젝트 구조'..."

AI: vync_edit("'백엔드' 브랜치에 'API 서버'와 '데이터베이스' 하위 노드 추가")
  → 수정 완료, 17개 노드

AI: vync_get_screenshot(filePath)
  → 렌더링 결과 시각적 확인
```

---

## 5. 기술 스택

| 영역 | 선택 | 근거 |
|------|------|------|
| 언어 | TypeScript 전체 | 단일 언어, Drawnix/Plait 생태계 호환 |
| 프론트엔드 | Drawnix 포크 + Plait 플러그인 | MIT, 마인드맵+플로우차트+캔버스 통합 |
| 웹 서버 | Next.js 14+ | Drawnix 기반, API Routes 내장 |
| 서버→클라이언트 | WebSocket (ws) | 양방향, 멀티유저 확장 가능 |
| 파일 감시 | chokidar | Node.js 표준, 크로스 플랫폼 |
| MCP 서버 | @modelcontextprotocol/sdk (Node.js, stdio) | 공식 SDK |
| 변환기 | markdown-to-drawnix, mermaid-to-drawnix | MIT, Drawnix 생태계 |
| LLM | @anthropic-ai/sdk | Router 의도 분류 + Agent 생성 |
| 모노레포 | pnpm workspaces + turborepo | web, mcp-server, shared 분리 |
| 테스트 | Vitest | Vite 생태계, TS 네이티브 |

---

## 6. 프로젝트 구조

```
vync/
├── packages/
│   ├── web/                         # Next.js (Drawnix 포크)
│   │   ├── app/
│   │   │   ├── page.tsx
│   │   │   └── api/
│   │   │       ├── file/route.ts        # GET/PUT .vync 파일
│   │   │       └── describe/route.ts    # 장면 설명 API
│   │   ├── components/
│   │   │   ├── VyncBoard.tsx            # Plait board + 동기화 래퍼
│   │   │   └── SyncIndicator.tsx        # 동기화 상태 표시
│   │   ├── lib/
│   │   │   ├── file-sync.ts             # 양방향 동기화 핵심 로직
│   │   │   ├── echo-prevention.ts       # content hash 기반 에코 방지
│   │   │   ├── file-watcher.ts          # chokidar + WS broadcast
│   │   │   └── atomic-write.ts          # tmp + rename 원자적 쓰기
│   │   └── hooks/
│   │       └── useFileSync.ts           # WebSocket 수신 React hook
│   │
│   ├── mcp-server/                  # MCP 서버 (독립 프로세스)
│   │   └── src/
│   │       ├── index.ts                 # 진입점, stdio transport
│   │       ├── tools/                   # 14개 도구 구현
│   │       │   ├── read-file.ts
│   │       │   ├── write-file.ts
│   │       │   ├── describe-scene.ts
│   │       │   ├── add-element.ts
│   │       │   ├── update-element.ts
│   │       │   ├── delete-element.ts
│   │       │   ├── from-markdown.ts
│   │       │   ├── from-mermaid.ts
│   │       │   ├── generate.ts
│   │       │   ├── edit.ts
│   │       │   ├── get-screenshot.ts
│   │       │   ├── list-files.ts
│   │       │   ├── snapshot.ts
│   │       │   └── restore-snapshot.ts
│   │       └── agents/                  # AI 파이프라인 (Phase 3)
│   │           ├── router.ts            # 의도 분류 라우터
│   │           ├── mindmap-agent.ts
│   │           ├── flow-agent.ts
│   │           ├── canvas-agent.ts
│   │           └── edit-agent.ts
│   │
│   └── shared/                      # 공유 타입 및 유틸리티
│       └── src/
│           ├── types/
│           │   └── vync-file.ts         # .vync 파일 포맷 타입
│           ├── format/
│           │   ├── reader.ts            # 파일 읽기
│           │   ├── writer.ts            # 원자적 쓰기
│           │   └── validator.ts         # JSON 스키마 검증
│           └── describe/
│               └── scene-describer.ts   # PlaitElement[] → 텍스트 설명
│
├── docs/
│   ├── PLAN.md                      # 기존 계획서
│   ├── ARCHITECTURE.md              # 본 문서
│   └── DECISIONS.md                 # 결정사항 + 미결 이슈
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

---

## 7. 단계별 구현 로드맵 (Phase 1~3)

### Phase 1: 기반 + 양방향 파일 동기화

**목표**: Drawnix 포크가 .vync 파일 기반으로 동작하며 양방향 동기화 완성

| # | 작업 | 상세 | 의존 |
|---|------|------|------|
| 1.1 | 모노레포 설정 | pnpm workspace + turborepo, packages/web, packages/shared | — |
| 1.2 | .vync 파일 포맷 정의 | packages/shared에 타입, reader, writer, validator | 1.1 |
| 1.3 | Drawnix 포크 배치 | packages/web에 배치, 로컬 실행 확인 | 1.1 |
| 1.4 | localforage → API Route | GET/PUT /api/file 구현, localforage 제거 | 1.2, 1.3 |
| 1.5 | 파일 감시 + WebSocket | chokidar 감시 서비스 + ws WebSocket 서버 | 1.4 |
| 1.6 | WS 클라이언트 | 프론트엔드 WebSocket 수신 → Plait board 갱신 | 1.5 |
| 1.7 | 자동 저장 | onChange → debounce(300ms) → PUT /api/file | 1.4 |
| 1.8 | 에코 방지 | content hash 기반, 자기 쓴 변경 무시 | 1.5, 1.7 |
| 1.9 | 원자적 쓰기 | tmp + rename, JSON 파싱 실패 시 이전 상태 유지 | 1.4 |
| 1.10 | 동기화 상태 UI | SyncIndicator 컴포넌트 | 1.6 |

**완료 기준:**
- [ ] .vync 파일의 다이어그램이 브라우저에 렌더링됨
- [ ] 브라우저에서 편집 → 파일 자동 저장
- [ ] vim으로 파일 수정 → 브라우저 3초 내 갱신
- [ ] 에코 루프 발생하지 않음

### Phase 2: MCP 서버 + 핵심 도구

**목표**: Claude Code가 MCP 도구로 다이어그램을 읽고, 쓰고, 변환, 이해

| # | 작업 | 상세 | 의존 |
|---|------|------|------|
| 2.1 | MCP 서버 설정 | @modelcontextprotocol/sdk, stdio transport | 1.1 |
| 2.2 | Tier 1 CRUD | vync_read_file, vync_write_file | 1.2, 2.1 |
| 2.3 | 장면 설명 | vync_describe_scene (PlaitElement[] → 계층적 텍스트) | 2.2 |
| 2.4 | 요소 CRUD | vync_add/update/delete_element | 2.2 |
| 2.5 | Markdown 변환 | vync_from_markdown (markdown-to-drawnix 통합) | 2.2 |
| 2.6 | Mermaid 변환 | vync_from_mermaid (mermaid-to-drawnix 통합) | 2.2 |
| 2.7 | Claude Code 등록 | claude_desktop_config.json에 MCP 서버 추가 | 2.1 |
| 2.8 | E2E 검증 | MCP tool → 파일 생성 → 브라우저 렌더링 | 전체 |

**완료 기준:**
- [ ] `vync_from_markdown` → 마인드맵 생성 → 브라우저에 나타남
- [ ] `vync_describe_scene` → 다이어그램 텍스트 설명 반환
- [ ] `vync_add_element` → 노드 추가 → 브라우저 반영

### Phase 3: AI 파이프라인 (클린룸 재구현)

**목표**: 자연어로 다이어그램 생성/편집 가능

| # | 작업 | 상세 | 의존 |
|---|------|------|------|
| 3.1 | Intent Router | 3단계 의도 분류 (접두사 → 키워드 → LLM) | 2.1 |
| 3.2 | MindmapAgent | 명령 → LLM → Markdown → md-to-drawnix | 2.5, 3.1 |
| 3.3 | FlowAgent | 명령 → LLM → Mermaid → mmd-to-drawnix | 2.6, 3.1 |
| 3.4 | CanvasAgent | 명령 → LLM → PlaitElement[] 직접 생성 | 3.1 |
| 3.5 | EditAgent | 현재 장면 + 명령 → 수정된 PlaitElement[] | 2.3, 3.1 |
| 3.6 | vync_generate | Router+Agent를 내부 호출하는 MCP tool | 3.1~3.4 |
| 3.7 | vync_edit | EditAgent를 내부 호출하는 MCP tool | 3.5 |
| 3.8 | 상태 관리 도구 | vync_list_files, vync_snapshot, vync_restore_snapshot | 2.2 |
| 3.9 | 충돌 알림 UI | "외부에서 변경됨" 다이얼로그, 반영/무시 선택 | 1.6 |
| 3.10 | 스크린샷 | vync_get_screenshot (Puppeteer headless 캡처) | Phase 1 |

**완료 기준:**
- [ ] "프로젝트 구조를 마인드맵으로" → 자동 마인드맵 생성
- [ ] "3번 노드 이름을 바꿔줘" → 기존 다이어그램 수정
- [ ] 전체 루프 3초 이내 반영

---

## 8. 핵심 기술 과제

### 8.1 에코 방지 (Echo Prevention)

**문제**: 웹 → 파일 저장 → chokidar 감지 → WS → 웹 → 무한 루프

**해결**: Content hash 기반
```
1. 파일 쓰기 시 content의 SHA-256 해시를 기록
2. chokidar가 변경 감지 시 새 파일의 해시 계산
3. 저장된 해시와 동일하면 → 자기 쓴 변경 → 무시
4. 다르면 → 외부 변경 → WebSocket 알림
```

### 8.2 원자적 쓰기 (Atomic Write)

```
1. 임시 파일에 내용 쓰기: /path/to/.board.vync.json.tmp
2. JSON 유효성 검증
3. rename()으로 원본 파일 교체 (POSIX atomic)
4. 실패 시 이전 파일 유지
```

### 8.3 충돌 해결

PoC 단계: **Last Write Wins + 알림**
- 외부 변경 감지 시 "파일이 외부에서 변경되었습니다" 다이얼로그
- 사용자가 "반영" 또는 "무시" 선택

---

## 9. 검증 방법

### Phase 1 검증
1. `pnpm dev` → 브라우저에서 빈 캔버스 확인
2. 브라우저에서 마인드맵 노드 추가 → `cat data/board.vync.json`으로 파일 저장 확인
3. `vim data/board.vync.json`으로 노드 텍스트 수정 → 브라우저 자동 갱신 확인
4. 빠르게 연속 편집 → 에코 루프 없음 확인

### Phase 2 검증
1. Claude Code에서 `vync_from_markdown` 호출 → 마인드맵 파일 생성 → 브라우저 렌더링 확인
2. `vync_describe_scene` 호출 → 현재 장면의 텍스트 설명 반환 확인
3. `vync_add_element` → 노드 추가 → 파일 변경 → 브라우저 반영 확인
4. `vync_from_mermaid` → 플로우차트 생성 확인

### Phase 3 검증
1. `vync_generate("프로젝트 구조를 마인드맵으로 정리해줘")` → 자동 마인드맵 생성
2. `vync_edit("3번 노드에 하위 항목 2개 추가해줘")` → 기존 다이어그램 수정
3. `vync_describe_scene` → 수정 결과 텍스트 확인 (피드백 루프)
4. 전체 루프(자연어 → 파일 → 브라우저) 3초 이내 확인
