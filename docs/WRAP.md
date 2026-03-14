# Vync — 문서 동기화 규칙

> 코드 변경 시 문서를 일관되게 유지하기 위한 규칙.
> `/wrap-task`와 `/wrap-session` 슬래시 커맨드가 이 문서를 참조한다.

---

## §1 의존관계 맵

변경 유형별로 어떤 문서를 업데이트해야 하는지 정의한다.

| 변경 유형 | PLAN.md | ARCHITECTURE.md | DECISIONS.md | ISSUES.md | FUTURE.md | MEMORY.md |
|-----------|---------|-----------------|--------------|-----------|-----------|-----------|
| Phase 작업 완료 | 체크박스 체크 | — | — | — | — | 현재 상태 |
| Phase 전환 | "현재 상태" 갱신 | — | — | — | — | 현재 상태 |
| 새 설계 결정 | — | 관련 섹션 반영 | D-0XX 추가 | — | — | Key Decisions |
| 설계 결정 변경 | 관련 작업 반영 | 관련 섹션 반영 | 상태/이력 갱신 | — | 영향 확인 | Key Decisions |
| 아키텍처 변경 | — | 해당 섹션 갱신 | 근거 추가 | — | — | — |
| 프로젝트 구조 변경 | — | 섹션 5 갱신 | — | — | — | — |
| 기술 스택 변경 | — | 섹션 3 갱신 | 근거 추가 | — | — | — |
| 파일 포맷 변경 | — | 섹션 4 갱신 | D-005 갱신 | — | — | Key Decisions |
| 리스크 발견/해소 | 리스크 테이블 | — | — | — | — | Key Risks |
| 미결 질문 해결 | Q-0XX 제거/갱신 | 결과 반영 | D-0XX 추가 | — | — | — |
| MVP 범위 변경 | 포함/제외 반영 | — | D-001 갱신 | — | 이동 확인 | — |
| 후속 확장 추가 | — | — | — | — | 항목 추가 | — |
| 용어 정의 변경 | 관련 기준 반영 | 관련 섹션 반영 | 정의 갱신 | — | — | — |
| CLI 구현 변경 | 관련 작업 반영 | 섹션 5, 6.6 갱신 | — | — | — | — |
| 플러그인 변경 (Skill/Command/Hook) | — | — | — | — | — | — |
| JSON Schema 변경 | — | 섹션 4 확인 | D-005 확인 | — | — | — |
| 버그/이슈 발견 | — | — | — | I-0XX 추가 | — | — |
| 이슈 해결 | — | — | — | 상태 `resolved` | — | — |
| 기능/수정 완료 (PR 병합 후) | 완료 요약 추가 | — | — | — | — | 현재 상태 + plans/→archive/ 이동, archive/README.md 갱신 |

---

## §2 /wrap-task 체크리스트

작업 완료 시 실행. 각 항목을 순서대로 확인한다.

### 필수 항목

1. **PLAN.md 상태 갱신**
   - 완료된 작업의 체크박스를 `[x]`로 변경
   - Phase 내 모든 작업이 완료되었으면 "현재 상태" 섹션을 다음 Phase로 갱신

2. **MEMORY.md 동기화**
   - `현재 상태` 필드가 PLAN.md와 일치하는지 확인
   - 새 결정이 있으면 `Key Design Decisions` 반영

### 조건부 항목

3. **설계 결정이 추가/변경된 경우**
   - DECISIONS.md에 D-0XX 추가 (번호, 결정, 대안, 근거)
   - ARCHITECTURE.md 관련 섹션에 반영
   - MEMORY.md Key Decisions 갱신

4. **아키텍처/구조가 변경된 경우**
   - ARCHITECTURE.md 해당 섹션 갱신

5. **미결 질문이 해결된 경우**
   - PLAN.md Q-0XX 항목 갱신/제거
   - 결과를 DECISIONS.md에 D-0XX로 추가

6. **리스크가 발견/해소된 경우**
   - PLAN.md 리스크 테이블 갱신
   - MEMORY.md Key Risks 갱신

7. **버그/이슈가 발견된 경우**
   - ISSUES.md에 I-0XX 추가 (ID, 제목, 심각도, 컴포넌트, 근본 원인)
   - 해결 시 상태를 `resolved`로 변경하고 해결 방법 기록

8. **MVP 범위가 변경된 경우**
   - DECISIONS.md D-001 갱신
   - 제외된 항목을 FUTURE.md로 이동

9. **플러그인 파일이 변경된 경우** (commands/, skills/, agents/, hooks/)
   - `bash .claude-plugin/install.sh` 실행 (캐시 rsync → 새 세션에서 반영)

10. **plans/ → archive/ 이동** (기능/수정 PR이 develop에 병합된 경우)
    - `git mv docs/plans/<file> docs/archive/`
    - PLAN.md 완료 요약 테이블에 행 추가
    - 관련 문서(DECISIONS.md 등)의 파일 경로 참조를 `docs/archive/`로 갱신
    - `docs/archive/README.md` 인덱스에 항목 추가

---

## §3 /wrap-session 추가 체크리스트

세션 종료 시 실행. §2 이후 추가로 수행한다.

### 정합성 확인

각 문서를 **실제로 읽고** 아래를 확인한다 (추측하지 말 것):

1. **PLAN.md ↔ DECISIONS.md**: PLAN.md의 결정 참조(→ D-0XX)가 DECISIONS.md에 존재하는가
2. **ARCHITECTURE.md ↔ DECISIONS.md**: ARCHITECTURE.md의 결정 참조(→ D-0XX)가 유효한가
3. **PLAN.md ↔ ARCHITECTURE.md**: 프로젝트 구조, 기술 스택이 일치하는가
4. **FUTURE.md ↔ DECISIONS.md**: MVP 제외 항목(D-010 등)이 FUTURE.md에 있는가
5. **MEMORY.md ↔ PLAN.md**: 현재 Phase 상태가 일치하는가
6. **ISSUES.md**: `open` 상태 이슈 중 이미 해결된 것이 있는가, `resolved` 이슈를 정리할 수 있는가

### 교차 참조 검증

- 문서 내 파일 경로(`docs/`, `src/` 등)가 실제 파일 시스템과 일치하는가
- 문서 간 링크(`[DECISIONS.md](./DECISIONS.md)` 등)가 유효한가
- `docs/plans/`에 완료된(PR 병합) 파일이 남아있지 않은가 → `docs/archive/`로 이동

### 자기 참조

- 이 WRAP.md 자체가 업데이트 필요한가 (새 문서 추가, 의존관계 변경 등)

---

## §4 문서 작성 규칙

- 결정 번호는 순차 증가: D-001, D-002, ...
- 이슈 번호는 순차 증가: I-001, I-002, ...
- 미결 질문 번호는 순차 증가: Q-001, Q-002, ...
- 결정 상태: `확정` | `재검토` | `폐기`
- 이슈 상태: `open` | `in-progress` | `resolved` | `won't-fix`
- 이슈 심각도: `critical` | `major` | `minor`
- Phase 상태: Phase 번호 + 설명 (예: "Phase 1 (Drawnix 포크 진행 중)") 또는 Post-MVP 단계명 (예: "Post-MVP 안정화")
- 문서 간 참조는 `→ D-0XX` 또는 `[문서명](./파일명)` 형식
