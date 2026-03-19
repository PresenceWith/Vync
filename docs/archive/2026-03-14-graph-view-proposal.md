# Graph View — 온톨로지/지식 그래프 편집기

**Date**: 2026-03-14
**Status**: 기획 (구현 전)
**선행**: 없음 (기존 캔버스와 독립)

---

## 1. 정의

Vync에 **온톨로지/지식 그래프 편집 뷰**를 추가한다. 개념(Entity)을 노드로, 관계(Relationship)를 엣지로 시각화하며, 노드 클릭 시 시맨틱 속성(타입, 카테고리, 설명, 관계 목록)을 인스펙터 패널에서 조회·편집할 수 있다.

기존 마인드맵/드로잉 캔버스와는 **독립된 페이지**로 동작한다. 데이터 연동 없음.

---

## 2. 확정 요구사항

| 항목 | 결정 |
|------|------|
| 그래프 유형 | 온톨로지/지식 그래프 (개념 + 관계) |
| 위치 | Vync 내 독립 페이지 (별도 라우트) |
| 노드 속성 | 시맨틱 메타데이터 — 타입, 카테고리, 설명, 관계 목록 |
| 상호작용 | 풀 CRUD — 노드/엣지 생성·삭제·수정, 드래그 배치, 속성 편집 |
| 규모 | 소규모 (10~100 노드) |
| 레이아웃 | 복수 전환 — Force, Hierarchical, Radial, Circular 등 |
| 캔버스 연동 | 없음 (독립적) |
| 데이터 저장 | `.vync` 확장자 유지 + `type` 필드 분기 (→ §4) |

---

## 3. 기술 결정

### 렌더링: React Flow (@xyflow/react)

| | |
|---|---|
| 선택 | **React Flow v12** (MIT, 35.6k stars) |
| 핵심 이유 | 노드가 React 컴포넌트 → 속성 인스펙터를 JSX로 자연스럽게 구현 |

**왜 React Flow인가:**

- **Vync 스택 일치** — React 19 + TypeScript + Vite 6. 노드가 React 컴포넌트이므로 기존 Vync 패턴(FileBoard, TabBar)과 동일한 방식으로 개발. 상태 관리도 React state/hooks 그대로 사용.

- **AI 편집 호환** — 데이터 구조가 `{ nodes: [...], edges: [...] }` 형태의 단순 JSON. vync-translator sub-agent가 직관적으로 생성·수정 가능. 현재 `.vync` 파일 포맷(`{ elements: [...] }`)과 구조적으로 유사.

- **속성 패널 구현** — 노드 자체가 React 컴포넌트이므로 폼, 뱃지, 타입 표시를 JSX로 자유롭게 구현. 사이드바 속성 인스펙터도 React state 연결만으로 완성.

- **빠른 프로토타입** — 35k stars 커뮤니티, 풍부한 튜토리얼·예제. React 개발자에게 가장 낮은 러닝커브.

**기각된 대안:**

| 후보 | 기각 이유 |
|------|-----------|
| G6 (AntV) | 레이아웃 12+ 내장이지만, React는 extension 레이어(v0.2.6 불안정). 영문 문서 부족. Canvas 렌더링이라 React DevTools 사용 불가. |
| Cytoscape.js | 그래프 이론 알고리즘 내장이지만, React 래퍼가 얇고 오래됨. 명령형 API. 노드에 React 컴포넌트 불가(캔버스 도형만). |
| Hybrid (React Flow + Graphology) | 최소 번들이지만, 이중 상태 동기화 복잡성. Graphology에 계층 레이아웃 미지원. 브릿지 코드 유지보수 부담. |

### 레이아웃: ELK.js

| | |
|---|---|
| 선택 | **ELK.js** (Eclipse Layout Kernel, WASM) |
| 핵심 이유 | 단일 라이브러리로 온톨로지에 필요한 레이아웃 4종 커버 |

**제공 레이아웃:**

| 알고리즘 | 온톨로지 용도 |
|----------|-------------|
| Layered (Hierarchical) | is-a, subclass 계층 시각화 |
| Stress (Force) | 관계 탐색, 자유 배치 |
| Mrtree | 트리 구조 (택소노미) |
| Radial | 특정 노드 중심 탐색 |

추가로 dagre(~8kB)를 보조 옵션으로 포함 가능.

> G6의 12+ 레이아웃 중 온톨로지에서 실제 사용되는 것은 Force, Hierarchical, Radial, Circular 4종. 나머지(MDS, Dendrogram, Grid 등)는 네트워크 분석/데이터 시각화 특화로, 온톨로지 편집에서의 실사용 빈도가 낮다.

