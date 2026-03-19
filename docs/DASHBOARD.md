# Vync Dashboard

> 프로젝트 현황을 한눈에 파악하기 위한 대시보드.
> `/wrap-task`와 `/wrap-session` 실행 시 자동 갱신된다. 수동 갱신: 해당 섹션의 소스 문서 참조.

---

## 상태

**Post-MVP 안정화** · 95+ tests PASS · 2026-03-19 갱신

| 항목  | 상태                                  |
| --- | ----------------------------------- |
| Git | `develop` → `main`: **31 커밋** 병합 필요 |
| 테스트 | 95개 PASS (vitest)                   |
| 빌드  | Electron DMG 코드서명+공증 완료             |

---

## 활성 계획

> 소스: `docs/plans/` · 상태: 각 문서 헤더

| 상태    | 계획                    | 연관    | 문서                                                               |
| ----- | --------------------- | ----- | ---------------------------------------------------------------- |
| 구현 대기 | 확신 캘리브레이션             | I-005 | [설계](./plans/2026-03-14-semantic-sync-confidence-calibration.md) |
| 결정 대기 | Document Package 전환   | F-006 | [설계](./plans/2026-03-12-vync-document-package.md)                |
| 구현 중 | Graph View (온톨로지 편집기) | F-008, D-019 | [구현](./plans/2026-03-16-graph-view-implementation.md) |
| 분석 완료 | 토큰 최적화                | F-014 | [분석](./plans/2026-03-13-token-optimization.md)                   |
| 검증 완료 | Semantic Sync 회귀 검증   | I-005 | [결과](./archive/2026-03-14-semantic-sync-regression.md)           |

---

## 열린 이슈

> 소스: `docs/ISSUES.md`

| 심각도       | ID    | 제목                 | 해결 방향                |
|:---------:| ----- | ------------------ | -------------------- |
| **major** | I-005 | 확신 과대평가 (단일축+무검증)  | 캘리브레이션 설계 완료 → 구현 대기 |
| **major** | I-006 | Diff 시각적 변동 미감지    | 유형별 diff 전략 (설계 미착수) |
| minor     | I-001 | .lastread Write 실패 | MCP 전환 시 구조적 해결      |

---

## 의존관계

```
이슈               설계/계획                기능 아이디어
───────────       ─────────────           ─────────────
I-005 major  ──→  확신 캘리브레이션   ─┐
I-001 minor  ────────────────────────┼──→  F-001 MCP 서버 (구조적 해결)
                                     │
I-006 major  ──→  (설계 미착수)      │     diff 전략 확장
                                     │
                                     │     F-001 MCP 서버
                                     │       ↑         ↑
                                     │     F-002      F-003
                                     │     AI Agent   변환 파이프라인
                                     │
F-006 Document Package  ──→  (전체 파이프라인 breaking change)
F-008 Graph View        ──→  (✅ done, feat/graph-view develop 병합 대기)
```

**핵심 병목**: I-005(확신 과대평가)는 설계 완료 → 구현만 하면 됨. I-006(diff 미감지)은 설계부터 필요.
**구조적 해결**: F-001 MCP 서버가 I-001, I-005의 근본 원인을 해소하는 수렴점.

---

## 최근 완료

> 소스: `docs/PLAN.md` 완료 요약 테이블

| 날짜    | 작업                                         | PR/커밋     |
| ----- | ------------------------------------------ | --------- |
| 03-16 | Graph View PoC + 구현 (D-019, F-008)            | feat/graph-view |
| 03-16 | External Undo 지원 (Transforms 기반)           | develop   |
| 03-14 | Electron/Web Sync Fix (I-002~004 resolved) | develop   |
| 03-13 | Semantic Sync (D-017/D-018)                | PR #14    |
| 03-13 | Plugin Path Fix ($VYNC_HOME)               | PR #15    |
| 03-13 | Asar Unpacked Path Fix                     | `fcba037` |
| 03-12 | Tab Bar + 버튼 수정                            | PR #11    |
| 03-11 | Diff Pipeline (D-015/D-016)                | PR #9     |
| 03-11 | Server Lifecycle Fix                       | PR #10    |
| 03-11 | macOS 코드 서명 + 공증                           | `588fd97` |

---

## 다음 방향

> 소스: `docs/FUTURE.md` (planned/evaluating 상태만)

| 우선순위 | 기능                     | 상태            | 규모  | 비고                                 |
|:----:| ---------------------- |:-------------:|:---:| ---------------------------------- |
| 1    | F-001 MCP 서버           | 📋 planned    | L   | I-001, I-005 구조적 해결. 2026년 내 착수 목표 |
| 2    | F-006 Document Package | 🔍 evaluating | XL  | Breaking change. 신중한 평가 필요         |
| 3    | F-014 토큰 최적화           | 🔍 evaluating | M   | 분석 완료, 구현 우선순위 미결정                 |
