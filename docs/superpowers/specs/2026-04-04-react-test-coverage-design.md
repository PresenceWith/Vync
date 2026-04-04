# I-007 React 컴포넌트 테스트 커버리지 — 설계

## 목표

React 컴포넌트의 핵심 로직과 UI 인터랙션에 대한 테스트 커버리지를 확보한다.

## 접근 방식: 하이브리드 (추출 + RTL)

핵심 로직은 순수 함수로 추출하여 유닛 테스트, UI 인터랙션은 RTL 렌더링 테스트.

## 인프라

- 기존 vitest + jsdom + @testing-library/react 사용 (추가 의존성 없음)
- 컴포넌트 테스트 파일 상단에 `// @vitest-environment jsdom` 지시어
- 별도 setup 파일 불필요

## 테스트 대상

### 1. computeElementDiff() — 순수 유닛 테스트

`file-board.tsx`의 `applyExternalChanges()`에서 diff 계산 로직만 순수 함수로 추출.

**추출 위치**: `apps/web/src/app/board-utils.ts`

```ts
interface DiffOps {
  removes: number[];  // 삭제할 인덱스 (역순)
  sets: { index: number; properties: Record<string, unknown>; newProperties: Record<string, unknown> }[];
  inserts: { index: number; element: { id: string; [key: string]: unknown } }[];
}

function computeElementDiff(
  current: { id: string; [key: string]: unknown }[],
  next: { id: string; [key: string]: unknown }[]
): DiffOps
```

Transforms 적용은 `file-board.tsx`에 남긴다 (board 인스턴스 필요).

**테스트 케이스**:
- 동일 배열 → 빈 ops
- 요소 삭제 → removes에 역순 인덱스
- 요소 속성 변경 → sets에 변경된 properties/newProperties
- 요소 추가 → inserts에 새 요소 + 인덱스
- 복합 변경 (삭제+수정+추가 동시)
- 빈 배열 → 빈 배열: 빈 ops
- 빈 배열 → N개: 전부 insert
- N개 → 빈 배열: 전부 remove
- id 순서 변경 (재배치)

### 2. computeLabels() — 순수 유닛 테스트

`tab-utils.ts`에 이미 추출된 순수 함수. 테스트만 추가.

**테스트 파일**: `apps/web/src/app/tab-utils.test.ts`

**테스트 케이스**:
- 단일 파일 → basename만
- 중복 basename → parent/basename 형식
- 빈 배열 → 빈 배열
- 경로 깊이 1 (파일명만) → 그대로 반환

### 3. TabBar — RTL 렌더링 테스트

props 기반 순수 UI 컴포넌트. Plait/React Flow 의존성 없음.

**테스트 파일**: `apps/web/src/app/tab-bar.test.tsx`

**테스트 케이스**:
- 탭 렌더링: tabs prop에 따라 탭이 렌더됨
- 활성 탭: activeFilePath에 해당하는 탭에 active 클래스
- 탭 클릭: onTabClick 콜백 호출
- 닫기 버튼: onTabClose 콜백 호출, 이벤트 전파 차단
- `+` 버튼: 드롭다운 토글
- Reopen 섹션: unopened 파일 표시
- Open 섹션: discovered 파일 표시
- 빈 상태: "No files found" 메시지

## 제외 범위 + 근거

| 대상 | 근거 |
|------|------|
| `App` (app.tsx) | WS/fetch mock 비용 과다, type 분기는 한 줄 |
| `useBoard` hook | useContext wrapper 10줄, YAGNI |
| `usePluginEvent`, `useBoardEvent` | Plait board에 강결합, mock 비용 > 가치 |
| `packages/react-text/` | Slate 에디터에 강결합 |
| `packages/react-board/wrapper.tsx` | upstream 코드 성격 |
| WS reconnect 통합 테스트 | e2e 범위, 실제 WS 서버 필요 |

## 파일 구조

```
apps/web/src/app/
  board-utils.ts           ← computeElementDiff() 추출 (신규)
  board-utils.test.ts      ← 순수 유닛 테스트 (신규)
  tab-utils.test.ts        ← computeLabels() 유닛 테스트 (신규)
  tab-bar.test.tsx         ← RTL 렌더링 테스트 (신규)
  file-board.tsx           ← applyExternalChanges()가 computeElementDiff() 호출하도록 수정
```

## 완료 기준

- 테스트 파일 3개, 최소 20개 테스트 케이스
- `npx vitest run` 전체 PASS
- computeElementDiff의 remove/set/insert 3단계 각각 검증됨
