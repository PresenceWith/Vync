# Vync 오픈소스 프로젝트 분석 및 통합 전략

> 2026-03-07 — 4개 오픈소스 프로젝트(mcp_excalidraw, drawio-mcp, DeepDiagram, Drawnix) 심층 분석 결과
> 각 프로젝트의 장단점, Vync에 차용할 패턴, 통합 아키텍처 설계

---

## 1. 분석 대상 프로젝트 개요

| 프로젝트 | GitHub | 핵심 성격 | 라이선스 | Stars |
|----------|--------|---------|---------|-------|
| mcp_excalidraw | yctimlin/mcp_excalidraw | Excalidraw용 MCP 서버 (26개 Tool) | MIT | 커뮤니티 |
| drawio-mcp | jgraph/drawio-mcp | Draw.io 공식 MCP 서버 (3개 Tool) | Apache 2.0 | 1,000+ |
| DeepDiagram | twwch/DeepDiagram | AI+LangGraph 기반 다이어그램 생성 | **AGPL-3.0** | 1,100+ |
| Drawnix | plait-board/drawnix | Plait 프레임워크 기반 화이트보드 | MIT | — |

---

## 2. mcp_excalidraw 상세 분석

### 2.1 아키텍처

```
Claude Code (MCP Client)
    │ stdio
    ▼
MCP Server (Node.js, 26개 Tool)
    │ HTTP REST API
    ▼
Express Canvas Server (Port 3000, in-memory state)
    │ WebSocket
    ▼
React + Excalidraw Frontend (실시간 렌더링)
```

### 2.2 MCP Tool 전체 목록 (26개)

| 카테고리 | Tool | 역할 |
|---------|------|------|
| **Element CRUD (7)** | create_element | 새 도형/텍스트 생성 |
| | get_element | 특정 요소 조회 |
| | update_element | 요소 속성 수정 |
| | delete_element | 요소 삭제 |
| | query_elements | 조건으로 요소 검색 |
| | list_elements | 전체 요소 목록 |
| | batch_update_elements | 일괄 수정 |
| **Layout (6)** | align_elements | 정렬 (좌/우/중앙/상/하) |
| | distribute_elements | 균등 배치 |
| | group_elements | 그룹 생성 |
| | ungroup_elements | 그룹 해제 |
| | lock_elements | 요소 잠금 |
| | set_z_index | 레이어 순서 |
| **Scene Awareness (2)** | describe_scene | 캔버스 현재 상태 텍스트 설명 |
| | get_canvas_screenshot | PNG 스크린샷 캡처 |
| **File I/O (5)** | export_scene | .excalidraw JSON 생성 |
| | import_scene | 파일에서 로드 |
| | export_to_image | PNG/SVG/PDF 내보내기 |
| | create_from_mermaid | Mermaid → Excalidraw 변환 |
| | save_diagram | 저장소에 저장 |
| **State Mgmt (3)** | clear_canvas | 전체 초기화 |
| | snapshot_scene | 스냅샷 저장 |
| | restore_snapshot | 스냅샷 복원 |
| **Viewport (1)** | set_viewport | 확대/축소, 패닝 |
| **Reference (2)** | read_diagram_guide | 디자인 가이드 |
| | get_resource | 리소스 조회 |

### 2.3 데이터 모델

```typescript
// Excalidraw Element
{
  id: string;
  type: "rectangle" | "diamond" | "ellipse" | "arrow" | "text" | ...;
  x: number; y: number;
  width: number; height: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: "hachure" | "cross-hatch" | "solid";
  text?: string;
  groupIds: string[];
  locked: boolean;
}

// Scene
{
  elements: Element[];
  appState: { viewBackgroundColor, zoom, scrollX, scrollY }
}
```

### 2.4 장점

