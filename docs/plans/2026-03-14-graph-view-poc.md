# Graph View PoC — 검증 계획

**Date**: 2026-03-14
**Status**: 기획 완료 (실행 전)
**선행**: `docs/plans/2026-03-14-graph-view-proposal.md`
**브랜치**: `feat/graph-view-poc` (develop에서 분기)

---

## 1. 목적

Graph View proposal(React Flow v12 + ELK.js)의 **기술적 리스크**를 최소 코드로 검증한다.
PoC 결과에 따라 Go / Conditional Go / No-Go를 판정하고, 구현 Phase 진입 여부를 결정한다.

---

## 2. 리스크 분류

### 검증 필요 (PoC 대상)

| ID | 리스크 | 심각도 | PoC |
|----|--------|--------|-----|
| R-1 | React Flow v12 + React 19 + Vite 6 호환 | High | A |
| R-2 | ELK.js 레이아웃 통합 (번들링 + 렌더링) | High | A |
| R-3 | React Flow CSS와 Plait CSS 충돌 | Medium | A |
| R-4 | 서버 PUT 검증에서 graph 파일 거부 (server.ts:201) | High | B |
| R-5 | PostToolUse hook이 graph 파일 거부 | Medium | B |
| R-6 | diff.ts가 graph 파일에서 조용히 오작동 | Medium | B |

### 코드 리뷰로 확인 (PoC 불필요)

| 리스크 | 근거 |
|--------|------|
| 동기화 파이프라인 호환 | SyncService는 런타임에서 content-agnostic (JSON 구조 무검사, 해싱/전송만). 단 TypeScript 타입이 `VyncFile<T>` (`elements: T[]` 필수)이므로 shim(`elements: []`) 없이는 타입 불일치 — shim으로 해결 |
| 탭 전환 호환 | `key={activeFilePath}` 기반 full unmount/remount, Hub WS는 content-agnostic |
| 번들 크기 영향 | React Flow ~150kB + ELK.js ~180kB = ~330kB. Electron DMG 121MB 대비 0.27% |

### 구현 Phase로 이관

| 리스크 | 이유 |
|--------|------|
| React Flow 양방향 동기화 (echo 방지) | PoC 범위 초과, Known Deferred Risk로 기록 |
| diff.ts 그래프 모드 | 별도 알고리즘 설계 필요 |
| vync-translator 그래프 지원 | 프롬프트 확장 |
| Electron WASM/asar 호환 | 기존 asar unpacked 패턴으로 해결 가능 |
| Circular 레이아웃 | ELK.js 미지원, 구현 시점에 결정 |

---

## 3. 사전 조사 (Pre-flight, ~2분)

실행 조건: 아래 모두 통과해야 PoC 코드 작성 시작.

| 항목 | 명령 | PASS 기준 | FAIL 시 |
|------|------|-----------|---------|
| React Flow peer dep | `npm info @xyflow/react peerDependencies` | `react: ">=17"` 포함 | React Flow 대안 재평가 |
| 패키지 설치 dry-run | `npm install --dry-run @xyflow/react elkjs` | peer dep 에러 없음 | `--legacy-peer-deps` 검토 |
| `.elements` 접근 지점 확인 | `grep -rn '\.elements' --include='*.ts' --include='*.tsx' --include='*.js'` | 목록 확보 (체크리스트용) | — |

---

## 4. PoC-A: React Flow + ELK.js 환경 통합

**가설**: React Flow v12와 ELK.js가 Vync의 React 19 + Vite 6 환경에서 정상 렌더링되고, 레이아웃 전환이 동작한다.

**반증 조건**: React Flow가 React 19에서 렌더링 실패, 또는 ELK.js 레이아웃 계산 결과가 React Flow 노드에 반영되지 않으면 FAIL.

**수정/생성 파일** (~90 LOC, 기존 코드 무변경):
- `package.json` — `@xyflow/react`, `elkjs` 추가
- `apps/web/src/app/graph-view/GraphView.tsx` — 최소 렌더링 + 레이아웃 전환

**ELK.js 전략**: `elkjs/lib/elk.bundled.js` (순수 JS) 사용. WASM 스킵. 10-100 노드 규모에서 성능 차이 무시 가능.

### 테스트 데이터 (하드코딩, proposal §4 온톨로지 예시 기반)

```
노드: Person(class), Employee(class), Company(class), name(property)
엣지: Employee →is-a→ Person, Employee →works-at→ Company, Person →has→ name
```

### 시나리오