---

## 4. 데이터 모델 (초안)

### 그래프 데이터 구조

```json
{
  "version": 1,
  "type": "graph",
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [
    {
      "id": "a1b2c",
      "type": "concept",
      "position": { "x": 100, "y": 200 },
      "data": {
        "label": "Person",
        "category": "class",
        "description": "A human being",
        "properties": {
          "name": { "type": "string", "required": true },
          "age": { "type": "number" }
        }
      }
    }
  ],
  "edges": [
    {
      "id": "e1f2g",
      "source": "a1b2c",
      "target": "h3i4j",
      "data": {
        "label": "is-a",
        "type": "inheritance"
      }
    }
  ]
}
```

**설계 원칙:**
- ID: 기존 Vync 관례 따름 — `idCreator(5)` (5자 랜덤)
- `type: "graph"` — 기존 캔버스(`type` 없음 또는 `"canvas"`)와 구분
- `data` 필드에 모든 시맨틱 속성 집중 — React Flow 규약 준수
- position은 레이아웃 엔진이 계산하되, 수동 드래그 결과도 저장

### 저장 방식: `.vync` + `type` 필드 분기

**결정**: 동일 `.vync` 확장자를 유지하고, 루트 `type` 필드로 시각화 유형을 구분한다.

```
캔버스: { version: 1,                viewport, elements: PlaitElement[] }
그래프: { version: 1, type: "graph", viewport, nodes: [...], edges: [...] }
```

- `type` 없음 → 캔버스 (하위 호환, 기존 파일 변경 불필요)
- `type: "graph"` → 그래프 뷰로 렌더링
- D-005(래핑 JSON) 호환: version + viewport 유지
- D-018(한 파일 = 한 유형) 준수: 한 파일은 canvas 또는 graph

**기각된 대안:**

| 대안 | 기각 사유 |
|------|----------|
| 별도 `.vync-graph` 확장자 | chokidar, CLI, security.ts, UTI, TabBar, Hub Server, FileRegistry 등 7곳 수정 필요. 향후 새 유형 추가 시마다 반복. |
| `elements[]`에 그래프 데이터 혼재 | PlaitElement[]와 GraphNode[]는 완전히 다른 스키마. 타입 안전성 훼손. |

### 인프라 영향 범위

동기화 파이프라인(chokidar → SyncService → SHA-256 → WebSocket → broadcast)은 **콘텐츠 무관**하게 동작한다. JSON blob 전체를 해싱/전송하므로 `nodes[]+edges[]` 구조여도 변경 없이 작동한다. Electron 실시간 동기화도 동일.

단, **3곳에 코드 수정이 필요하다:**

| 수정 지점 | 현재 | 변경 |
|----------|------|------|
| `VyncFile` 타입 (`packages/shared/src/types.ts`) | `{ elements: T[] }` 고정 | Discriminated union (`VyncCanvasFile \| VyncGraphFile`) |
| 서버 검증 (`tools/server/server.ts:201`) | `!Array.isArray(data.elements)` → 400 | `type` 기반 분기: `elements` 또는 `nodes+edges` 수용 |
| 프론트엔드 라우팅 (`apps/web/src/app/app.tsx`) | 항상 `FileBoard` 마운트 | `type` 기반: `FileBoard` 또는 `GraphView` |

### VyncFile 타입 설계

```typescript
// packages/shared/src/types.ts

interface VyncCanvasFile<T = unknown> {
  version: number;
  type?: 'canvas';     // 없으면 canvas (하위 호환)
  viewport: VyncViewport;
  elements: T[];
}

interface VyncGraphFile {
  version: number;
  type: 'graph';       // 필수
  viewport: VyncViewport;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type VyncFile<T = unknown> = VyncCanvasFile<T> | VyncGraphFile;

// 타입 가드
function isGraphFile(f: VyncFile): f is VyncGraphFile {
  return f.type === 'graph';
}
```

→ TypeScript discriminated union으로 `type` 필드 분기 시 올바른 필드 접근 자동 보장.

---

## 5. Vync 내 아키텍처

```
apps/web/src/
  app/
    app.tsx              ← 라우팅 분기 추가
    file-board.tsx       ← 기존 캔버스 (변경 없음)
    graph-view/          ← 새 디렉토리
      GraphView.tsx      ← React Flow 인스턴스 + 레이아웃 전환
      OntologyNode.tsx   ← 커스텀 노드 컴포넌트
      PropertyPanel.tsx  ← 사이드바 속성 인스펙터
      graph-types.ts     ← 타입 정의
```

