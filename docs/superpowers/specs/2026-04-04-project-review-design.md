# 프로젝트 통합 리뷰 — 기반 안정화 + 코드 품질

## 목표

nx 빌드/TS 에러를 복구한 뒤, 3팀(canvas/codex/sync)이 병렬로 코드 품질을 리뷰하고 즉시 수정 가능한 것은 바로 고친다.

## Phase 1 — 기반 안정화 (team-lead 단독)

| 단계 | 작업 | 완료 기준 |
|------|------|----------|
| 1-1 | nx 빌드 복구 — `ajv/dist/core` 의존성 해결 | `npm test` 실행 가능 |
| 1-2 | TS 에러 정리 — `node:*` default import 등 | `npx tsc --noEmit` 에러 0 또는 기존 수준 |
| 1-3 | 전체 테스트 통과 확인 | `npm test` PASS |

## Phase 2 — 3팀 병렬 코드 리뷰 + 즉시 수정

각 팀이 자기 소유 영역을 리뷰한다.

**리뷰 기준:**
- 데드코드, 미사용 import, TODO/FIXME
- 에러 핸들링 누락, 타입 안전성
- 테스트 커버리지 갭
- Open 이슈(I-001, I-005, I-006) 중 자기 영역 해당 건

**팀별 범위:**

| 팀 | 리뷰 대상 | 관련 이슈 |
|----|----------|----------|
| sync | `tools/server/`, `packages/shared/` | I-006 (diff 미감지, shared 타입) |
| canvas | `apps/web/`, `packages/board\|react-board\|react-text/`, `tools/electron/` | — |
| codex | `tools/cli/`, `agents/`, `skills/`, `commands/`, `hooks/` | I-001 (.lastread), I-005 (Semantic Sync) |

**수정 정책:**
- 즉시 수정 가능한 것 → 바로 수정 + 테스트 확인
- 큰 건 → ISSUES.md에 등록 또는 기존 이슈 갱신

## Phase 3 — 교차 리뷰 (팀 간 인터페이스)

3팀이 발견 사항을 공유하고 팀 간 경계 이슈를 논의:
- `packages/shared/types.ts` ↔ 각 consumer의 타입 사용 일관성
- HTTP/WS API 계약 vs 실제 사용
- 통보 프로토콜 누락 여부

## Phase 4 — 정리

- ISSUES.md, PLAN.md 갱신
- develop → main 병합
- esbuild 번들 리빌드 (server/electron/shared 변경 시)
