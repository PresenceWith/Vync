# Vync Plugin 토큰 최적화 분석

> 날짜: 2026-03-13
> 범위: Vync plugin 파이프라인 (command, skill, agent, hook)
> 목적: 비용 절감 + 컨텍스트 윈도우 효율 + 응답 정확도 (복합)

---

## 1. 파이프라인 아키텍처

```
┌─── 메인 세션 ───────────────────────────────────────────────┐
│                                                              │
│  hooks/hooks.json (~540 tok)  ← 세션 로드 시 자동           │
│                                                              │
│  사용자: "/vync create ..."                                  │
│       ↓                                                      │
│  commands/vync.md (~1,323 tok) ← 호출 시 로드               │
│       ↓                                                      │
│  ┌─ CLI 경로 ──┐   ┌─ Sub-agent 경로 ──────────────────┐   │
│  │ init/open/  │   │                                     │   │
│  │ close/stop/ │   │  Bash: vync diff → 결과 (~300 tok) │   │
│  │ diff        │   │       ↓                             │   │
│  │ (직접 실행) │   │  Agent tool 호출 (~200 tok)         │   │
│  └─────────────┘   └────────────┬────────────────────────┘   │
│                                  │                            │
└──────────────────────────────────┼────────────────────────────┘
                                   ↓
┌─── Sub-agent (vync-translator) ─────────────────────────────┐
│                                                              │
│  agents/vync-translator.md (~1,451 tok) ← 시스템 프롬프트   │
│  skills/vync-editing/SKILL.md (~974 tok) ← 자동 로드        │
│       ↓                                                      │
│  Reference Read (필요 시):                                   │
│    mindmap.md     ~1,387 tok  ← Create/Update (mindmap)     │
│    geometry.md    ~1,220 tok  ← Create/Update (flowchart)   │
│    arrow-line.md  ~1,398 tok  ← Create/Update (flowchart)   │
│    coordinates.md   ~882 tok  ← Create/Update (flowchart)   │
│       ↓                                                      │
│  .vync 파일 Read/Write + validate.js + generate-id.js       │
│       ↓                                                      │
│  반환: 한 줄 요약 or 4-필드 구조화 (~50-200 tok)            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 구성요소 요약

| 구성요소 | 파일 | 크기 | 로딩 시점 |
|----------|------|------|-----------|
| Hook (PostToolUse + SessionEnd) | `hooks/hooks.json` | ~540 tok | 세션 시작 (자동) |
| Command (라우터) | `commands/vync.md` | ~1,323 tok | `/vync` 호출 시 |
| Agent 정의 | `agents/vync-translator.md` | ~1,451 tok | Sub-agent 스폰 시 |
| Skill (편집 가이드) | `skills/vync-editing/SKILL.md` | ~974 tok | Sub-agent 스폰 시 (자동) |
| Reference: mindmap | `references/mindmap.md` | ~1,387 tok | Sub-agent Read 시 |
| Reference: geometry | `references/geometry.md` | ~1,220 tok | Sub-agent Read 시 |
| Reference: arrow-line | `references/arrow-line.md` | ~1,398 tok | Sub-agent Read 시 |
| Reference: coordinates | `references/coordinates.md` | ~882 tok | Sub-agent Read 시 |
| Asset: mindmap.vync | `assets/mindmap.vync` | ~504 tok | Sub-agent Read 시 (예시) |
| Asset: flowchart.vync | `assets/flowchart.vync` | ~522 tok | Sub-agent Read 시 (예시) |
| Script: validate.js | `scripts/validate.js` | ~1,142 tok | Bash 실행 (토큰 아님) |
| Script: generate-id.js | `scripts/generate-id.js` | ~155 tok | Bash 실행 (토큰 아님) |
| Diff 엔진 | `tools/cli/diff.ts` | ~3,866 tok | Bash 실행 (토큰 아님) |

**총 plugin 파일**: ~15,814 tokens (전체 합계)
**세션당 고정 비용**: ~540 tokens (hooks만)

---

## 2. 작업별 토큰 소비 추정

### Create (mindmap 기준)

| 단계 | 위치 | 토큰 |
|------|------|------|
| command 로드 | 메인 | ~1,323 |
| Agent 호출 prompt 구성 | 메인 | ~200 |
| translator 시스템 프롬프트 | Sub | ~1,451 |
| SKILL.md 자동 로드 | Sub | ~974 |
| mindmap.md Read | Sub | ~1,387 |
| .vync 파일 Write + 검증 | Sub | ~500 |
| **소계** | | **~5,835** |

### Read

| 단계 | 위치 | 토큰 |
|------|------|------|
| command 로드 | 메인 | ~1,323 |
| diff CLI 실행 결과 | 메인 | ~300 |
| Agent 호출 prompt 구성 | 메인 | ~300 |
| translator 시스템 프롬프트 | Sub | ~1,451 |
| SKILL.md 자동 로드 | Sub | ~974 |
| diff 분석 작업 | Sub | ~500 |
| **소계** | | **~4,848** |

### Update (mindmap 기준)

| 단계 | 위치 | 토큰 |
|------|------|------|
| command 로드 | 메인 | ~1,323 |
| diff CLI 실행 결과 | 메인 | ~300 |
| Agent 호출 prompt 구성 | 메인 | ~400 |
| translator 시스템 프롬프트 | Sub | ~1,451 |
| SKILL.md 자동 로드 | Sub | ~974 |
| mindmap.md Read | Sub | ~1,387 |
| .vync 파일 Read + Edit + 검증 | Sub | ~1,500 |
| **소계** | | **~7,335** |

### Flowchart 작업 시 추가 비용

Flowchart Create/Update는 mindmap 대비 **+3,500 tokens** 추가:
- geometry.md (~1,220) + arrow-line.md (~1,398) + coordinates.md (~882) = ~3,500

---

## 3. 비효율 분석

### I-1. Command 파일의 경로 혼합

`commands/vync.md`에 CLI 경로(init/open/close/stop/diff)와 Sub-agent 경로(create/read/update)가 **한 파일에 공존**. CLI 호출 시 Sub-agent 절차 ~600 tokens이 불필요하게 로드되고, 반대도 마찬가지.

### I-2. Agent 프롬프트의 전 작업 절차 포함

`vync-translator.md`에 Create/Read/Update **세 가지 절차가 모두** 포함. 실제로는 호출당 하나만 사용. 매 호출마다 사용하지 않는 2개 절차의 토큰(~500-700)이 낭비.

### I-3. Reference 무차별 로딩 가능성

Translator가 작업 유형을 판단한 후 reference를 Read하지만, **가이드가 없으면** 안전을 위해 여러 reference를 읽을 수 있음. Mindmap 작업에서 geometry.md까지 읽으면 ~2,500 tokens 낭비.

### I-4. SKILL.md와 Reference 간 내용 중복

SKILL.md의 Quick Templates 섹션(~300 tokens)이 reference 파일의 예시와 실질적으로 중복. SKILL.md 로드 + reference 로드 = 같은 패턴이 두 번 들어감.

### I-5. Diff 출력의 이중 정보

`formatDiffResult`가 `detail`과 `semanticHint`를 모두 출력. 예:
```
Added: 테스트 (under 개발)
  → 개념 추가: 테스트가 개발의 새 하위 요소로