| ID | 검증 내용 | PASS 기준 | FAIL 기준 |
|----|----------|-----------|-----------|
| A-1 | `npm install @xyflow/react elkjs` + `npm run build:web` | 빌드 성공, peer dep 에러 없음 | peer dep 충돌 또는 빌드 실패 |
| A-2 | GraphView 렌더링 (Vite dev 서버) | 4노드 + 3엣지 화면 표시, 드래그 가능, 콘솔 에러 없음 | 렌더링 안 됨 또는 React 에러 |
| A-3 | ELK.js 레이아웃 전환 (Hierarchical ↔ Stress) | 버튼 클릭 시 노드 위치 변경 (최소 2개 노드가 50px 이상 이동), 노드 겹침 없음 | 레이아웃 계산 실패 또는 위치 미반영 |
| A-4 | `npm run build:web` 프로덕션 빌드 | 빌드 성공, dist에 React Flow + ELK.js 포함 | 빌드 실패 |
| A-5 | CSS 충돌 확인 | React Flow `.react-flow` 스타일과 Plait 스타일 간 z-index/overflow/position 충돌 없음 (DevTools 확인) | 시각적 깨짐 또는 레이아웃 붕괴 |

### GraphView 최소 스펙

```tsx
// useState + onNodesChange 포함 (controlled component 패턴 검증)
const [nodes, setNodes] = useState<Node[]>(initialNodes);
const [edges, setEdges] = useState<Edge[]>(initialEdges);
const onNodesChange = useCallback(
  (changes) => setNodes(nds => applyNodeChanges(changes, nds)), []
);
```

- 하드코딩 데이터를 `useState`로 관리 (재사용 가능)
- `onNodesChange` 핸들러 포함 (React Flow controlled component 패턴 검증)
- 레이아웃 전환 UI: 버튼 2개 (Hierarchical / Stress)

### 실패 시 대안

| 실패 항목 | 대안 | 영향 |
|----------|------|------|
| React 19 peer dep 충돌 | `--legacy-peer-deps` 또는 React Flow canary | 장기 유지보수 리스크 주시 |
| ELK.js bundled.js 실패 | dagre (~8kB) 단독 사용 (Hierarchical만) | 레이아웃 종류 축소 |
| React Flow 자체 비호환 | Cytoscape.js + React 래퍼 재평가 | proposal §3 기술 결정 전체 재검토 |
| CSS 충돌 | CSS Modules 또는 Shadow DOM 격리 | 구현 복잡도 증가 |

---

## 5. PoC-B: 서버 호환성 (Shim 접근법)

**가설**: graph type `.vync` 파일이 기존 동기화 파이프라인(서버 검증 → SyncService → chokidar → WS)을 통과하고, 기존 95+ 테스트에 regression이 없다.

**반증 조건**: graph 파일 PUT 시 서버가 400을 반환하거나, 기존 테스트가 1개 이상 실패하면 FAIL.

**핵심 전략 — Shim 접근법**:
- `VyncFile` 타입을 discriminated union으로 변경하지 **않는다** (구현 Phase로 이관)
- graph 파일에 `elements: []`를 포함시켜 기존 검증을 통과시킨다
- `server.ts`의 검증만 `type` 기반 분기로 최소 수정
- 이유: discriminated union 변경 시 10개 파일 17개 `.elements` 접근 지점에 파급 — PoC 범위 초과
  - 대상 파일: `server.ts`, `file-board.tsx`, `validate.js`, `diff.ts`, `json.ts`, `app-menu-items.tsx`, `init.test.ts`, `sync-drain.test.ts`, `put-broadcast.test.ts`, `multi-file-e2e.test.ts`

**수정 파일** (~40 LOC):
- `tools/server/server.ts` — PUT 검증 type 분기 (~10 LOC)
- `hooks/hooks.json` — PostToolUse 검증에 type 가드 (~5 LOC)
- `tools/cli/diff.ts` — graph 파일 가드 (~5 LOC)
- `skills/vync-editing/scripts/validate.js` — type 가드 (~5 LOC)

### Graph 파일 형태 (Shim)

```json
{
  "version": 1,
  "type": "graph",
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "elements": [],
  "nodes": [
    { "id": "a1b2c", "type": "concept", "position": { "x": 100, "y": 200 },
      "data": { "label": "Person", "category": "class" } }
  ],
  "edges": [
    { "id": "e1f2g", "source": "a1b2c", "target": "h3i4j",
      "data": { "label": "is-a", "type": "inheritance" } }
  ]
}
```

