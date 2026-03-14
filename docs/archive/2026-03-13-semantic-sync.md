# D-017 Semantic Sync — 구현 계획

## Context

Vync diff 파이프라인이 구조적 변경("Moved: B — root → A")은 감지하지만, 사용자의 의미적 의도("B는 A에 종속되는 개념")를 안정적으로 추론하지 못함. D-017 설계 문서(`docs/archive/2026-03-13-semantic-sync-design.md`)에서 해석 레벨 체계, 시각화 유형별 규칙, 구조화된 반환 포맷, 모호성 처리 전략을 정의함. 이 계획은 해당 설계를 구현.

**결정 사항:**
- 해석 주체: Sub-agent 중심 유지 (D-013)
- 반환 포맷: Read만 4-필드 구조화 (요약/의도/확신/제안), create/update 현행 유지
- 모호성: 추론 + 자연스러운 확인

**구현 세부 결정 (2026-03-13 확정):**

| # | 항목 | 결정 | 근거 |
|---|------|------|------|
| S-1 | 시각화 유형 감지 단위 | **파일 레벨** | 혼합 캔버스 자체를 방지 (→ D-018). generic 폴백으로 안전. |
| S-2 | 복합 패턴 범위 (Phase 1) | **다중 moved(그룹화)만** | 가장 빈번하고 의미 명확. moved+modified 결합은 관찰 후 결정. |
| S-3 | 확신 낮음 시 메인 세션 행동 | **간략히 언급** | "구조에 약간 변화가 있네요" — 무시보다 안전, noise 최소. |
| S-4 | semanticHint 생성 위치 | **computeDiff와 분리** | enrichWithSemanticHints() 별도 함수. 기존 테스트 무변경, semantic 테스트 독립. |

---

## Phase 1: diff.ts semantic annotation (~50 LOC)

### 1-1. DiffChange 타입 확장
**File**: `tools/cli/diff.ts:15-20`

```typescript
interface DiffChange {
  kind: 'added' | 'removed' | 'modified' | 'moved';
  id: string;
  text: string;
  detail: string;
  semanticHint?: string;  // 시각화 유형별 의미 annotation
}
```

### 1-2. 시각화 유형 감지 함수 (S-1: 파일 레벨)
**File**: `tools/cli/diff.ts` (신규 함수)

elements의 root 노드 구조로 **파일 전체** 유형 판단:
- `type === 'mindmap'` → mindmap
- `type === 'geometry'` + arrow-line 존재 → flowchart
- 기타 → generic (hint 생략)

> **S-1 근거**: 혼합 캔버스는 D-018에 의해 구조적으로 방지됨.
> 새로운 시각화 유형이 필요하면 별도 파일을 생성하므로, 파일 레벨 감지로 충분.

### 1-3. enrichWithSemanticHints 함수 (S-4: computeDiff와 분리)
**File**: `tools/cli/diff.ts` (신규 함수, computeDiff 외부)

```typescript
function enrichWithSemanticHints(
  changes: DiffChange[],
  vizType: 'mindmap' | 'flowchart' | 'generic',
  currentMap: Map<string, FlatNode>,
  snapshotMap: Map<string, FlatNode>
): DiffChange[]
```

> **S-4 근거**: computeDiff는 순수 구조적 diff만 담당. semantic layer를 분리하여
> 기존 테스트 무변경, semantic 테스트 독립 작성 가능.

**개별 hint 생성 규칙** (Mindmap):
- `moved` to child: `"위계 변경: {text}가 {toParent}의 하위 개념으로 재분류됨"`
- `moved` to root: `"독립화: {text}가 {fromParent}에서 분리되어 독립 개념으로"`
- `moved` sibling transfer: `"재분류: {text}가 {fromParent}가 아닌 {toParent}의 하위로"`
- `added`: `"개념 추가: {text}가 {parent}의 새 하위 요소로"`
- `removed`: `"개념 제거: {text}가 {parent}에서 삭제됨"`
- `modified`: `"재정의: {oldText} → {newText}"`

**복합 패턴** (S-2: 다중 moved만):
- 여러 노드가 같은 parent로 moved → `"그룹화: [{texts}]가 {parent} 하위로 통합"`
  - 개별 moved hint를 그룹화 hint로 교체

> **S-2 근거**: moved+modified 결합("재해석")은 Phase 1에서 제외.
> 실사용 데이터를 관찰한 후 필요시 추가. 현재는 각각 개별 hint로 표시.

**Flowchart/Generic**: Phase 1에서는 generic과 동일하게 hint 생략. 필요시 후속 확장.

### 1-4. vyncDiff에서 enrichment 호출
**File**: `tools/cli/diff.ts` (vyncDiff 함수 내)

```typescript
// 기존
let changes = computeDiff(currentElements, snapshotElements);

// 추가
const vizType = detectVizType(currentElements);
changes = enrichWithSemanticHints(changes, vizType, currentMap, snapshotMap);
```

> Note: currentMap/snapshotMap을 computeDiff 외부에서 접근해야 하므로,
> flattenElements 호출을 vyncDiff로 올리거나 computeDiff에서 map을 반환하는 구조 필요.

### 1-5. formatDiffResult에 hint 포함
**File**: `tools/cli/diff.ts:262-291`

