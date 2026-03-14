# Graph View — 온톨로지/지식 그래프 편집기

**Date**: 2026-03-13
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
| 데이터 저장 | **미결정** — 기술 결정 후 별도 확정 |

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

### 저장 방식 (미결정)

| 옵션 | 장점 | 단점 |
|------|------|------|
| `.vync` 파일 확장 | 기존 인프라(서버, 동기화, CLI) 재사용 | `elements[]`와 `nodes[]+edges[]` 혼재 |
| 별도 `.vync-graph` 파일 | 관심사 분리 명확 | 새 파일 타입 등록, CLI 수정 |
| 동일 `.vync` + `type` 필드 분기 | 파일 포맷 통합, 서버 변경 최소 | 렌더러 분기 로직 필요 |

→ **구현 시작 전에 확정 필요.** D-005(파일 포맷), D-018(한 파일 = 한 시각화 유형)과의 정합성 검토.

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
- 서버 동기화(WebSocket, chokidar)는 기존 인프라를 재사용할 수 있으나, 저장 방식 확정 후 결정
- Electron에서도 동일하게 동작 (웹 뷰 기반)

---

## 6. 참고 프로젝트

| 프로젝트 | 참고 포인트 | URL |
|----------|------------|-----|
| **Microsoft Ontology-Playground** | React+TS 온톨로지 에디터. 클릭→속성 인스펙터, 검색/필터, RDF 내보내기. **가장 직접적 참고** | github.com/microsoft/Ontology-Playground |
| **Gephi Lite** | React+Sigma.js+Graphology 아키텍처. 필터 파이프라인, SDK 분리 패턴 | github.com/gephi/gephi-lite |
| **Neo4j Browser** | 노드 속성 인스펙터 패널 UX. 클릭→사이드바 key-value 표시 | github.com/neo4j/neo4j-browser |
| **WebVOWL** | 온톨로지 시각 표기법 (원=클래스, 화살표=속성, 사각형=데이터타입) | github.com/VisualDataWeb/WebVOWL |

---

## 7. 미결정 사항

| 항목 | 설명 | 결정 시점 |
|------|------|----------|
| 데이터 저장 방식 | `.vync` 확장 vs 별도 파일 vs `type` 분기 | 구현 시작 전 |
| Circular 레이아웃 | ELK.js 미지원. 별도 구현 or 라이브러리 추가 | 레이아웃 구현 시 |
| 서버 동기화 범위 | 기존 Hub Server 재사용 여부 | 저장 방식 확정 후 |
| 내보내기 포맷 | JSON-LD, RDF, Turtle 등 | 기본 기능 완성 후 |
| noema-onto 통합 | AI 자동 온톨로지 구축과의 연결 | 기본 기능 완성 후 |

---

## 8. 제약 및 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| ELK.js WASM 초기 로드 (~180kB) | 첫 레이아웃 전환 시 지연 | lazy import + 로딩 인디케이터 |
| React Flow Pro 기능 의존 | undo/redo, grouping은 유료 | 필요 시 직접 구현 (소규모이므로 간단) |
| 온톨로지 스키마 복잡도 | 속성 타입 시스템이 깊어질 수 있음 | 1차는 단순 key-value, 점진 확장 |
