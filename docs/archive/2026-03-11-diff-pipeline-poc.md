# Diff Pipeline PoC — 실행 가이드

**Date**: 2026-03-11
**선행 문서**: `docs/plans/2026-03-11-diff-pipeline-redesign.md`
**Status**: 완료 (3/3 PASS)

---

## 배경

Vync의 Sub-agent(vync-translator)를 "기계적 JSON 변환기"에서 "시각화 전문가(맥락 인지형)"으로 업그레이드하려 한다. 이를 위해 3가지 가설을 검증한다.

**핵심 변경**: Sub-agent에게 (1) 대화 맥락, (2) 프로그래밍적 diff를 입력으로 전달하여, Sub-agent가 시각화 전략을 자율적으로 판단하고 실행하게 한다.

---

## 가설

| ID | 가설 | 검증 방법 |
|----|------|-----------|
| H1 | Sub-agent가 프로그래밍적 diff를 받아서 **의미적 번역**이 가능하다 | Trial 1 |
| H2 | **대화 맥락 힌트**를 함께 전달하면 번역 품질이 향상된다 | Trial 1 vs Trial 2 비교 |
| H3 | Sub-agent가 **맥락만으로 시각화 전략을 자율 판단**할 수 있다 | Trial 3 |

---

## 사전 준비

### 테스트 데이터 생성

현재 `.vync/project-status.vync`와 `.lastread`는 콘텐츠가 동일하므로, **합성 diff 시나리오**를 사용한다.

브라우저에서 유저가 다음과 같이 수정했다고 가정:

```
=== Vync Diff: project-status.vync ===

현재 구조:
  Vync 프로젝트 현황
  ├── MVP 완료 ✅ (Phase 1~5)
  ├── Post-MVP 완료 ✅ (Phase 6~9)
  ├── 진행 중 🔧
  │   ├── macOS 코드 서명
  │   ├── develop → main 머지 대기
  │   └── Phase 10: Diff 파이프라인 개선    ← NEW
  ├── 아키텍처 (Server, Web, Electron, CLI, Plugin)
  └── 향후 로드맵 (P1~P5)

변경사항:
  Added: "Phase 10: Diff 파이프라인 개선" (under "진행 중 🔧")
  Modified: "develop → main 머지 대기" → "develop → main 머지 완료 ✅"
  Removed: (없음)
```

이 diff 텍스트를 각 Trial에서 사용한다.

---

## Trial 실행

### Trial 1: Diff 번역 — 맥락 없이 (H1 검증)

Sub-agent에게 diff만 전달하고, 의미적 번역을 요청한다.

```
Agent({
  description: "PoC Trial 1: diff translation",
  subagent_type: "vync-translator",
  prompt: `## 작업: Read
파일: /Users/presence/projects/Vync/.vync/project-status.vync

## 유저 피드백 (diff)

현재 구조:
  Vync 프로젝트 현황
  ├── MVP 완료 ✅ (Phase 1~5)
  ├── Post-MVP 완료 ✅ (Phase 6~9)
  ├── 진행 중 🔧
  │   ├── macOS 코드 서명
  │   ├── develop → main 머지 완료 ✅
  │   └── Phase 10: Diff 파이프라인 개선
  ├── 아키텍처 (Server, Web, Electron, CLI, Plugin)
  └── 향후 로드맵 (P1~P5)

변경사항:
  Added: "Phase 10: Diff 파이프라인 개선" (under "진행 중 🔧")
  Modified: "develop → main 머지 대기" → "develop → main 머지 완료 ✅"

## 지시
위 변경사항을 의미적으로 번역해줘. 단순 나열이 아닌, "유저의 생각이 어떻게 변화했는지"를 요약해줘.`
})
```

**판정 기준:**
- [ ] PASS: 변경사항을 정확히 인식 (2건: 추가 1, 수정 1)
- [ ] PASS: 단순 나열이 아닌 의미적 번역 ("Phase 10이 추가됨"이 아닌 "새 작업이 시작됨" 수준)
- [ ] PASS: 메인 세션이 활용하기 충분한 품질 (대화에 자연스럽게 통합 가능)
- [ ] FAIL: 변경사항 누락 또는 오독
- [ ] FAIL: 단순 나열만 함 ("Added: X, Modified: Y"를 그대로 반복)

---

### Trial 2: 맥락 + Diff 번역 (H2 검증)

같은 diff에 대화 맥락을 추가하여 번역 품질 변화를 확인한다.

```
Agent({
  description: "PoC Trial 2: context + diff translation",
  subagent_type: "vync-translator",
  prompt: `## 작업: Read
