# Vync Sub-agent 번역 레이어 설계 (v2 — 리뷰 반영)

> "생각이 보이는 대화" — Vync는 Claude Code와 유저 간의 이해도 동기화 채널(통역가)

## 1. 문제 정의

### 현재 상태

`/vync-create` 실행 시 메인 세션(Claude Code)이 직접 .vync JSON을 다룬다:

```
메인 세션 context window:
├── vync-editing skill 로드 (SKILL.md + references)
├── JSON 스키마 이해 (PlaitElement[], mindmap, geometry...)
├── ID 생성 스크립트 실행
├── 좌표 계산, 노드 배치
├── JSON 구성 및 파일 쓰기
└── → context window에 불필요한 기술적 세부사항 축적
```

문제:
- **Context window 오염**: .vync JSON 구조, 참조 문서, 좌표 계산 등이 메인 대화 context를 차지 (2,000~5,000 토큰)
- **대화 흐름 단절**: 시각화 작업 중 대화의 맥락이 밀려남
- **인지 부하**: 사용자도 Claude도 "대화"와 "시각화 작업"을 오가며 혼란

### 핵심 통찰

> "복잡한 현상, 다양한 제약 조건, 아키텍처 등을 텍스트로만 표현하기에는 한계가 있다.
> 해당 맥락에 대해 싱크를 맞추는 중간 도구가 되어야 한다.
> .vync 파일 자체를 쓰면 Claude Code도 이해하는 데 불필요한 노력이 필요하니,
> sub-agent가 중간 레이어로서 .vync로 번역을 해주는 역할을 두어
> 메인 메모리는 사용하지 않도록 한다."

### 기대 효과

| 항목 | 현재 | Sub-agent 도입 후 |
|------|------|-------------------|
| 메인 context 비용 | 2,000~5,000 토큰 | ~630 토큰 (3~8x 절감) |
| 대화 연속성 | 시각화 작업으로 단절 | prose 한 줄로 매끄러운 전환 |
| 관심사 분리 | 혼재 | 명확 (대화 vs JSON 조작) |

## 2. 아키텍처

```
┌─────────────────────────────────────────┐
│  사용자 ↔ Claude Code (메인 세션)       │
│  [대화 중심, prose만 교환]              │
│                                         │
│  "이 아키텍처를 마인드맵으로 정리해줘"  │
│  → prose 구조 정리 → sub-agent 위임     │
│  ← "mindmap: 프로젝트 > [기획, 개발]"  │
├─────────────────────────────────────────┤
│         │ prose ⇅ prose                 │
│  ┌──────┴──────────────────────────┐    │
│  │   Vync Sub-agent (통역가)       │    │
│  │   - vync-editing skill 자동로드  │    │
│  │   - .vync JSON 읽기/쓰기       │    │
│  │   - ID 생성, 검증              │    │
│  │   - 서버 열기 (vync open)       │    │
│  │   [별도 context, 메인 보호]     │    │
│  └──────┬──────────────────────────┘    │
│         │ .vync JSON ⇅                  │
│  ┌──────┴──────────────────────────┐    │
│  │  .vync 파일 ↔ 브라우저          │    │
│  │  [시각적 캔버스, 실시간 동기화]  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### 데이터 흐름

**생성 (Create):**
```
사용자: "프로젝트 계획을 마인드맵으로 정리해줘"
  → 메인 세션: 대화 맥락에서 구조 추출 → prose 정리 + 파일경로 해결 (절대경로)
  → Agent tool: vync-translator spawn (prose + 타입 + 절대파일경로)
    → sub-agent: skill 자동로드 → prose → .vync JSON 변환 → Write → 검증 → vync open
    → sub-agent 반환: "mindmap: 프로젝트 > [기획, 개발, 출시]"
  → 메인 세션: 한 줄 요약 전달, 대화 계속
```

**읽기 (Read):**
```
사용자: "현재 마인드맵 확인해줘"
  → 메인 세션: 파일경로 해결 → Agent tool: vync-translator spawn
    → sub-agent: .vync 파일 Read → JSON 파싱 → 구조 분석 (2단계 깊이)
    → sub-agent 반환: "mindmap: 프로젝트 > [기획(시장조사, 인터뷰), 개발(FE, BE), 출시]"
  → 메인 세션: prose 전달, 대화 계속