`elements: []`는 기존 코드 호환을 위한 shim. 구현 Phase에서 discriminated union 전환 시 제거.

### 시나리오

| ID | 검증 내용 | PASS 기준 | FAIL 기준 |
|----|----------|-----------|-----------|
| B-1 | graph 파일 `PUT /api/sync` | 200 응답 | 400 또는 서버 에러 |
| B-2 | canvas 파일 PUT 기존 동작 유지 | 200 응답, 기존과 동일 | 기존 동작 변경 |
| B-3 | `npm test` 전체 | 기존 전체 테스트 PASS (현재 95개), 0 regression | 1개 이상 실패 |
| B-4 | graph.vync 외부 수정 → WS 수신 | `wscat -c ws://localhost:3100/ws?file=<path>` 로 구독 후 텍스트 에디터로 graph.vync 수정 → `file-changed` 메시지 수신 (nodes/edges JSON 포함) | WS 메시지 미수신 또는 JSON 구조 누락 |
| B-5 | PostToolUse hook graph 파일 처리 | graph 파일 Write 시 에러 메시지 없음 (type 가드 동작) | `elements must be array` 에러 출력 |
| B-6 | diff.ts graph 파일 가드 | `/vync read` on graph.vync → "Graph files are not yet supported by diff" 메시지 | 빈 결과 출력 또는 `.lastread` 스냅샷 생성 (graph diff 미지원 상태에서 잘못된 스냅샷이 생성되면 오염) |

### 실패 시 대안

| 실패 항목 | 대안 |
|----------|------|
| server.ts 분기 실패 | 별도 `/api/graph-sync` 엔드포인트 |
| Shim 접근법 부작용 | `elements: []` 없이, 검증 완전 분기 (LOC 증가) |
| 기존 테스트 실패 | 실패 테스트 분석 → 타입 가드 적용 범위 파악 (유의미한 PoC 결과) |

---

## 6. 통합 체크리스트 (코드 없음)

PoC-A + PoC-B 모두 PASS 후, 구현 Phase 시작 전 확인 사항.

- [ ] **App.tsx 타입 감지**: Metadata GET 방식 확정 — `GET /api/sync?file=` → `data.type` 확인 → 컴포넌트 분기
- [ ] **FileBoard 동기화 패턴 복제 목록**:
  - [ ] 파일 스코프 WS 연결 (`/ws?file=path`)
  - [ ] 초기 데이터 GET + 404 시 자동 등록
  - [ ] Echo 방지 (`remoteUpdateUntilRef`, 500ms 타임스탬프)
  - [ ] 300ms 디바운스 PUT
  - [ ] unmount cleanup (WS close, reconnect 타이머 해제)
- [ ] **React Flow echo 방지 전략 초안**: `onNodesChange` + `remoteUpdateUntilRef` 통합 방식
- [ ] **`key={activeFilePath}` 기반 cleanup 패턴**: GraphView에 동일 패턴 적용 확인
- [ ] **idCreator 분리**: `@vync/shared`에 `generateId()` 유틸리티 추출 필요 여부

---

## 7. Go/No-Go 판정

| 판정 | 조건 | 행동 |
|------|------|------|
| **Go** | PoC-A + PoC-B 전체 PASS | writing-plans 스킬로 구현 계획 작성 |
| **Conditional Go** | 부분 실패이나 대안 존재 | proposal 수정 후 구현 Phase |
| **No-Go** | React Flow 근본 비호환 또는 서버 호환 불가 | proposal §3 기술 결정 전체 재검토 |

### Conditional Go 시나리오

| 실패 항목 | 대안 | 영향 |
|----------|------|------|
| ELK.js bundled.js 실패 | dagre 단독 | 레이아웃 종류 축소 (Hierarchical만) |
| React Flow peer dep 충돌 | `--legacy-peer-deps` | 장기 리스크 주시 |
| CSS 충돌 | CSS Modules 격리 | 구현 복잡도 소폭 증가 |
| 일부 테스트 실패 | 타입 가드 범위 목록화 → 구현 Phase에서 점진적 수정 | 일정 증가 |

---

## 8. Known Deferred Risks

PoC 범위 밖이지만, 구현 Phase에서 반드시 해결해야 할 리스크.

### 8-1. React Flow 양방향 동기화 (최대 리스크)

FileBoard는 `remoteUpdateUntilRef.current = Date.now() + 500`으로 echo를 방지한다.
React Flow의 controlled component API(`nodes`/`edges` state + `onNodesChange`/`onEdgesChange`)는 Plait의 `onChange`와 다른 패턴이므로, echo 방지 메커니즘을 React Flow에 맞게 재설계해야 한다.