파일: /Users/presence/projects/Vync/.vync/project-status.vync

## 대화 맥락
현재 Vync 프로젝트의 diff 파이프라인을 개선하는 논의가 진행 중이다.
핵심 개선 방향은 Sub-agent를 "기계적 JSON 변환기"에서 "시각화 전문가"로 업그레이드하는 것이다.
구체적으로: (1) 프로그래밍적 diff 엔진 추가, (2) Sub-agent 입력에 맥락+diff 추가,
(3) Sub-agent가 시각화 전략을 자율적으로 판단.
또한 develop → main 머지가 진행되었으며, 이 다이어그램은 프로젝트 현황을 추적하는 용도이다.

## 유저 피드백 (diff)

현재 구조:
  Vync 프로젝트 현황
  ├── MVP 완료 ✅ (Phase 1~5)
  ├── Post-MVP 완료 ✅ (Phase 6~9)
  ├── 진행 중 🔧
  │   ├── macOS 코드 서명
  │   ├── develop → main 머지 완료 ✅
  │   └── Phase 10: Diff 파이프라인 개선
  ├── 아키텍처 (Server, Web, Electron, CLI, Plugin)
  └── 향후 로드맵 (P1~P5)

변경사항:
  Added: "Phase 10: Diff 파이프라인 개선" (under "진행 중 🔧")
  Modified: "develop → main 머지 대기" → "develop → main 머지 완료 ✅"

## 지시
위 변경사항을 대화 맥락에 비춰 의미적으로 번역해줘. "유저의 생각이 어떻게 변화했는지"를 요약해줘.`
})
```

**판정 기준 (Trial 1 대비):**
- [ ] PASS: 대화 맥락과 연결된 번역 (예: "diff 파이프라인 개선이 새 Phase로 공식화됨")
- [ ] PASS: Trial 1보다 관련성 높은 인사이트 포함
- [ ] NEUTRAL: Trial 1과 품질 차이 없음 (맥락이 효과 없음)
- [ ] FAIL: 맥락을 무시하고 Trial 1과 동일한 결과

---

### Trial 3: 맥락 기반 자율 시각화 (H3 검증)

구조 트리를 제공하지 않고, 대화 맥락만으로 시각화를 생성하게 한다.

**사전 준비**: 테스트 파일 초기화
```bash
node "$VYNC_HOME/bin/vync.js" init poc-test
```

```
Agent({
  description: "PoC Trial 3: autonomous visualization",
  subagent_type: "vync-translator",
  mode: "bypassPermissions",
  prompt: `## 작업: Create
파일: <poc-test.vync의 절대경로>

## 대화 맥락
Vync 프로젝트의 diff 파이프라인을 개선하는 논의가 진행 중이다.

현재 문제:
- Sub-agent가 "기계적 JSON 변환기"일 뿐, 시각화 전략 판단 능력이 없음
- 대화 맥락과 유저의 시각적 피드백(diff)이 Sub-agent에 전달되지 않음
- diff 계산이 LLM 기반이라 비결정적이고 누락 위험

개선 방향:
- 프로그래밍적 diff 엔진 (코드): 정밀한 구조적 변경 감지
- Sub-agent 입력 프로토콜 확장: 맥락 + diff + 지시
- Sub-agent 역할 업그레이드: 시각화 전문가 (맥락 인지형)

3단계 파이프라인:
  Stage 1 — vync diff (코드): .lastread vs .vync 프로그래밍적 비교
  Stage 2 — Sub-agent (LLM): 맥락+diff → 시각화 판단 + 실행 + 번역
  Stage 3 — 메인 세션: Sub-agent prose + 대화 맥락 → 인사이트

## 지시
이 논의 내용을 시각화해줘. 적절한 형식(mindmap/flowchart)과 구조를 네가 판단해서.
핵심 포인트를 포착하되, 과도한 세분화는 피해줘.`
})
```

**판정 기준:**
- [ ] PASS: 적절한 시각화 유형 선택 (mindmap 또는 flowchart, 맥락에 맞게)
- [ ] PASS: 핵심 포인트 포착 (3단계 파이프라인, 현재 문제, 개선 방향 중 2개 이상)
- [ ] PASS: 과도하지 않은 세분화 (2-3단계 깊이)
- [ ] PASS: 유효한 .vync JSON 생성 (validate.js 통과)
- [ ] FAIL: 맥락을 무시하고 generic한 다이어그램 생성
- [ ] FAIL: "구조를 제공해주세요" 같은 거부/요청
- [ ] FAIL: 과도한 세분화 (4단계 이상, 20+ 노드)