```

**업데이트 (Update):**
```
사용자: "개발 아래에 테스트와 CI/CD 추가해줘"
  → 메인 세션: 수정 지시 prose 정리 + 파일경로 해결
  → Agent tool: vync-translator spawn (지시 + 절대파일경로)
    → sub-agent: 파일 Read → 노드 추가 → Write → 검증 → vync open
    → sub-agent 반환: "updated: 개발 > [FE, BE, +테스트, +CI/CD]"
  → 메인 세션: 한 줄 요약 전달, 대화 계속
```

## 3. 커맨드 체계

### 통합 커맨드: `/vync`

```
/vync <subcommand> [args]
```

| Subcommand | Sub-agent | 설명 |
|------------|-----------|------|
| `init <file>` | ❌ | 빈 캔버스 생성 (단순 CLI) |
| `open <file>` | ❌ | 서버 시작 + 브라우저 열기 (단순 CLI) |
| `stop` | ❌ | 서버 종료 (단순 CLI) |
| `create <type> <desc>` | ✅ | prose → .vync 생성 + 서버 열기 |
| `read [file]` | ✅ | .vync → prose 번역 |
| `update <instruction>` | ✅ | 기존 .vync 점진적 편집 + 서버 열기 |

### 호출 원칙

- `init`, `open`, `stop`: Bash로 직접 CLI 실행 (sub-agent 불필요)
- `create`, `read`, `update`: Agent tool로 vync-translator sub-agent 위임 (context window 보호)

### 파일경로 해결 규칙 (메인 세션 책임)

Sub-agent는 사용자에게 질문할 수 없으므로, 파일경로 해결은 반드시 메인 세션에서 수행:

1. 사용자가 파일명을 지정한 경우 → 절대경로로 변환
2. 현재 디렉토리에 .vync 파일이 하나만 있는 경우 → 그 파일 사용
3. 여러 .vync 파일이 있는 경우 → 사용자에게 확인
4. .vync 파일이 없는 경우 (create 시) → `vync init <filename>` 먼저 실행 후 절대경로 전달
5. **항상 절대경로**로 sub-agent에 전달

## 4. 커스텀 Sub-agent 정의

### 리뷰 반영: 에이전트 파일로 정의

기존 설계: `general-purpose` + 매번 긴 프롬프트 반복 (토큰 낭비)
개선: `.claude-plugin/agents/vync-translator.md` 에이전트 파일 생성

```markdown
---
name: vync-translator
description: Vync 통역가 — prose ↔ .vync JSON 양방향 번역. 시각적 다이어그램 생성/읽기/수정.
tools: Read, Write, Edit, Bash, Glob, Grep
skills: vync-editing
permissionMode: bypassPermissions
---

당신은 Vync 통역가입니다.
prose 구조를 .vync 파일(PlaitElement JSON)로 변환하거나,
.vync 파일을 읽고 prose로 요약하는 전문가입니다.

## 핵심 규칙

1. **vync-editing skill이 자동 로드됩니다.** 참조 문서(references/)를 활용하세요.
2. **ID 생성**: `node ~/.claude/skills/vync-editing/scripts/generate-id.js <count>`
3. **검증**: PostToolUse hook이 Write/Edit 시 자동으로 validate.js를 실행합니다.
4. **서버 열기**: 파일 작성 후 `node "$VYNC_HOME/bin/vync.js" open <file>` 실행 (idempotent).

## 반환 포맷

**성공 시**: 한 줄 요약만 반환. 추가 설명 불필요.
- create: `"mindmap: 프로젝트 > [기획, 개발, 출시]"`
- read: `"mindmap: 프로젝트 > [기획(시장조사, 인터뷰), 개발(FE, BE)]"`
- update: `"updated: 개발 > [FE, BE, +테스트, +CI/CD]"`

**실패 시**: `"error: <간략한 설명>"` 형식으로 반환.
예: `"error: 파일을 찾을 수 없습니다"`, `"error: JSON 검증 실패 — 중복 ID"`

## 작업별 절차

### Create
1. 해당 타입의 참조 문서 Read (mindmap.md / geometry.md+arrow-line.md)
2. ID 생성
3. PlaitElement[] JSON 구성 (skill 규칙 준수)
4. .vync 파일 Write (기존 파일 있으면 Read 후 merge)
5. 검증 자동 수행. 실패 시 수정.
6. 서버 열기

### Read
1. .vync 파일 Read
2. JSON 파싱하여 elements 분석
3. 구조를 2단계 깊이까지 요약. 더 깊은 구조는 `...`로 표시.
4. 한 줄 요약 반환

