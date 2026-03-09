# Diff-Aware `/vync read` 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `/vync read` 호출 시 마지막 읽기 이후 웹에서 변경된 내용을 diff로 보고하여, Claude Code가 "무엇이 바뀌었는지" 인식할 수 있게 한다.

**Architecture:** .vync 파일과 나란히 `.lastread` 스냅샷 파일을 저장한다. sub-agent가 Read 시 두 파일을 비교하여 변경사항을 prose로 보고한다. TypeScript 코드 변경 없이, 에이전트 프롬프트와 커맨드 정의만 수정한다.

**Tech Stack:** Claude Code agent prompt (markdown), Bash (snapshot 관리)

---

## 핵심 설계

### 스냅샷 파일

- **위치**: `.vync/<name>.vync` → `.vync/<name>.vync.lastread`
- **포맷**: 동일한 VyncFile JSON (원본 복사)
- **생명주기**: `/vync read`, `/vync create`, `/vync update` 성공 시 갱신
- **gitignore**: `*.lastread` 추가 (세션 로컬 아티팩트)

### 데이터 흐름

```
[첫 Read] (스냅샷 없음)
  sub-agent: .vync Read → prose 반환 → .lastread Write
  출력: "mindmap: 프로젝트 > [기획, 개발]"

[웹에서 수정 후 Read] (스냅샷 있음)
  sub-agent: .vync Read + .lastread Read → 비교 → diff + prose 반환 → .lastread 갱신
  출력: "mindmap: 프로젝트 > [기획, 개발, +테스팅, +배포] (변경: 테스팅, 배포 추가)"

[Create/Update 후]
  sub-agent: 파일 쓰기 → .lastread도 갱신 (Claude가 만든 상태 = 기준선)
```

### 반환 포맷 확장

| 상황 | 현재 | 변경 후 |
|------|------|---------|
| 첫 Read (스냅샷 없음) | `"mindmap: A > [B, C]"` | `"mindmap: A > [B, C]"` (동일) |
| 변경 없음 | `"mindmap: A > [B, C]"` | `"mindmap: A > [B, C] (변경 없음)"` |
| 변경 있음 | `"mindmap: A > [B, C, D]"` | `"mindmap: A > [B, C, +D] (변경: D 추가)"` |
| 노드 삭제 | — | `"mindmap: A > [B] (변경: C 삭제)"` |
| 이름 변경 | — | `"mindmap: A > [기획/일정, 개발] (변경: 기획→기획/일정)"` |

---

## Task 1: .gitignore에 `*.lastread` 추가

**Files:**
- Modify: `.gitignore:44` (Vync 섹션)

**Step 1: .gitignore 수정**

`.gitignore`의 Vync 섹션에 `*.lastread` 추가:

```
# Vync
*.vync
.vync/
*.lastread
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore .lastread snapshot files"
```

---

## Task 2: vync-translator 에이전트 Read 절차 업데이트

**Files:**
- Modify: `.claude-plugin/agents/vync-translator.md`

**Step 1: 반환 포맷에 diff 형식 추가**

`## 반환 포맷` 섹션의 read 항목을 확장:

```markdown
**성공 시**: 한 줄 요약만 반환. 추가 설명 불필요.
- create: `"mindmap: 프로젝트 > [기획, 개발, 출시]"`
- read (첫 읽기): `"mindmap: 프로젝트 > [기획(시장조사, 인터뷰), 개발(FE, BE)]"`
- read (변경 있음): `"mindmap: 프로젝트 > [기획, 개발, +테스팅] (변경: 테스팅 추가)"`
- read (변경 없음): `"mindmap: 프로젝트 > [기획, 개발] (변경 없음)"`
- update: `"updated: 개발 > [FE, BE, +테스트, +CI/CD]"`
```

**Step 2: Read 절차에 스냅샷 비교 로직 추가**

`### Read` 섹션을 교체:

```markdown
### Read
1. .vync 파일 Read (현재 상태)
2. 스냅샷 파일 확인: `<file>.lastread` 존재 여부 체크 (Bash: `test -f`)
3. **스냅샷 없음** (첫 읽기):
   a. JSON 파싱하여 elements 분석
   b. 구조를 2단계 깊이까지 요약
   c. 한 줄 요약 반환
   d. 현재 .vync 내용을 `<file>.lastread`에 Write (스냅샷 생성)
4. **스냅샷 있음** (후속 읽기):
   a. 스냅샷 파일 Read
   b. 현재 elements와 스냅샷 elements 비교:
      - 추가된 노드: 스냅샷에 없는 id
      - 삭제된 노드: 현재에 없는 id
      - 변경된 노드: 같은 id지만 text/children이 다름
   c. 변경사항이 있으면 diff 포함하여 요약, 없으면 "(변경 없음)" 표시
   d. 현재 .vync 내용을 `<file>.lastread`에 Write (스냅샷 갱신)
```

**Step 3: Create/Update 절차에 스냅샷 갱신 추가**

`### Create`의 6번(서버 열기) 뒤에 추가:

```markdown
7. 스냅샷 갱신: 작성한 .vync 내용을 `<file>.lastread`에 Write
```

`### Update`의 5번(서버 열기) 뒤에 추가:

```markdown
6. 스냅샷 갱신: 수정된 .vync 내용을 `<file>.lastread`에 Write
```

**Step 4: Commit**

```bash
git add .claude-plugin/agents/vync-translator.md
git commit -m "feat(plugin): add diff-aware read to vync-translator agent"
```

---

## Task 3: vync 커맨드 Read 섹션 업데이트

**Files:**
- Modify: `.claude-plugin/commands/vync.md`

**Step 1: Read 설명 업데이트**

`### Read` 섹션의 Agent 호출 프롬프트에 diff 컨텍스트 추가:

```markdown
### Read

1. 파일경로 해결
2. Agent tool 호출:

\```
Agent({
  description: "Vync read file",
  subagent_type: "vync-translator",
  prompt: "## 작업: Read\n파일: <absolute_path>"
})
\```

3. Sub-agent의 prose 요약을 대화에 통합
   - diff가 포함된 경우 ("변경: ..."), 변경 내용을 대화 맥락에 반영
   - "(변경 없음)"인 경우, 현재 상태만 참고
```

**Step 2: Commit**

```bash
git add .claude-plugin/commands/vync.md
git commit -m "feat(plugin): update vync read command for diff-aware output"
```

---

## Task 4: Sub-agent 설계 문서 업데이트

**Files:**
- Modify: `docs/plans/2026-03-09-subagent-translator-design.md`

**Step 1: §2 읽기 데이터 흐름 업데이트**

`**읽기 (Read):**` 섹션을 교체:

```markdown
**읽기 (Read):**
\```
사용자: "현재 마인드맵 확인해줘" (또는 "웹에서 수정했어, 뭐가 바뀌었는지 봐줘")
  → 메인 세션: 파일경로 해결 → Agent tool: vync-translator spawn
    → sub-agent: .vync 파일 Read → .lastread 스냅샷 확인
    → [스냅샷 있음] 현재 vs 스냅샷 비교 → diff 포함 요약
    → [스냅샷 없음] 구조 분석 (2단계 깊이)
    → sub-agent 반환: "mindmap: 프로젝트 > [기획, 개발, +테스팅] (변경: 테스팅 추가)"
    → .lastread 스냅샷 갱신
  → 메인 세션: prose + diff 전달, 대화 계속
\```
```

**Step 2: Commit**

```bash
git add docs/plans/2026-03-09-subagent-translator-design.md
git commit -m "docs: update subagent design for diff-aware read (P1)"
```

---

## Task 5: E2E 수동 검증

설치 후 전체 흐름 검증.

**Step 1: 플러그인 재설치**

```bash
bash .claude-plugin/install.sh
```

**Step 2: 검증 시나리오 실행**

| # | 시나리오 | 명령 | 기대 결과 |
|---|---------|------|-----------|
| 1 | 첫 Create | `/vync create mindmap "테스트 계획: 단위, 통합, E2E"` | 파일 생성 + `.lastread` 생성 |
| 2 | 즉시 Read | `/vync read` | 현재 상태 반환 + "(변경 없음)" |
| 3 | 웹에서 수정 | 브라우저에서 노드 추가 | .vync 파일 변경, .lastread 변경 없음 |
| 4 | Read (diff) | `/vync read` | diff 포함 반환: "+추가된노드 (변경: ...)" |
| 5 | Update 후 Read | `/vync update "성능 테스트 추가"` → `/vync read` | "(변경 없음)" (Update가 스냅샷 갱신했으므로) |

**Step 3: 결과 기록**

각 시나리오의 PASS/FAIL을 기록. FAIL 시 에이전트 프롬프트 수정 후 재검증.

---

## Task 6: 문서 동기화

**Files:**
- Modify: `docs/PLAN.md` — Phase 8 또는 P1 기록 추가
- Modify: `CLAUDE.md` — 필요 시 diff read 언급 추가

**Step 1: PLAN.md에 P1 기록**

Phase 7 이후에 P1 완료 기록 추가.

**Step 2: Commit**

```bash
git add docs/PLAN.md CLAUDE.md
git commit -m "docs: record P1 diff-aware read completion"
```

---

## 리스크 및 완화

| 리스크 | 확률 | 완화 |
|--------|------|------|
| Sub-agent가 JSON diff를 잘못 분석 | 중 | 비교 기준을 `id` 필드로 한정하여 단순화 |
| 큰 파일에서 두 파일 읽기 context 부담 | 낮 | 현실적 사용 범위에서 .vync 파일은 수~수십 KB |
| .lastread 파일이 고아(orphan)로 남음 | 낮 | SessionEnd hook 또는 `vync stop`에서 정리 가능 (후속) |
| 스냅샷 갱신 실패 시 false diff | 낮 | 에이전트 프롬프트에 "Write 실패 시 경고" 포함 |

---

## 범위 외 (의도적 제외)

| 항목 | 사유 |
|------|------|
| 서버 사이드 diff 계산 | TypeScript 변경 불필요, LLM이 더 유연하게 비교 가능 |
| 요소별 버전 추적 | P2 (FUTURE.md §4-1) 범위 |
| 실시간 변경 알림 | Claude Code 플랫폼 제약 (hook은 외부 변경 미감지) |
| .lastread 자동 정리 | 후속 과제, 파일 크기 미미 |