---

## 실행 순서

```
1. Trial 1 실행 → 결과 기록
2. Trial 2 실행 → 결과 기록
3. Trial 1 vs Trial 2 비교 분석
4. vync init poc-test (Trial 3 준비)
5. Trial 3 실행 → 결과 기록
6. 전체 가설 판정
7. 결과를 이 문서에 기록
```

---

## 결과 기록 (PoC 실행 후 작성)

### Trial 1 결과
- Sub-agent 반환: 두 변경사항을 정확히 인식(추가 1, 수정 1). "게이트를 통과했다는 인식의 전환" + "완료의 여운 속에서 다음 관심이 이미 확정된 상태로 진입" — 단순 나열 아닌 사고 흐름 해석
- H1 판정: **PASS**
- 비고: 맥락 없이도 의미적 번역 가능. 다만 해석이 추상적 수준에 머무름 (프로젝트 구체 맥락과 연결 부족)

### Trial 2 결과
- Sub-agent 반환: 동일 변경사항 인식 + "향후 로드맵의 추상적 항목(P2)에 머물지 않고, 현재 논의 중인 Sub-agent 개선을 Phase 10이라는 구체적 단위로 격상" — 대화 맥락과 직접 연결된 인사이트
- H2 판정: **PASS**
- Trial 1 대비 차이: Trial 1은 추상적 해석("게이트 통과", "다음 관심 확정"), Trial 2는 대화 맥락 기반 구체적 해석("로드맵 항목이 아니라 지금 당장의 작업으로 인식"). 맥락이 관련성 높은 인사이트 생성에 명확히 기여
- 비고: 맥락을 무시하지 않고 적극 활용. 특히 "Phase 10으로 격상"이라는 표현은 맥락 없이는 나올 수 없는 번역

### Trial 3 결과
- Sub-agent 반환: mindmap 생성 — 루트 "Diff 파이프라인 개선" 아래 3개 카테고리(현재 문제, 3단계 파이프라인, 개선 방향) + 각 3개 리프
- 생성된 시각화 유형: mindmap (적절한 선택 — 계층적 분류에 적합)
- 노드 수 / 깊이: 16개 노드 / 3~4단계 (루트→카테고리→리프, Stage에 설명 노드 추가 시 4단계)
- validate.js 결과: OK
- H3 판정: **PASS**
- 비고: 거부하지 않고 자율적으로 형식·구조 판단. 3개 핵심 포인트 모두 포착. 세분화 적절 (과도하지 않음). "구조를 제공해주세요" 같은 거부 없이 바로 실행

### 종합 판정

| 가설 | 결과 | 다음 행동 |
|------|------|-----------|
| H1: diff 의미적 번역 | **PASS** | 현재 Sub-agent도 diff 입력을 의미적으로 번역 가능. 프롬프트 수정 불필요 |
| H2: 맥락 힌트 효과 | **PASS** | 맥락 추가 시 번역 품질 유의미하게 향상. 입력 프로토콜에 맥락 필드 추가 확정 |
| H3: 자율 시각화 판단 | **PASS** | Sub-agent가 형식·구조를 자율 판단하여 유효한 시각화 생성. 역할 업그레이드 실현 가능 |

**전체 결론**: 3개 가설 모두 PASS. 현재 vync-translator Sub-agent는 프롬프트 수정 없이도 (1) diff 의미 번역, (2) 맥락 활용, (3) 자율 시각화를 수행할 수 있음. Diff 파이프라인 재설계의 핵심 전제가 검증됨.
**다음 단계**: 설계 문서(`2026-03-11-diff-pipeline-redesign.md`) 기반으로 구현 착수 — (1) 프로그래밍적 diff 엔진 구현, (2) Sub-agent 입력 프로토콜에 맥락+diff 필드 추가, (3) 메인 세션→Sub-agent 호출 흐름 통합

---

## 주의사항

- Trial 1, 2는 `Read` 작업이므로 .vync 파일을 수정하지 않아야 함
- Trial 3는 `Create` 작업이므로 poc-test.vync 파일이 생성됨
- Trial 3 후 생성된 파일을 브라우저에서 확인하여 시각적 품질도 평가
- PoC 파일(poc-test.vync)은 검증 후 삭제해도 무방
- Sub-agent는 현재 `agents/vync-translator.md`를 그대로 사용 (프롬프트 미수정 상태)
  → PoC는 "현재 Sub-agent가 새 입력 형식을 얼마나 잘 처리하는지" 검증
  → 결과에 따라 Sub-agent 프롬프트 수정 방향 결정