### Update
1. .vync 파일 Read
2. 현재 구조 파악
3. 지시에 따라 노드 추가/수정/삭제
   - 구조적 변경(이동/재배치): Write로 전체 교체
   - 텍스트 수정/노드 추가: Edit로 부분 수정
4. 검증 자동 수행. 실패 시 수정.
5. 서버 열기

## Skill 로드 Fallback

Skill tool이 사용 불가한 경우, 직접 Read:
- `~/.claude/skills/vync-editing/SKILL.md`
- `~/.claude/skills/vync-editing/references/mindmap.md`
- `~/.claude/skills/vync-editing/references/geometry.md`
- `~/.claude/skills/vync-editing/references/arrow-line.md`
```

### 장점 (vs general-purpose + 반복 프롬프트)

| 항목 | general-purpose | 커스텀 에이전트 |
|------|----------------|----------------|
| 프롬프트 반복 | 매번 전체 프롬프트 전달 | 에이전트 파일에 한번 정의 |
| Skill 로드 | 프롬프트에서 수동 지시 | `skills: vync-editing` 자동 로드 |
| 도구 제한 | 모든 도구 사용 가능 | 필요한 도구만 명시적 허용 |
| 권한 모드 | 프롬프트에서 지시 | `permissionMode: bypassPermissions` |
| 유지보수 | 커맨드 파일에 산재 | 에이전트 파일 하나에 집중 |

## 5. 메인 세션의 역할

메인 세션(커맨드 .md가 확장된 후)이 해야 할 것:

### Create 시

1. **파일경로 해결**: §3 규칙에 따라 절대경로 확보. 파일 없으면 `vync init` 먼저 실행.
2. **대화 맥락에서 구조 추출**: 시각화할 내용을 구조화된 트리 prose로 정리
   - 대명사/참조 대신 구체적 내용 포함
   - 구조가 불명확하면 사용자에게 확인 (sub-agent에 위임하지 않음)
3. **Agent tool 호출**: `Agent(subagent_type="vync-translator")` — prose + 타입 + 절대경로 전달
4. **결과 전달**: sub-agent의 한 줄 요약을 사용자에게 전달
5. **대화 계속**: 시각화 작업의 세부사항 없이 대화 이어감

### Read 시

1. **파일경로 해결**: 절대경로 확보
2. **Agent tool 호출**: `Agent(subagent_type="vync-translator")` — 파일경로 전달
3. **결과 활용**: sub-agent의 prose 요약을 대화 맥락에 통합
4. **대화 계속**: prose를 기반으로 논의

### Update 시

1. **파일경로 해결**: 절대경로 확보
2. **수정 지시 정리**: 대화 맥락에서 수정할 내용을 자연어로 정리. 모호하면 사용자에게 확인.
3. **Agent tool 호출**: `Agent(subagent_type="vync-translator")` — 지시 + 절대경로 전달
4. **결과 전달**: sub-agent의 변경 요약을 사용자에게 전달

### Prose 정리 가이드 (커맨드 .md에 포함)

```
구조를 정리할 때:
- 트리 형태의 인덴트된 목록 사용
- 각 항목은 구체적인 이름/레이블 포함
- 관계나 연결이 있으면 명시 (A → B)
- 대명사 대신 실제 내용 사용
- 구조가 불명확하면 사용자에게 확인 후 sub-agent 호출

예시:
- 프로젝트 (root)
  - 기획
    - 시장 조사
    - 사용자 인터뷰
  - 개발
    - 프론트엔드 (React)
    - 백엔드 (Express)
  - 출시
    - 마케팅