```
Translator에게는 `semanticHint`만 전달해도 충분. `detail`은 사람용 중복.

### I-6. Asset 파일의 역할 모호

`assets/mindmap.vync` (~504 tok), `assets/flowchart.vync` (~522 tok)가 skill 디렉토리에 존재. 예시 파일로서 translator가 참조할 수 있으나, reference의 Complete Example과 실질 중복. 실제 참조 빈도 불명.

---

## 4. 개선 방향성

### P-1. Reference 조건부 로딩 가이드 (최우선)

| 항목 | 내용 |
|------|------|
| **현재** | Translator가 자율적으로 reference Read. 불필요 로딩 가능 |
| **개선** | Agent 프롬프트에 vizType→reference 매핑 명시. 메인 세션이 호출 시 vizType 힌트 전달 |
| **예시** | `"vizType: mindmap → mindmap.md만 Read. geometry.md/arrow-line.md 불필요"` |
| **절감** | Mindmap 작업 시 ~2,500-3,500 tokens |
| **위험** | 낮음 — 매핑이 명확하고 예외 적음 |

### P-2. Agent 프롬프트 작업별 경량화

| 항목 | 내용 |
|------|------|
| **현재** | translator.md에 Create/Read/Update 전체 절차 (~1,451 tok) |
| **개선** | 공통 규칙만 agent 파일에, 작업별 절차는 메인 세션이 prompt에 인라인 |
| **구조** | translator.md: ~800 tok (공통) + prompt 인라인: ~200 tok (작업별) = ~1,000 tok |
| **절감** | 호출당 ~400-600 tokens |
| **위험** | 중간 — command와 agent 간 지침 분산, 유지보수 주의 |

### P-3. Diff 출력 압축 모드

| 항목 | 내용 |
|------|------|
| **현재** | tree + detail + semanticHint 전부 출력 |
| **개선** | `--compact` 플래그: semanticHint만 출력 (tree/detail 생략) |
| **예시** | `개념 추가: 테스트가 개발의 새 하위 요소로` (detail 없이) |
| **절감** | diff 결과 ~30-50% 축소 (~100-250 tok) |
| **위험** | 낮음 — 기존 포맷 유지, 새 옵션 추가만 |

### P-4. SKILL.md 경량화

| 항목 | 내용 |
|------|------|
| **현재** | SKILL.md에 Quick Templates + Workflow (~974 tok) |
| **개선** | Quick Templates 제거 (reference에만 존재), 핵심 규칙만 유지 |
| **절감** | ~300-400 tokens (SKILL.md → ~600 tok) |
| **위험** | 낮음 |

### P-5. Command 라우터 분리

| 항목 | 내용 |
|------|------|
| **현재** | CLI + Sub-agent 모두 한 파일 (~1,323 tok) |
| **개선** | 경량 라우터 (~400 tok) + 상세 절차는 호출 유형에 따라 분기 |
| **예시** | CLI 키워드 감지 → Bash 실행만, Sub-agent 키워드 → 상세 prompt 구성 |
| **절감** | CLI 호출 시 ~600 tok, Sub-agent 호출 시 ~400 tok |
| **위험** | 중간 — UX 변경, 사용자 학습 비용 |

### P-6. Asset/예시 통합

| 항목 | 내용 |
|------|------|
| **현재** | assets/*.vync + reference 예시 = 중복 |
| **개선** | assets/ 제거, reference의 Complete Example을 유일한 예시 소스로 |
| **절감** | ~1,000 tokens (asset Read 제거) |
| **위험** | 낮음 — reference 예시가 더 상세함 |

---

## 5. 예상 효과

### Before vs After (Mindmap Create 기준)

| 항목 | Before | After (P-1~P-6 전부) | 절감 |
|------|--------|----------------------|------|
| Command 로드 | 1,323 | ~700 (P-5) | -623 |
| Agent 시스템 프롬프트 | 1,451 | ~800 (P-2) | -651 |
| SKILL.md | 974 | ~600 (P-4) | -374 |
| Reference | 1,387 | 1,387 (변동 없음) | 0 |
| 불필요 Reference | ~1,500 (우발) | 0 (P-1) | -1,500 |
| .vync 작업 | ~500 | ~500 | 0 |
| **총계** | **~7,135** | **~3,987** | **-3,148 (-44%)** |

### Before vs After (Read 기준)

| 항목 | Before | After | 절감 |
|------|--------|-------|------|
| Command 로드 | 1,323 | ~700 | -623 |
| Diff 결과 | ~300 | ~180 (P-3) | -120 |
| Agent 시스템 프롬프트 | 1,451 | ~800 | -651 |
| SKILL.md | 974 | ~600 | -374 |
| Diff 분석 | ~500 | ~500 | 0 |
| **총계** | **~4,548** | **~2,780** | **-1,768 (-39%)** |

### 우선순위 매트릭스

```
절감량 ↑
│
│  P-1 ●               (최대 절감, 쉬운 구현)
│
│        P-2 ●          (중간 절감, 설계 필요)
│
│  P-6 ●    P-5 ●       (중간, 각각 위험도 다름)
│
│    P-4 ●  P-3 ●       (작지만 확실)
│
└────────────────────→ 구현 난이도
   쉬움              어려움
```

**권장 실행 순서**: P-1 → P-4 → P-3 → P-6 → P-2 → P-5

---

## 6. 제약 및 참고사항

- 토큰 추정은 bytes/3 근사 (실제 토큰화기에 따라 ±20% 오차)
- Sub-agent 토큰은 메인 세션과 별도 과금되지만, API 비용에는 합산
- Claude Code의 skill/command 로딩 메커니즘이 변경되면 분석 재검토 필요
- diff.ts, validate.js, generate-id.js는 CLI/Bash 실행이므로 프롬프트 토큰이 아님 (런타임 비용)