- **양방향 피드백 루프**: `describe_scene`으로 AI가 현재 상태를 이해하고, `get_canvas_screenshot`으로 시각적 확인. AI가 "눈을 뜨고" 편집하는 결정적 차이
- **세밀한 제어**: Element-level CRUD로 전체 파일 교체 없이 정밀 조작
- **실시간 동기화**: WebSocket으로 즉각 피드백
- **상태 관리**: 스냅샷으로 롤백 가능
- **zod 기반 입력 검증**: 견고한 에러 핸들링

### 2.5 단점

- 서버 재시작 시 상태 손실 (메모리 기반)
- 인증 없음 (로컬 only 권장)
- Express 별도 서버 필요 (프로세스 2개)

### 2.6 Vync 차용 전략

| 차용 O | 차용 X |
|--------|--------|
| 피드백 루프 패턴 (describe_scene + screenshot) | Express 별도 서버 (Next.js 통합) |
| Element-level CRUD 도구 설계 | 서버 메모리 기반 상태 (파일이 SSoT) |
| 스냅샷 저장/복원 | Excalidraw 데이터 모델 (PlaitElement[] 사용) |
| Tool 카테고리 분류 체계 | |

---

## 3. drawio-mcp 상세 분석

### 3.1 아키텍처

```
Claude / Claude Desktop
    │ stdio
    ▼
MCP Server (3개 Tool)
    │ pako 압축 + Base64 인코딩
    ▼
draw.io URL 생성 → 사용자가 브라우저에서 열기
```

### 3.2 MCP Tool 전체 목록 (3개)

| Tool | 파라미터 | 설명 |
|------|---------|------|
| open_drawio_xml | xml, lightbox?, darkMode? | Draw.io XML로 다이어그램 열기 |
| open_drawio_csv | csv, lightbox?, darkMode? | 테이블 데이터 → 다이어그램 변환 |
| open_drawio_mermaid | mermaid, lightbox?, darkMode? | Mermaid → 다이어그램 변환 |

### 3.3 데이터 모델

```xml
<mxfile>
  <diagram name="Page-1">
    <mxGraphModel dx="1200" dy="800" grid="1">
      <root>
        <mxCell id="0" parent="" />
        <mxCell id="1" parent="0" vertex="1">
          <mxGeometry x="100" y="50" width="100" height="60" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

### 3.4 장점

- **극도의 간결함**: 3개 tool만으로 핵심 가치 전달
- **검증된 공식 프로젝트**: jgraph(draw.io 개발사) 공식 유지
- **복수 입력 형식**: XML, CSV, Mermaid 3가지 지원

### 3.5 단점

- **단방향**: 생성만 가능, 피드백 루프 없음
- **편집 불가**: 사용자가 수동으로 draw.io에서 편집
- **외부 의존**: draw.io.com 접근 필요

### 3.6 Vync 차용 전략

| 차용 O | 차용 X |
|--------|--------|
| "단순함 우선" 철학 (핵심부터 점진 확장) | 단방향 생성 |
| 복수 입력 형식 수용 | URL 기반 렌더링 |
| | pako 압축 |

---

## 4. DeepDiagram 상세 분석

### 4.1 기술 스택

- **프론트엔드**: React 19 + Vite + Zustand
- **렌더러 6개**: React Flow, mind-elixir, Mermaid.js, ECharts, AntV, Draw.io
- **백엔드**: Python 3.13 + FastAPI + LangGraph 1.0.4
- **DB**: PostgreSQL 16 + SQLModel
- **인프라**: Docker Compose + Nginx

### 4.2 AI Agent 파이프라인

```
사용자 입력 (텍스트/이미지/문서 + LLM 설정)
    │
    ▼