```

## 6. Agent Tool 호출 사양

### Create

```typescript
Agent({
  description: "Vync create {type}",
  subagent_type: "vync-translator",
  mode: "bypassPermissions",
  prompt: `
    ## 작업: Create
    타입: {type}
    파일: {absolute_file_path}

    ## 구조
    {prose 트리}
  `
})
```

### Read

```typescript
Agent({
  description: "Vync read file",
  subagent_type: "vync-translator",
  prompt: `
    ## 작업: Read
    파일: {absolute_file_path}
  `
})
```

### Update

```typescript
Agent({
  description: "Vync update diagram",
  subagent_type: "vync-translator",
  mode: "bypassPermissions",
  prompt: `
    ## 작업: Update
    파일: {absolute_file_path}

    ## 수정 지시
    {자연어 지시}
  `
})
```

### 호출 시 주의사항

- Agent tool은 `allowed-tools` frontmatter에 명시적으로 나열되지 않으나, LLM이 항상 사용 가능
- 커맨드 body에서 "Agent tool을 사용하라"고 지시하면 Claude가 자연스럽게 호출
- `run_in_background: false` — 결과를 즉시 메인 세션에 반환해야 하므로 foreground

## 7. 파일 변경 목록

### 신규 생성

| 파일 | 내용 |
|------|------|
| `.claude-plugin/agents/vync-translator.md` | 커스텀 sub-agent 정의 (§4) |

### 수정

| 파일 | 변경 내용 |
|------|-----------|
| `.claude-plugin/commands/vync.md` | `create`, `update` 하위 커맨드 추가. `read`를 sub-agent 위임으로 변경. `allowed-tools` 확장. |
| `.claude-plugin/install.sh` | `vync-create.md` 제거 + deprecated 정리. `agents/` 심볼릭 링크 추가. |

### 제거

| 파일 | 사유 |
|------|------|
| `.claude-plugin/commands/vync-create.md` | `/vync create`로 통합 |

### 유지

| 파일 | 사유 |
|------|------|
| `.claude-plugin/skills/vync-editing/` | Sub-agent가 그대로 사용 |
| `.claude-plugin/hooks.json` | PostToolUse가 sub-agent에서도 글로벌 발동 → 변경 불필요 |
| `tools/cli/open.ts` | Layer 1에서 이미 완료 |

## 8. Install Script 변경

```bash
# 기존: vync-create.md 심볼릭 링크
for cmd in vync.md; do  # vync-create.md 제거
  ...
done

# deprecated vync-create 정리
deprecated="$CLAUDE_DIR/commands/vync-create.md"
[ -L "$deprecated" ] && rm "$deprecated" && echo "  [ok] Removed deprecated: /vync-create"
[ -f "$deprecated" ] && rm "$deprecated" && echo "  [ok] Removed deprecated: /vync-create"

# 에이전트 파일 심볼릭 링크
agents_dir="$CLAUDE_DIR/agents"
mkdir -p "$agents_dir"
for agent in vync-translator.md; do
  src="$PLUGIN_DIR/agents/$agent"
  dst="$agents_dir/$agent"
  [ -L "$dst" ] && rm "$dst"
  ln -s "$src" "$dst" && echo "  [ok] Agent: $agent"