변경사항 출력에 semanticHint 추가:
```
변경사항:
  Moved: 리서치 — 프로젝트 → 기획
    → 위계 변경: 리서치가 기획의 하위 개념으로 재분류됨
```

### 1-6. 테스트 추가
**File**: `tools/cli/__tests__/diff.test.ts`

기존 `computeDiff` 테스트: **변경 없음** (S-4)

신규 `enrichWithSemanticHints` 테스트:
- 시각화 유형 감지 테스트 (mindmap/flowchart/generic)
- 개별 semanticHint 생성 (moved/added/removed/modified)
- 복합 패턴: 다중 moved 그룹화 (S-2)
- generic 유형: hint 생략 확인
- formatDiffResult hint 포함 출력

---

## Phase 2: translator prompt 강화 (~30 LOC)

### 2-1. Read 반환 포맷 변경
**File**: `agents/vync-translator.md:34-43`

현재: "한 줄 요약만 반환. 추가 설명 불필요."
변경: Read에 한해 4-필드 구조화 반환

```markdown
## 반환 포맷

**create**: 한 줄 요약. 예: `"mindmap: 프로젝트 > [기획, 개발, 출시]"`
**update**: 한 줄 요약. 예: `"updated: 개발 > [FE, BE, +테스트, +CI/CD]"`

**read (변경 있음)**: 구조화 반환 (3-5줄)
```
요약: <구조적 변경의 사실적 기술>
의도: <변경이 시사하는 사용자의 생각/판단 추론>
확신: <높음|중간|낮음> (<근거>)
제안: <추론 기반 다음 행동 제안, optional>
```

**read (변경 없음)**: `"요약: 변경 없음"`
**실패**: `"error: <설명>"`
```

### 2-2. Read 절차에 해석 가이드 추가
**File**: `agents/vync-translator.md:56-63`

```markdown
### Read
1. 전달받은 diff 결과를 분석
2. **semanticHint가 있으면 이를 기반으로**, 없으면 구조+유형에서 직접 추론
3. 대화 맥락과 결합하여 "사용자의 생각이 어떻게 변했는지" 번역
4. 확신 레벨 판단:
   - 높음: mindmap 위계 변경, 명확한 추가/삭제
   - 중간: 다중 동시 이동, 복합 변경
   - 낮음: 의미 불분명한 소규모 변경
5. 반환: 4-필드 구조화 (요약/의도/확신/제안)
```

---

## Phase 3: 메인 세션 활용 패턴 (~15 LOC)

### 3-1. commands/vync.md Read 절차 확장 (S-3: 확신 낮음 간략 언급)
**File**: `commands/vync.md:59-75`

Read 절차의 step 5 확장:
```markdown
5. Sub-agent의 구조화된 반환을 활용:
   - **확신 높음**: 의도를 대화에 자연스럽게 반영 + 제안 전달
     예: "기획의 세부 활동으로 리서치를 보시는 것 같은데, 개발 쪽도 정리할까요?"
   - **확신 중간**: 추론 언급 + 확인 포함
     예: "A-B, C-D로 묶으셨네요. 이 구분으로 진행할까요?"
   - **확신 낮음**: 요약(사실)만 간략히 언급, 의도 추론은 하지 않음
     예: "구조에 약간 변화가 있네요."
```

> **S-3 근거**: 변경을 완전히 무시하면 사용자의 의도적 변경을 놓칠 위험.
> 간략히 언급하면 사용자가 필요시 이어서 말할 수 있고, 불필요하면 무시 가능.

---

## Verification

### 유닛 테스트
```bash
npx vitest run tools/cli/__tests__/diff.test.ts
```
- 기존 diff 테스트 전체 PASS (regression 없음)
- 신규 semantic hint 테스트 PASS

### 수동 검증
1. `.vync` 파일에서 mindmap 노드를 하위로 이동
2. `node bin/vync.js diff <file>` 실행 → semanticHint가 diff 출력에 포함되는지 확인
3. `/vync read` 실행 → translator가 4-필드 구조화 반환하는지 확인
4. 메인 세션이 확신 레벨에 따라 적절히 대화에 반영하는지 확인

### 플러그인 동기화
```bash
bash .claude-plugin/install.sh
```
→ 새 세션에서 변경된 translator prompt + vync.md 반영 확인

---

## Critical Files

| File | Change |
|------|--------|
| `tools/cli/diff.ts` | semanticHint 필드, detectVizType, enrichWithSemanticHints (신규), formatDiffResult 확장 |
| `tools/cli/__tests__/diff.test.ts` | enrichWithSemanticHints 테스트 추가 (기존 computeDiff 테스트 무변경) |
| `agents/vync-translator.md` | Read 반환 포맷 구조화, 해석 가이드, 한 파일=한 유형 원칙 (D-018) |
| `commands/vync.md` | Read 절차에 확신 레벨별 활용 가이드 (S-3 반영) |

## Reusable Functions
- `flattenElements()` — `tools/cli/diff.ts:67` (기존, 재활용)
- `findParentText()` — `tools/cli/diff.ts:124` (기존, 재활용)
- `computeDiff()` — `tools/cli/diff.ts:135` (**변경 없음**, S-4)
- `detectVizType()` — 신규, 파일 레벨 유형 감지 (S-1)
- `enrichWithSemanticHints()` — 신규, semantic layer 분리 (S-4)
- `formatDiffResult()` — `tools/cli/diff.ts:262` (확장, hint 포함)
