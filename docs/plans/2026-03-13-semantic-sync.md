# D-017 Semantic Sync — 구현 계획

## Context

Vync diff 파이프라인이 구조적 변경("Moved: B — root → A")은 감지하지만, 사용자의 의미적 의도("B는 A에 종속되는 개념")를 안정적으로 추론하지 못함. D-017 설계 문서(`docs/plan/2026-03-13-semantic-sync-design.md`)에서 해석 레벨 체계, 시각화 유형별 규칙, 구조화된 반환 포맷, 모호성 처리 전략을 정의함. 이 계획은 해당 설계를 구현.

**결정 사항:**
- 해석 주체: Sub-agent 중심 유지 (D-013)
- 반환 포맷: Read만 4-필드 구조화 (요약/의도/확신/제안), create/update 현행 유지
- 모호성: 추론 + 자연스러운 확인

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

### 1-2. 시각화 유형 감지 함수
**File**: `tools/cli/diff.ts` (신규 함수)

elements의 root 노드 구조로 유형 판단:
- `type === 'mindmap'` → mindmap
- `type === 'geometry'` + arrow-line 존재 → flowchart
- 기타 → generic

### 1-3. semanticHint 생성 규칙
**File**: `tools/cli/diff.ts` (computeDiff 내부 또는 별도 함수)

Mindmap 규칙:
- `moved` to child: `"위계 변경: {text}가 {toParent}의 하위 개념으로 재분류됨"`
- `moved` to root: `"독립화: {text}가 {fromParent}에서 분리되어 독립 개념으로"`
- `moved` sibling transfer: `"재분류: {text}가 {fromParent}가 아닌 {toParent}의 하위로"`
- `added`: `"개념 추가: {text}가 {parent}의 새 하위 요소로"`
- `removed`: `"개념 제거: {text}가 {parent}에서 삭제됨"`
- `modified`: `"재정의: {oldText} → {newText}"`

복합 패턴 (computeDiff 후처리):
- 여러 노드가 같은 parent로 moved → `"그룹화: [{texts}]가 {parent} 하위로 통합"`

### 1-4. formatDiffResult에 hint 포함
**File**: `tools/cli/diff.ts:262-291`

변경사항 출력에 semanticHint 추가:
```
변경사항:
  Moved: 리서치 — 프로젝트 → 기획
    → 위계 변경: 리서치가 기획의 하위 개념으로 재분류됨
```

### 1-5. 테스트 추가
**File**: `tools/cli/__tests__/diff.test.ts`

- 시각화 유형 감지 테스트 (mindmap/flowchart/generic)
- semanticHint 생성 테스트 (moved/added/removed/modified)
- 복합 패턴 테스트 (다중 노드 그룹화)
- formatDiffResult hint 포함 테스트

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

### 3-1. commands/vync.md Read 절차 확장
**File**: `commands/vync.md:59-75`

Read 절차의 step 5 확장:
```markdown
5. Sub-agent의 구조화된 반환을 활용:
   - **확신 높음**: 의도를 대화에 자연스럽게 반영 + 제안 전달
     예: "기획의 세부 활동으로 리서치를 보시는 것 같은데, 개발 쪽도 정리할까요?"
   - **확신 중간**: 추론 언급 + 확인 포함
     예: "A-B, C-D로 묶으셨네요. 이 구분으로 진행할까요?"
   - **확신 낮음**: 요약만 전달, 의도 추론 언급 안 함
     예: "구조에 큰 변화는 없네요."
```

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
| `tools/cli/diff.ts` | semanticHint 필드, 유형 감지, hint 생성 규칙, 포맷 |
| `tools/cli/__tests__/diff.test.ts` | semantic hint 테스트 추가 |
| `agents/vync-translator.md` | Read 반환 포맷 구조화, 해석 가이드 |
| `commands/vync.md` | Read 절차에 확신 레벨별 활용 가이드 |

## Reusable Functions
- `flattenElements()` — `tools/cli/diff.ts:67` (기존, 재활용)
- `findParentText()` — `tools/cli/diff.ts:124` (기존, 재활용)
- `computeDiff()` — `tools/cli/diff.ts:135` (확장)
- `formatDiffResult()` — `tools/cli/diff.ts:262` (확장)