done
```

## 9. 검증 계획

### 구현 전 검증 (Spike — 10분)

**반드시 구현 전에 수행.** Agent tool의 실제 동작을 확인:

1. 커스텀 sub-agent 파일(`~/.claude/agents/test.md`)을 만들고 Agent tool에서 인식되는지 확인
2. Sub-agent 내에서 Read, Write, Bash 도구 사용 가능 여부 확인
3. Sub-agent 내에서 Skill tool로 skill 로드 가능 여부 확인
4. PostToolUse hook이 sub-agent의 Write/Edit에서 발동하는지 확인
5. Sub-agent 결과가 메인 세션에 prose로 반환되는지 확인

### 기능 검증

1. **Create flow**: `/vync create mindmap "프로젝트 계획"` → vync-translator spawn → 파일 생성 + 서버 열기 → 한 줄 요약 반환
2. **Read flow**: `/vync read` → vync-translator spawn → 파일 읽기 → prose 요약 반환
3. **Update flow**: `/vync update "개발 아래에 테스트 추가"` → vync-translator spawn → 파일 수정 → 변경 요약 반환
4. **Context 보호**: create/read/update 후 메인 세션의 context에 .vync JSON이 남지 않음을 확인
5. **대화 연속성**: 시각화 작업 전후로 대화 맥락이 유지됨을 확인

### Edge Cases

| Case | 예상 동작 |
|------|-----------|
| 파일 없이 create | 메인 세션이 `vync init` 먼저 실행 후 sub-agent에 절대경로 전달 |
| 파일 없이 read | sub-agent 반환: `"error: 파일을 찾을 수 없습니다"` |
| 서버 이미 실행 중 | `vync open`이 idempotent (same-file: 브라우저만 열기) |
| 동일 이름 노드 여러 개 | sub-agent가 맥락 기반 추론 또는 가장 가까운 매치 |
| 대화 맥락 부족 | 메인 세션이 사용자에게 확인 후 sub-agent 호출 (sub-agent에 위임하지 않음) |
| Sub-agent 실패 | `"error: ..."` 반환 → 메인 세션이 사용자에게 안내 + 재시도 제안 |
| Sub-agent가 잘못된 파일 수정 | 절대경로 전달로 방지 (상대경로 사용 금지) |
| 동시 create 호출 | LWW(D-008) + 원자적 쓰기로 파일 안전. 단, 동시 호출은 권장하지 않음 |
| 큰 파일의 Read | 2단계 깊이까지 요약, `...`으로 생략 표시 |
| 서버 안 돌고 있을 때 update | Update 프롬프트에 `vync open` 포함 → 자동 서버 시작 |
| Skill tool 불가 | Fallback: SKILL.md + references 직접 Read |

## 10. 향후 확장 (Layer 3)

### "생각이 보이는 대화" 완성

Layer 2 완성 후 고려할 방향:

- **대화 중 자동 업데이트**: 대화에서 합의된 결정사항이 자동으로 Vync에 반영
  - Claude가 "이 결정을 마인드맵에 반영할까요?"라고 제안
  - 사용자 승인 시 sub-agent로 업데이트

- **세션 간 맥락 브릿지**: .vync 파일이 세션 간 지식 전달 매체
  - 새 세션 시작 시 `/vync read`로 이전 맥락 복원
  - 대화 기반이 아닌 시각적 구조 기반의 맥락 복원

- **멀티 파일 지원**: 주제별로 다른 .vync 파일 관리
  - `architecture.vync`, `roadmap.vync`, `decisions.vync`
  - `/vync read all` → 모든 파일의 요약

## 11. 설계 결정 근거

| 결정 | 근거 | 대안 | 변경 |
|------|------|------|------|
| ~~general-purpose sub-agent~~ → **커스텀 vync-translator** | Skill 자동 로드, 프롬프트 재사용, 토큰 절약 | general-purpose + 반복 프롬프트 | v2 변경 |
| /vync 통합 커맨드 | 진입점 하나가 직관적 | 별도 /vync-create, /vync-update — 분산 | 유지 |
| 한 줄 prose 반환 | 대화 흐름 유지 최우선 | 트리 구조 반환 — context 소모 | 유지 |
| bypassPermissions mode | create/update 시 Write/Edit 허용 필수 | 사용자에게 매번 허가 요청 — UX 저하 | 유지 |
| foreground 실행 | 결과를 즉시 대화에 사용해야 함 | background — 비동기 결과 처리 복잡 | 유지 |
| 기존 vync-editing skill 유지 | Sub-agent가 `skills:` frontmatter로 자동 활용 | skill 내용을 프롬프트에 인라인 | 유지 |
| 메인 세션에서 파일경로 해결 | Sub-agent는 AskUser 불가 | sub-agent에서 파일 탐색 — 실패 위험 | v2 추가 |
| 에러 반환 포맷 정의 | 실패 시 메인 context 오염 방지 | 자유 형식 에러 — 장황해질 위험 | v2 추가 |
| Read depth limit (2단계) | 큰 파일의 prose 폭발 방지 | 전체 구조 반환 — context 소모 | v2 추가 |

## 12. 의도적으로 제외한 항목 (리뷰 논의 후)

| 항목 | 사유 |
|------|------|
| `context: fork` 커맨드 옵션 | /vync 통합 커맨드에서 subcommand별 fork 여부가 달라야 해서 적용 불가 |
| /vync delete 별도 커맨드 | `/vync update "X 노드 삭제"` 로 충분 |
| Sub-agent 중첩 호출 | Claude Code에서 sub-agent는 다른 sub-agent spawn 불가 |
| 동적 포트 할당 | 포트 3100 고정이 현재 아키텍처의 전제 |
| WebSocket graceful drain | LWW 정책으로 데이터 유실 위험 낮음 |

## 13. 구현 순서

1. **Spike (10분)**: Agent tool 실제 동작 검증 (§9 구현 전 검증)
2. **에이전트 파일**: `.claude-plugin/agents/vync-translator.md` 생성
3. **커맨드 통합**: `.claude-plugin/commands/vync.md` 재설계
4. **deprecated 제거**: `vync-create.md` 삭제
5. **Install script**: 에이전트 링크 + deprecated 정리
6. **E2E 검증**: create → read → update 전체 흐름
7. **문서 업데이트**: D-013 등록, ARCHITECTURE.md, CLAUDE.md