특히 문제되는 시나리오:
- 유저가 노드를 드래그 중일 때 WS 업데이트가 도착하면?
- 유저가 속성 패널에서 편집 중일 때 같은 노드의 WS 업데이트가 도착하면?

### 8-2. VyncFile Discriminated Union 리팩토링

PoC에서는 shim 접근법(`elements: []` 포함)을 사용한다.
구현 Phase에서 `VyncCanvasFile | VyncGraphFile` discriminated union으로 전환 시:
- 10개 파일, 17개 `.elements` 접근 지점에 타입 가드 적용 필요
- `.vync.schema.json`, `skills/vync-editing/assets/schema.json` 스키마 업데이트 필요
- 기존 graph 파일에서 `elements: []` shim 제거

### 8-3. Electron 환경

React Flow + ELK.js가 Electron esbuild 번들에서 동작하는지 확인 필요.
기존 asar unpacked 패턴(`fcba037`)으로 해결 가능할 것으로 예상.

---

## 9. PoC 코드 재사용성

| PoC | 재사용 비율 | 설명 |
|-----|-----------|------|
| PoC-A GraphView.tsx | ~60% | 컴포넌트 골격 + ELK 레이아웃 호출 재사용. 동기화 통합 + CRUD UI 추가 필요 |
| PoC-B server.ts 분기 | ~100% | type 분기 로직 그대로 사용 |
| PoC-B diff.ts 가드 | ~100% | graph 가드 그대로 유지 (구현 Phase에서 실제 graph diff 로직 추가) |
| PoC-B hook 가드 | ~80% | type 가드 유지, graph 전용 검증 로직 추가 |

---

## 10. 실행 요약

```
Pre-flight (2분)
  ↓
PoC-A: React Flow + ELK.js (~90 LOC, 격리)
  - A-1 ~ A-5
  ↓ PASS 시
PoC-B: 서버 호환성 (~40 LOC, shim)
  - B-1 ~ B-6
  ↓ PASS 시
통합 체크리스트 (코드 없음)
  ↓
Go / No-Go 판정
```

**총 예상**: ~130 LOC, 2개 PoC + 1개 체크리스트
**이전 PoC 대비**: diff-pipeline PoC (3/3 시나리오)와 동일한 가설-반증 구조 채택

**PoC-A → PoC-B 순서 근거**: PoC-A(React Flow)가 최고 불확실성. FAIL 시 서버 수정(PoC-B) 자체가 불필요해지므로, 불확실성이 높은 쪽을 먼저 검증하여 낭비 방지. 두 PoC는 코드 수정 영역이 겹치지 않아 기술적으로는 독립적이나, 의사결정 의존성이 있다.

---

## 11. Rollback (No-Go 시)

No-Go 판정 시 정리 절차:

1. `feat/graph-view-poc` 브랜치 삭제 — main/develop 변경 없음
2. PoC 코드는 브랜치에만 존재하므로 다른 작업에 영향 없음
3. `package-lock.json`에 추가된 `@xyflow/react`, `elkjs` — 브랜치 삭제로 자동 정리
4. 이 문서(`docs/plans/2026-03-14-graph-view-poc.md`)는 develop에 남겨 의사결정 기록 보존

---

## 12. 참고

- **ELK.js WASM vs 순수 JS**: proposal(§3)에서는 ELK.js를 "WASM"으로 기술했으나, PoC에서는 `elkjs/lib/elk.bundled.js` (순수 JS)를 사용하여 WASM 관련 리스크를 분리한다. 10-100 노드 규모에서 순수 JS 성능은 충분. 필요 시 구현 Phase에서 WASM으로 전환.
- **Shim과 server.ts 관계**: graph 파일에 `elements: []` shim이 포함되므로, 현재 `server.ts:201`의 `Array.isArray(data.elements)` 검증은 shim만으로도 통과한다. 그럼에도 server.ts에 type 분기를 추가하는 이유는: (1) 구현 Phase에서 shim 제거 시 대비, (2) graph 파일의 실제 데이터인 `nodes`/`edges` 존재를 명시적으로 검증.
- **PostToolUse hook**: shim 포함 graph 파일은 현재 hook의 `Array.isArray(d.elements)` 검사를 통과한다. type 가드를 추가하는 이유는 `elements` 외 graph 전용 필드(nodes, edges)의 구조적 무결성도 확인하기 위함.