Router (dispatcher.py)
├─ 명시적 @agent 라우팅
├─ LLM 의도 분류
└─ 컨텍스트 인식 (실행 히스토리 + 마지막 활성 agent)
    │
    ├── Mindmap Agent → Markdown (#/##/###/-)
    ├── Flow Agent → JSON ({nodes[], edges[]})
    ├── Mermaid Agent → Mermaid 문법
    ├── Charts Agent → ECharts JSON
    ├── DrawIO Agent → mxGraph XML
    └── Infographic Agent → AntV DSL (2단계: 템플릿 선택 → 코드 생성)
    │
    ▼
XML Tag Output (Tool 호출 없이 직접 출력)
├─ <design_concept>AI 설계 의도</design_concept>
└─ <code>다이어그램 코드</code>
    │
    ▼
StreamingTagParser (상태 머신: INIT → DESIGN_CONCEPT → CODE → DONE)
    │
    ▼
SSE 스트리밍 → 프론트엔드 렌더링
```

### 4.3 Router 의도 분류 상세

```python
# 3단계 분류
1. 명시적 라우팅: @mindmap, @flow, @mermaid, @charts, @drawio, @infographic
2. LLM 의도 분류:
   - mindmap: 계층적 구조에 적합
   - flow: 표준 플로우차트에만 적합
   - mermaid: 시퀀스, 클래스, 상태 다이어그램
   - charts: 정량적 데이터
   - drawio: 아키텍처, 복잡한 UML
   - infographic: 인포그래픽, 데이터 포스터
3. 컨텍스트 인식: LAST_ACTIVE_AGENT + EXECUTION_HISTORY 고려
```

### 4.4 Agent 구현 패턴

```python
# 각 Agent의 공통 패턴
async def agent_node(state: AgentState):
    messages = state['messages']
    current_code = extract_current_code_from_messages(messages)  # 기존 코드 추출

    system_content = AGENT_SYSTEM_PROMPT + get_thinking_instructions()
    if current_code:
        system_content += f"\n\nCURRENT CODE:\n{current_code}"

    llm = get_configured_llm(state)  # 모델 교체 가능
    response = await llm.astream([system_prompt] + messages)
    return {"messages": [response]}
```

### 4.5 장점

- **의도 분류 정확도**: 3단계 분류 + 컨텍스트 인식
- **다중 렌더러**: 6종 다이어그램 유형 지원
- **AI 추론 가시성**: `<design_concept>` 태그로 실시간 스트리밍
- **모델 유연성**: OpenAI, DeepSeek, 커스텀 API 지원
- **Extended Thinking**: `get_thinking_instructions()`로 깊은 추론

### 4.6 단점

- **AGPL-3.0**: 파생물 오픈소스 강제. 네트워크 서비스도 적용
- **Python 백엔드**: Vync(TypeScript)와 언어 불일치
- **PostgreSQL 의존**: 로컬 도구에는 과도한 인프라
- **LangGraph 의존**: 프레임워크 락인

### 4.7 Vync 차용 전략 (클린룸 재구현, 코드 0줄)

| 차용 (패턴만) | 차용 X |
|--------------|--------|
| Router/Dispatcher 패턴 (3단계 의도 분류) | 모든 실제 코드 (AGPL 오염 방지) |
| 다중 Agent 아키텍처 | Python + FastAPI |
| 컨텍스트 인식 라우팅 | LangGraph 프레임워크 |
| AI 추론 가시성 개념 | Zustand + PostgreSQL |
| | ECharts/DrawIO/Infographic Agent |

**클린룸 매핑:**

| DeepDiagram | Vync (독립 구현) |
|------------|-----------------|
| dispatcher.py (Python, LangGraph) | router.ts (TypeScript, 순수 async) |
| *_agent.py (LangGraph agent) | *-agent.ts (순수 async 함수) |
| StreamingTagParser (XML tag) | 불필요 (MCP tool 결과로 직접 반환) |
| Zustand + PostgreSQL | Plait 내장 상태 + .vync 파일 |

---

## 5. Drawnix 상세 분석

### 5.1 프로젝트 구조

```
drawnix/
├── apps/web/src/app/app.tsx          # 메인 App
├── packages/
│   ├── drawnix/src/
│   │   ├── drawnix.tsx               # Drawnix React 컴포넌트
│   │   ├── data/
│   │   │   ├── json.ts              # JSON 직렬화/역직렬화
│   │   │   ├── filesystem.ts        # 파일 시스템 접근
│   │   │   └── types.ts
│   │   ├── plugins/                  # Plait 플러그인
│   │   ├── transforms/               # 요소 변환
│   │   ├── hooks/                    # React 훅
│   │   └── components/               # UI 컴포넌트
│   ├── react-board/                  # React 보드 래퍼
│   └── react-text/                   # 텍스트 렌더링
├── markdown-to-drawnix/              # 별도 저장소
└── mermaid-to-drawnix/               # 별도 저장소
```

### 5.2 핵심 의존성

```json
{
  "@plait-board/markdown-to-drawnix": "^0.0.8",
  "@plait-board/mermaid-to-drawnix": "^0.0.7",
  "@plait/common": "^0.92.1",
  "@plait/core": "^0.92.1",
  "@plait/draw": "^0.92.1",
  "@plait/layouts": "^0.92.1",
  "@plait/mind": "^0.92.1",
  "@plait/text-plugins": "^0.92.1",
  "localforage": "^1.10.0",
  "react": "19.2.0",
  "slate": "^0.116.0"
}
```

### 5.3 PlaitElement[] 데이터 모델

**기본 PlaitElement:**
```typescript
{
  id: string;          // UUID
  type: string;        // 'mindmap' | 'rectangle' | 'connector' | ...
  x: number;
  y: number;
  angle: number;
  data: any;
  children: PlaitElement[];
}
```

**MindElement (마인드맵 노드):**
```typescript
{
  id: "uuid-1",
  type: "mindmap",
  data: { topic: "노드 텍스트" },
  children: [/* 자식 노드 */],
  width: 200, height: 50,
  isRoot: true,
  layout: "right",        // "right" | "left" | "indented"
  fill: "#ffffff",
  strokeColor: "#000000",
  branchColor: "#333",
  branchShape: "bight",   // "bight" | "polyline"
  isCollapsed: false,
  points: [[0, 0]]        // 루트 노드 뷰포트 포인트
}
```

**DrawElement (플로우차트 도형):**
```typescript
{
  id: "rect-1",
  type: "rectangle",      // "rectangle" | "ellipse" | "diamond" | "text"
  x: 100, y: 100,
  width: 200, height: 100,
  fill: "#e3f2fd",
  strokeColor: "#1976d2",
  strokeWidth: 2,
  rough: false             // 손그린 스타일
}
```

**ConnectorElement (연결선):**
```typescript
{
  id: "conn-1",
  type: "connector",
  data: {
    startId: "rect-1",
    endId: "rect-2",
    startSocketIndex: 2,
    endSocketIndex: 0
  },
  strokeColor: "#333"
}
```

**.vync 파일 전체 구조:**
```json
{
  "type": "drawnix",
  "version": "0.0.2",
  "source": "vync",
  "elements": [/* PlaitElement[] */],
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "theme": "light"
}
```

### 5.4 저장/로드 메커니즘

**현재 (localforage 기반):**
```typescript
// 저장
localforage.config({ name: 'Drawnix', storeName: 'drawnix_store' });
localforage.setItem('main_board_content', { children, viewport, theme });

// 직렬화
const serializeAsJSON = (board: PlaitBoard): string => {
  return JSON.stringify({
    type: 'drawnix', version: '0.0.2',
    elements: board.children, viewport: board.viewport, theme: board.theme
  }, null, 2);
};
```

### 5.5 이벤트 시스템 (동기화 후킹 포인트)

```typescript
<Drawnix
  value={elements}
  viewport={viewport}
  theme={theme}
  onChange={(data: BoardChangeData) => {}}       // 전체 변경
  onValueChange={(value: PlaitElement[]) => {}}  // 요소만
  onViewportChange={(viewport: Viewport) => {}}  // 줌/팬
  onThemeChange={(theme: ThemeColorMode) => {}}   // 테마
  afterInit={(board: PlaitBoard) => {}}           // 초기화 완료
/>
```

### 5.6 변환기

**markdown-to-drawnix:**
```typescript
parseMarkdownToDrawnix(markdown: string, mainTopic?: string): PlaitMind
// remark-parse → AST → Heading depth 기반 계층 → MindElement[]
// 입력: # 제목 / ## 하위 / - 항목
// 출력: PlaitMind (MindElement 트리)
```

**mermaid-to-drawnix:**
```typescript
parseMermaidToDrawnix(definition: string, config?: MermaidConfig)
  : Promise<{elements: PlaitElement[], files?: any[]}>
// Mermaid 파싱 → 노드→DrawElement, 엣지→ConnectorElement → 자동 레이아웃
// 지원: flowchart, sequence, gantt, state, class diagram
```

### 5.7 장점

- 마인드맵+플로우차트+캔버스 통합
- PlaitElement[] JSON이 AI 편집 친화적
- MIT 라이선스
- markdown/mermaid 변환기 보유
- onChange 이벤트로 동기화 후킹 용이

### 5.8 단점

- localforage 기반 → 파일 시스템 전환 필요
- Plait v0.92.1 (초기 단계, API 변경 가능)
- markdown-to-drawnix / mermaid-to-drawnix가 별도 저장소

### 5.9 Vync 차용 전략

| 차용 (직접 사용, MIT) | 차용 X |
|---------------------|--------|
| PlaitElement[] 데이터 모델 | localforage/IndexedDB |
| Drawnix React 컴포넌트 (포크) | 기존 Next.js 구조 그대로 |
| onChange/onValueChange 이벤트 | |
| markdown-to-drawnix (npm) | |
| mermaid-to-drawnix (npm) | |
| Plait 플러그인 체계 | |

---

## 6. 4개 프로젝트 종합 비교

| 측면 | mcp_excalidraw | drawio-mcp | DeepDiagram | Drawnix |
|------|---------------|------------|-------------|---------|
| **Tool 수** | 26개 | 3개 | N/A (Agent) | N/A (UI) |
| **피드백 루프** | O (describe+screenshot) | X | X (단방향 생성) | X |
| **세밀한 제어** | Element-level | 생성만 | Agent 수준 | UI 직접 |
| **AI 편집** | MCP Tool | MCP Tool | LLM Agent | 수동 |
| **데이터 모델** | Excalidraw JSON | mxGraph XML | 다중 (6종) | PlaitElement[] |
| **의도 분류** | X | X | 3단계 Router | X |
| **실시간 동기화** | WebSocket | X | SSE | X (localStorage) |
| **라이선스** | MIT | Apache 2.0 | **AGPL-3.0** | MIT |
| **Vync 적합도** | 95% | 60% | 패턴만 | UI 기반 |

---

## 7. Vync 통합 아키텍처 설계

### 7.1 하이브리드 아키텍처 (파일 SSoT + MCP)

**핵심 원칙:**
- 파일 = Source of Truth (vim, VS Code, Claude Code 모두 동일 파일 편집)
- MCP = optional enhancement (없어도 동작, 있으면 구조화된 AI 조작)
- graceful degradation (MCP 서버 꺼져도 시스템 정상)

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  Claude Code     │   │  vim / VS Code   │   │  웹 브라우저      │
│  ┌────────────┐  │   │                  │   │  ┌────────────┐  │
│  │ MCP Client │  │   │  직접 파일 편집   │   │  │ Drawnix UI │  │
│  └─────┬──────┘  │   │                  │   │  └─────┬──────┘  │
│  직접 편집도 가능  │   │                  │   │  onChange        │
└────────┼─────────┘   └────────┬─────────┘   │  (debounce 300ms)│
         │ stdio                │              └────────┼─────────┘
   ┌─────▼──────────┐          │              ┌────────▼─────────┐
   │ Vync MCP Server│          │              │ Next.js API      │
   │ (독립 프로세스) │          │              │ PUT /api/file    │
   │ 14개 Tool      │          │              └────────┬─────────┘
   └─────┬──────────┘          │                       │
         └─────────────────────┼───────────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │  .vync JSON 파일     │
                    │  (Source of Truth)   │
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │  chokidar 감시      │
                    │  + echo prevention  │
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │  WebSocket 방송     │
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │  브라우저 board 갱신  │
                    └─────────────────────┘
```

### 7.2 MCP Tool 설계 (14개, 3 Tier)

**Tier 1 — 핵심 CRUD (Phase 2):**

| Tool | 입력 | 출력 |
|------|------|------|
| `vync_read_file` | filePath | elements, viewport, theme, metadata |
| `vync_write_file` | filePath, elements, viewport?, theme? | success, elementCount |
| `vync_describe_scene` | filePath | summary, diagramType, elementTree, stats |
| `vync_add_element` | filePath, element, parentId? | success, elementId |
| `vync_update_element` | filePath, elementId, updates | success, previousState |
| `vync_delete_element` | filePath, elementId, deleteChildren? | success, deletedCount |

**Tier 2 — 변환 도구 (Phase 2 후반):**

| Tool | 입력 | 출력 |
|------|------|------|
| `vync_from_markdown` | filePath, markdown, mode | success, elementCount, rootId |
| `vync_from_mermaid` | filePath, mermaid, mode | success, elementCount |

**Tier 3 — AI 강화 (Phase 3):**

| Tool | 입력 | 출력 |
|------|------|------|
| `vync_generate` | filePath, instruction, diagramType? | success, elementCount, detectedType |
| `vync_edit` | filePath, instruction | success, changes[] |
| `vync_get_screenshot` | filePath, format?, width? | imageData (base64) |
| `vync_list_files` | directory?, recursive? | files[] |
| `vync_snapshot` | filePath, snapshotName | success, snapshotPath |
| `vync_restore_snapshot` | filePath, snapshotName | success |

### 7.3 AI 편집 파이프라인 (클린룸)

```
자연어 입력
    │
Intent Router (router.ts)
├─ 1단계: 명시적 접두사 (@mindmap, @flow, @canvas, @edit)
├─ 2단계: 키워드 휴리스틱 ("구조"→mindmap, "프로세스"→flow)
└─ 3단계: LLM 의도 분류 (Anthropic API + 컨텍스트)
    │
    ├── MindmapAgent → LLM → Markdown → md-to-drawnix → MindElement[]
    ├── FlowAgent    → LLM → Mermaid  → mmd-to-drawnix → DrawElement[]
    ├── CanvasAgent  → LLM → PlaitElement[] 직접 생성
    └── EditAgent    → 현재 장면 + 명령 → JSON Patch → 수정된 PlaitElement[]
    │
    ▼
.vync 파일 저장 → chokidar → WS → UI 갱신
```

### 7.4 기술 스택

| 영역 | 선택 | 근거 |
|------|------|------|
| 언어 | TypeScript 전체 | 단일 언어, Drawnix 호환 |
| 프론트엔드 | Drawnix 포크 | MIT, 통합 지원 |
| 웹 서버 | Next.js 14+ | Drawnix 기반 |
| 실시간 | WebSocket (ws) | 양방향, 확장 가능 |
| 파일 감시 | chokidar | Node.js 표준 |
| MCP | @modelcontextprotocol/sdk | 공식 SDK |
| 변환기 | markdown/mermaid-to-drawnix | MIT, npm |
| LLM | @anthropic-ai/sdk | Router + Agent |
| 모노레포 | pnpm + turborepo | 패키지 분리 |
| 테스트 | Vitest | Vite 호환 |

---

## 8. 구현 로드맵 (Phase 1~3)

### Phase 1: 양방향 파일 동기화

| # | 작업 | 의존 |
|---|------|------|
| 1.1 | 모노레포 설정 (pnpm + turborepo) | — |
| 1.2 | .vync 파일 포맷 타입 + reader/writer/validator | 1.1 |
| 1.3 | Drawnix 포크 → packages/web 배치, 실행 확인 | 1.1 |
| 1.4 | localforage → API Route (GET/PUT /api/file) | 1.2, 1.3 |
| 1.5 | chokidar + WebSocket 서버 | 1.4 |
| 1.6 | 프론트엔드 WS 클라이언트 → board 갱신 | 1.5 |
| 1.7 | onChange → debounce(300ms) → PUT /api/file | 1.4 |
| 1.8 | 에코 방지 (content hash) | 1.5, 1.7 |
| 1.9 | 원자적 쓰기 (tmp + rename) | 1.4 |
| 1.10 | 동기화 상태 UI | 1.6 |

### Phase 2: MCP 서버 + 핵심 도구

| # | 작업 | 의존 |
|---|------|------|
| 2.1 | MCP 서버 설정 (stdio) | 1.1 |
| 2.2 | Tier 1: read_file, write_file | 1.2, 2.1 |
| 2.3 | describe_scene | 2.2 |
| 2.4 | add/update/delete_element | 2.2 |
| 2.5 | Tier 2: from_markdown | 2.2 |
| 2.6 | from_mermaid | 2.2 |
| 2.7 | Claude Code 등록 | 2.1 |
| 2.8 | E2E 검증 | 전체 |

### Phase 3: AI 파이프라인

| # | 작업 | 의존 |
|---|------|------|
| 3.1 | Intent Router | 2.1 |
| 3.2 | MindmapAgent | 2.5, 3.1 |
| 3.3 | FlowAgent | 2.6, 3.1 |
| 3.4 | CanvasAgent | 3.1 |
| 3.5 | EditAgent | 2.3, 3.1 |
| 3.6 | vync_generate (Router+Agent) | 3.1~3.4 |
| 3.7 | vync_edit | 3.5 |
| 3.8 | list_files, snapshot, restore | 2.2 |
| 3.9 | 충돌 알림 UI | 1.6 |
| 3.10 | get_screenshot (Puppeteer) | Phase 1 |

---

## 9. 결정사항 요약

| ID | 결정 | 근거 |
|----|------|------|
| D-003 | 하이브리드 아키텍처 (파일 SSoT + MCP) | 파일 보편성 + AI 피드백 루프 양립 |
| D-004 | WebSocket | 양방향, 멀티유저 확장 |
| D-005 | PoC 범위: Phase 1~3 | AI 파이프라인까지 검증 |
| D-006 | DeepDiagram 클린룸 재구현 | AGPL 오염 방지 |
| D-007 | TypeScript 전체 | 단일 언어 통일 |
| D-008 | 에코 방지: Content Hash | 타이밍 독립적, 신뢰성 |
| D-009 | 충돌 해결: Last Write Wins + 알림 | PoC 단순함 우선 |

---

## 10. 미결 이슈

| ID | 이슈 | 결정 시점 |
|----|------|---------|
| O-001 | Vync 라이선스 | Phase 1 완료 후 |
| O-002 | Drawnix 포크 전략 (전체 복사 vs submodule vs npm) | Phase 1.3 전 |
| O-003 | Next.js + WebSocket 통합 방식 | Phase 1.5 전 |
| O-004 | MCP 서버의 파일 접근 방식 (직접 fs vs API 경유) | Phase 2.1 전 |
| O-005 | Plait v0.92.1 API 안정성 | Phase 1.3에서 평가 |
