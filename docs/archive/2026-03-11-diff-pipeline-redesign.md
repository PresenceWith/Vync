# Diff Pipeline Redesign — Sub-agent를 시각화 전문가로

**Date**: 2026-03-11
**Status**: 구현 완료 (Phase A/C/D DONE, PR #9)

---

## 1. 현재 상태 분석

### Sub-agent(vync-translator)의 현재 역할
**"기계적 JSON 변환기"** — 메인 세션이 모든 판단을 하고, Sub-agent는 변환만 수행

| 작업 | 메인 세션이 하는 일 | Sub-agent가 하는 일 |
|------|-------------------|-------------------|
| Create | 대화에서 구조 추출 → 트리 prose 정리 | prose → JSON 변환 |
| Read | /vync read 호출 | JSON → prose 요약 + LLM diff |
| Update | 수정 지시를 자연어로 정리 | 지시대로 JSON 수정 |

### 3가지 Gap

**Gap 1: 맥락 단절**
- Sub-agent는 대화 맥락을 받지 않음
- "지금 무슨 논의 중인지" 모른 채 작업
- 시각화 전략 판단 불가 (맥락이 없으므로)

**Gap 2: Diff가 LLM 기반**
- Sub-agent가 두 JSON을 읽고 LLM으로 비교
- 비결정적, 복잡한 변경에서 누락 가능
- 정밀도 보장 불가

**Gap 3: 유저 피드백(diff)이 전달 안 됨**
- 유저가 브라우저에서 수정한 내용이 Create/Update 시 Sub-agent에 전달되지 않음
- "유저가 이전에 뭘 바꿨는지" 모르고 작업

---

## 2. 개선 방향

### Sub-agent 역할 재정의
**"기계적 JSON 변환기" → "시각화 전문가 (맥락 인지형)"**

Sub-agent의 2가지 역할:
1. **시각화 전략 결정**: 맥락 + diff를 보고 "어떤 부분을 어떻게 시각화할지" 판단
2. **시각화 실행**: 판단에 따라 .vync 파일 작성/수정

### 메인 세션 역할 변경
| | 현재 | 개선 후 |
|--|------|---------|
| 메인 세션 | 구조 정리 + prose 트리 작성 | 대화 맥락 요약 + diff 실행 |
| Sub-agent | prose → JSON 변환 | 맥락 분석 → 시각화 판단 → 실행 |

### 3단계 파이프라인

```
Stage 1: vync diff (프로그래밍적, 코드)
  .lastread vs .vync → 구조적 diff 텍스트
  정확, 빠름, 결정적

Stage 2: Sub-agent (시각화 전문가)
  입력: 맥락 + diff + 지시
  판단: "어떤 부분을 어떻게 시각화할지"
  실행: .vync 파일 작성/수정
  출력: 의미적 요약 (prose)

Stage 3: 메인 세션
  Sub-agent의 prose + 대화 맥락 → 인사이트/다음 행동
```

---

## 3. 입력 프로토콜 재설계

### 현재 prompt 구조
```
## 작업: Create
타입: mindmap
파일: /path/to/file.vync

## 구조
- 프로젝트 (root)
  - 기획
  - 개발
```

### 개선된 prompt 구조
```
## 작업: Create
파일: /path/to/file.vync

## 대화 맥락
현재 TDD 도입과 배포 전략을 논의 중. 유저는 테스팅을 개발 프로세스에
포함시키고 싶어하며, CI/CD 파이프라인도 관심 있음.

## 유저 피드백 (diff)
(첫 생성이므로 없음)

## 지시
현재 논의 내용을 시각화해줘. 적절한 형식과 구조를 판단해서.
```

### 작업별 prompt 템플릿

**Create**:
```
## 작업: Create
파일: <absolute_path>

## 대화 맥락
<메인 세션이 요약한 현재 논의 상황, 2-5문장>

## 유저 피드백 (diff)
없음 (첫 생성)

## 지시
<구체적 지시 or "맥락에 맞게 판단해서 시각화해줘">
<선호하는 유형이 있으면: "mindmap 형식으로" 등>
```

**Read**:
```
## 작업: Read
파일: <absolute_path>

## 대화 맥락
<현재 논의 상황>

## 유저 피드백 (diff)
<vync diff 실행 결과 — 프로그래밍적 diff 텍스트>
예:
  현재 구조:
    프로젝트 > [기획(인터뷰), 개발(FE, BE, 테스팅), 출시(마케팅, 배포)]
  변경사항:
    Added: 테스팅 (under 개발), 출시, 마케팅 (under 출시)
    Moved: 배포 from 프로젝트 → 출시
    Removed: 시장조사 (was under 기획)

## 지시
위 변경사항을 대화 맥락에 비춰 의미적으로 번역해줘. "유저의 생각이 어떻게 변화했는지"를 요약해줘.
```

**Update**:
```
## 작업: Update
파일: <absolute_path>

## 대화 맥락
<현재 논의 상황>

## 유저 피드백 (diff)
<vync diff 실행 결과 or "없음">

## 지시
<구체적 수정 지시 or "유저 피드백을 반영하여 적절히 보강해줘">
```

---

## 4. 구현 변경 목록

### 4-1. `tools/cli/diff.ts` (신규)
프로그래밍적 diff 엔진.

**기능:**
- `vync diff <file>` CLI 커맨드
- .lastread vs .vync 비교
- ID 기반 노드 매칭
- 레이아웃 변경(points, width, height) 자동 무시
- 현재 구조 트리 + 변경 목록 출력

**출력 포맷:**
```
=== Vync Diff: plan.vync ===

현재 구조:
  프로젝트
  ├── 기획 (인터뷰)
  ├── 개발 (FE, BE, 테스팅)
  └── 출시 (마케팅, 배포)

변경사항:
  Added: 테스팅 (under 개발)
  Added: 출시 (under 프로젝트)
  Added: 마케팅 (under 출시)
  Moved: 배포 — 프로젝트 → 출시
  Removed: 시장조사 (was under 기획)
  Modified: "Phase 9" → "Phase 9 ✅"

Snapshot updated.
```

**옵션:**
- `--no-snapshot`: diff만 보고 .lastread 갱신 안 함
- 기본: diff 후 .lastread 자동 갱신

**비교 알고리즘:**
1. 양쪽 elements를 재귀적으로 flatten → Map<id, {text, parentId}>
2. ID 집합 비교 → added, removed
3. 같은 ID의 text 비교 → modified
4. 같은 ID의 parentId 비교 → moved
5. points, width, height, manualWidth 등 레이아웃 필드 무시

### 4-2. `agents/vync-translator.md` (수정)

> **PoC 결과 참고**: 현재 프롬프트가 새 입력 형식(맥락+diff)을 이미 잘 처리함 (3/3 PASS).
> 아래 변경은 **품질 안정화**(권장)이며, 미적용 시에도 기본 동작은 보장됨.

**정체성 변경:**
```
당신은 Vync 시각화 전문가입니다.
대화 맥락과 유저 피드백을 이해하고,
적절한 시각적 표현을 판단하여 .vync 파일을 작성/수정합니다.
```

**추가할 섹션:**
```
## 시각화 판단 가이드

맥락에 따른 시각화 유형 선택:
- 계획/구조 정리 → mindmap
- 프로세스/흐름 → flowchart (geometry + arrow-line)
- 비교/분류 → mindmap with 병렬 가지
- 관계/연결 → flowchart

시각화 보강 원칙:
- 유저의 변경 의도를 존중: 추가한 것은 유지, 삭제한 것은 되살리지 않음
- 맥락에서 빠진 항목이 있으면 보강 제안 가능
- 과도한 세분화 지양: 2-3단계 깊이 권장 (부분적 4단계는 허용, 20노드 이내)
```

**Read 절차 변경:**
```
### Read
1. 전달받은 diff 결과를 분석 (직접 JSON 비교하지 않음!)
2. 대화 맥락과 결합하여 "생각의 변화"를 의미적으로 번역
3. 반환: 변화의 의미 요약
   예: "개발 프로세스에 테스팅이 추가되고, 기획의 리서치가 축소됨.
       실행 중심으로 구조가 이동하는 방향."
4. 스냅샷 갱신은 vync diff가 이미 처리 (sub-agent에서 안 함)
```

**Create 절차 변경:**
```
### Create
1. 대화 맥락 분석 → 시각화 유형 + 구조 판단
2. 해당 타입의 참조 문서 Read
3. ID 생성 → PlaitElement[] 구성
4. .vync 파일 Write + 검증 + 서버 열기
5. 스냅샷 생성 (.lastread)
6. 반환: 무엇을 어떤 구조로 시각화했는지 요약
```

**Update 절차 변경:**
```
### Update
1. 대화 맥락 + diff 이해
2. .vync 파일 Read (현재 상태)
3. 맥락과 diff를 고려하여 수정 판단 + 실행
4. 검증 + 서버 열기 + 스냅샷 갱신
5. 반환: 무엇을 어떻게 변경했는지 요약
```

### 4-3. `commands/vync.md` (수정)

**변경 1: diff 서브커맨드 추가**
```
### CLI (direct execution)
- `diff [file]` — 마지막 동기화 이후 변경사항 표시 (프로그래밍적)
  - `--no-snapshot` — diff만 보고 스냅샷 갱신 안 함
```

**변경 2: Read 흐름 재설계**
```
### Read
1. 파일경로 해결
2. `vync diff <file>` 실행 (Bash) → 프로그래밍적 diff 결과 획득
3. 대화 맥락 요약 (2-5문장)
4. Agent tool 호출:
   Agent({
     description: "Vync read + translate diff",
     subagent_type: "vync-translator",
     mode: "bypassPermissions",
     prompt: "## 작업: Read\n파일: <path>\n\n## 대화 맥락\n<맥락>\n\n## 유저 피드백 (diff)\n<diff 결과>\n\n## 지시\n위 변경사항을 대화 맥락에 비춰 의미적으로 번역해줘."
   })
5. Sub-agent의 의미적 번역을 대화에 통합
```

**변경 3: Create 흐름 재설계**
```
### Create
1. 파일경로 해결 (없으면 vync init 먼저)
2. 대화 맥락 요약 (2-5문장)
3. Agent tool 호출:
   Agent({
     description: "Vync create visualization",
     subagent_type: "vync-translator",
     mode: "bypassPermissions",
     prompt: "## 작업: Create\n파일: <path>\n\n## 대화 맥락\n<맥락>\n\n## 지시\n<지시 or 맥락에 맞게 판단>"
   })
4. Sub-agent의 시각화 요약을 사용자에게 전달
```

**변경 4: Update 흐름 재설계**
```
### Update
1. 파일경로 해결
2. `vync diff <file>` 실행 (유저 수정이 있었을 수 있으므로)
3. 대화 맥락 + diff + 지시 정리
4. Agent tool 호출:
   Agent({
     description: "Vync update visualization",
     subagent_type: "vync-translator",
     mode: "bypassPermissions",
     prompt: "## 작업: Update\n파일: <path>\n\n## 대화 맥락\n<맥락>\n\n## 유저 피드백 (diff)\n<diff 결과 or 없음>\n\n## 지시\n<지시>"
   })
5. Sub-agent의 변경 요약을 사용자에게 전달
```

---

## 5. PoC 설계 — 완료 (2026-03-11)

> **실행 결과**: `2026-03-11-diff-pipeline-poc.md` (실행 가이드), `2026-03-11-diff-pipeline-poc-results.md` (결과 보고)
>
> **실제 실행과의 차이**:
> - 테스트 데이터: 실제 파일 diff 대신 **합성 diff 시나리오** 사용 (사유: .vync와 .lastread 콘텐츠 동일)
> - 실행 순서: Phase A(diff 엔진) 미구현 상태에서 Phase B(PoC) 선행 실행 → 합성 diff로 가능했음
> - 결과: **H1 PASS, H2 PASS, H3 PASS** → D-015, D-016 확정

### 가설

**H1: Sub-agent가 프로그래밍적 diff를 받아서 의미적 번역이 가능한가?** → **PASS**
**H2: 대화 맥락 힌트가 번역/판단 품질을 의미있게 향상시키는가?** → **PASS**
**H3: Sub-agent가 맥락만으로 시각화 전략을 자율적으로 결정할 수 있는가?** → **PASS**

---

## 6. 구현 순서

### Phase B: PoC 실행 — ✅ 완료 (2026-03-11)
4. ~~실제 데이터로 diff 엔진 동작 확인~~ → 합성 diff로 검증
5. Trial 1, 2, 3 실행 → 3/3 PASS
6. 결과 분석 + 가설 판정 → D-015, D-016 확정

### Phase A: 프로그래밍적 diff 엔진 — ✅ 완료 (2026-03-11)
1. `tools/cli/diff.ts` 작성 (비교 알고리즘 + CLI 인터페이스)
2. `tools/cli/main.ts`에 diff 서브커맨드 등록
3. 단위 테스트 (`tools/cli/__tests__/diff.test.ts`) — 15개 PASS

### Phase C: Sub-agent 프롬프트 재설계 (품질 안정화) — ✅ 완료 (2026-03-11)
7. `agents/vync-translator.md` 수정 (정체성 + 시각화 판단 가이드 + 절차)
8. `commands/vync.md` 수정 (diff 서브커맨드 + Read/Create/Update 흐름 재설계)

### Phase D: 통합 테스트 — ✅ 완료 (2026-03-11)
9. 전체 테스트 67개 PASS (13 파일), CLI 수동 검증 PASS
10. 플러그인 캐시 동기화 (`bash .claude-plugin/install.sh`) ✅
11. PR #9: feat/diff-pipeline → develop
12. E2E 통합 검증 6/6 PASS:
    - T1: Create + 스냅샷 생성 ✅
    - T2: 브라우저 수정 + Diff 감지 (Added/Removed/Modified) ✅
    - T3: Read + 의미 번역 (맥락 결합 인사이트) ✅
    - T4: Update + 맥락 기반 수정 (기존 유지 + 추가) ✅
    - T5: 연속 Diff 스냅샷 일관성 ✅
    - T6: --no-snapshot 옵션 3단계 검증 ✅
    - 부수 수정: formatDiffResult --no-snapshot 표시 버그 fix

---

## 7. 설계 결정

### D-015: Diff Pipeline Hybrid Architecture
- **결정**: 프로그래밍적 diff(코드) + Sub-agent 의미 번역(LLM) + 메인 세션 맥락 해석
- **대안 1**: 전부 LLM (현재) — 정밀도 부족
- **대안 2**: 전부 코드 + 메인 세션 직접 해석 — 메인 세션이 구조 해석 부담
- **근거**: 각 단계가 가장 잘하는 것을 담당. 코드=정밀계산, LLM=의미번역, 메인=맥락해석
- **재검토 조건**: Sub-agent 번역 품질이 PoC에서 불충분할 경우
- **PoC 결과**: H1(diff 번역) PASS, H2(맥락 효과) PASS → **확정** (2026-03-11)

### D-016: Sub-agent 역할 확장 (시각화 전문가)
- **결정**: 맥락 인지형 시각화 전문가. 시각화 전략 판단 + 실행.
- **대안**: 기계적 변환기 유지 (현재) — 메인 세션 부담 큼
- **근거**: 메인 세션은 대화에 집중, Sub-agent는 시각화에 집중. 역할 분리 명확화.
- **입력**: 대화 맥락 + 프로그래밍적 diff + 지시
- **재검토 조건**: 자율 판단 품질이 PoC에서 불충분할 경우
- **PoC 결과**: H3(자율 시각화) PASS — mindmap 자율 선택, 16노드/3단계, validate 통과 → **확정** (2026-03-11)

---

## 8. 불필요 제거 확인

| 항목 | 판단 | 이유 |
|------|------|------|
| 변경 이력 스택 | 불필요 | 세션 내 단일 스냅샷 충분 |
| Push 알림 | 불필요 | 유저 요청 시만 diff |
| 고아 .lastread 정리 | 불필요 | 파일 크기 미미 |
| 시간/세션 기반 스냅샷 | 불필요 | 세션 내 생각 동기화가 목적 |
| Read의 LLM JSON 비교 | 제거 | 프로그래밍적 diff로 대체 |