- 기존 `file-board.tsx`와 완전 분리 — 공존하되 서로 import하지 않음
- 서버 동기화(WebSocket, chokidar) 기존 인프라 재사용 (동기화 파이프라인은 콘텐츠 무관)
- Electron 실시간 동기화 동일하게 동작 (수신 측 컴포넌트만 GraphView로 분기)

---

## 6. 참고 프로젝트

| 프로젝트 | 참고 포인트 | URL |
|----------|------------|-----|
| **Microsoft Ontology-Playground** | React+TS 온톨로지 에디터. 클릭→속성 인스펙터, 검색/필터, RDF 내보내기. **가장 직접적 참고** | github.com/microsoft/Ontology-Playground |
| **Gephi Lite** | React+Sigma.js+Graphology 아키텍처. 필터 파이프라인, SDK 분리 패턴 | github.com/gephi/gephi-lite |
| **Neo4j Browser** | 노드 속성 인스펙터 패널 UX. 클릭→사이드바 key-value 표시 | github.com/neo4j/neo4j-browser |
| **WebVOWL** | 온톨로지 시각 표기법 (원=클래스, 화살표=속성, 사각형=데이터타입) | github.com/VisualDataWeb/WebVOWL |

---

## 7. 통합 영향 범위 (기존 Vync 기능과의 접점)

Graph view는 독립 페이지이지만, Vync의 기존 기능과 맞닿는 지점이 있다.

### 반드시 수정 (구현 전제)

| 항목 | 영향 | 설명 |
|------|------|------|
| **VyncFile 타입** | `packages/shared/src/types.ts` | Discriminated union으로 확장 (→ §4) |
| **서버 검증** | `tools/server/server.ts:201` | `elements` OR `nodes+edges` 수용 |
| **프론트엔드 라우팅** | `apps/web/src/app/app.tsx` | 파일 로드 → `type` 확인 → 컴포넌트 분기 |

### 기능 통합 (그래프 기본 기능 구현 후)

| 항목 | 영향 | 설명 |
|------|------|------|
| **diff.ts 그래프 모드** | `tools/cli/diff.ts` | 현재는 PlaitElement[] 트리 기반 diff. 그래프는 플랫 노드 + 별도 엣지라 다른 diff 알고리즘 필요. D-015, D-017에 영향. |
| **vync-translator 그래프 지원** | `agents/vync-translator.md` | 다른 JSON 스키마, 다른 prose 표현. 그래프 모드 프롬프트 추가 또는 별도 translator. |
| **`/vync create` 유형 지정** | `commands/vync.md` | `--type graph` 옵션 추가. 빈 `{ type: "graph", nodes: [], edges: [] }` 생성. |
| **PostToolUse hook 분기** | `hooks/hooks.json` | 현재 PlaitElement[] 구조 검증. `type` 읽고 그래프 스키마 검증으로 분기. |

### 나중에 (UX 개선)

| 항목 | 설명 |
|------|------|
| Tab Bar 유형 표시 | 캔버스 탭과 그래프 탭의 시각적 구분 (아이콘/색상) |
| Undo/Redo | React Flow Pro 유료 기능. 소규모이므로 히스토리 스택 직접 구현 가능 |
| 내보내기 | JSON-LD, RDF, Turtle 등 온톨로지 표준 포맷 |
| noema-onto 통합 | AI 자동 온톨로지 구축과의 연결 |

---

## 8. 미결정 사항

| 항목 | 설명 | 결정 시점 |
|------|------|----------|
| Circular 레이아웃 | ELK.js 미지원. 별도 구현 or 라이브러리 추가 | 레이아웃 구현 시 |
| diff 알고리즘 설계 | 노드/엣지 ID 기반 비교 vs 구조적 비교 | diff.ts 확장 시 |
| 그래프 전용 translator | 기존 translator 확장 vs 별도 에이전트 | translator 통합 시 |

---

## 9. 제약 및 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| ELK.js WASM 초기 로드 (~180kB) | 첫 레이아웃 전환 시 지연 | lazy import + 로딩 인디케이터 |
| React Flow Pro 기능 의존 | undo/redo, grouping은 유료 | 필요 시 직접 구현 (소규모이므로 간단) |
| 온톨로지 스키마 복잡도 | 속성 타입 시스템이 깊어질 수 있음 | 1차는 단순 key-value, 점진 확장 |
| VyncFile 타입 변경 파급 | 기존 테스트·코드에서 `data.elements` 직접 접근 | 타입 가드 함수로 점진적 마이그레이션, 기존 파일 하위 호환 |
