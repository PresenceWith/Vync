# Plugin 경로 하드코딩 수정 계획

**날짜**: 2026-03-13
**브랜치**: feat/semantic-sync (또는 별도 브랜치)
**상태**: 구현 + 검증 완료

## 문제

플러그인 마켓플레이스 등록 이후, SKILL.md와 agents/vync-translator.md에 하드코딩된 `~/.claude/skills/vync-editing/...` 경로가 실제 파일 위치와 불일치:

- **하드코딩 경로**: `~/.claude/skills/vync-editing/scripts/generate-id.js`
- **실제 위치**: `~/.claude/plugins/cache/PresenceWith-Vync/vync/0.1.0/skills/vync-editing/scripts/generate-id.js`
- **결과**: `MODULE_NOT_FOUND` (Bash), `Unknown skill: vync` (Skill tool은 `vync:vync` 필요)

## 해결 방안: $VYNC_HOME 기반 하이브리드 접근

### 설계 원칙

| 컨텍스트 | 방법 | 이유 |
|---------|------|------|
| Bash 명령 (generate-id, validate) | `$VYNC_HOME/skills/...` | Shell이 env var 자동 확장 |
| Read tool fallback | `$VYNC_HOME/...` + "먼저 echo로 확인" 안내 | Read tool은 env var 미확장 → AI가 해석 |
| Skill 자동 로드 | `skills: vync-editing` frontmatter (변경 없음) | Claude Code가 플러그인 내부에서 해석 |

### 기각한 대안

| 대안 | 기각 이유 |
|------|----------|
| 캐시 절대경로 (`~/.claude/plugins/cache/.../0.1.0/...`) | 버전 의존적, 버전 변경 시 깨짐 |
| install.sh sed 템플릿 (`__VYNC_HOME__` → 실제경로) | 비멱등, 캐시 파일 변조, 복잡도 증가 |
| 상대 경로 (`./scripts/...`) | Read tool은 절대경로 필요, skill 로드 시 working dir ≠ skill dir |

## 수정 대상 (2 files, 12곳)

### 1. `skills/vync-editing/SKILL.md` — 5곳

| Line | 변경 내용 |
|------|----------|
| 22 | `node ~/.claude/skills/...` → `node "$VYNC_HOME/skills/..."` |
| 32 | 동일 패턴 |
| 85 | validate.js 경로 동일 변경 |
| 89-90 | assets 경로: `~/.claude/skills/...` → `$VYNC_HOME/skills/...` |

### 2. `agents/vync-translator.md` — 7곳

| Line | 변경 내용 |
|------|----------|
| 17 | generate-id.js 경로 |
| 18 | validate.js 경로 |
| 59 | Create 절차 validate.js |
| 84 | Update 절차 validate.js |
| 89-96 | Fallback 섹션: Read 전 `echo $VYNC_HOME` 단계 추가 |

### 수정 불필요

- `hooks/hooks.json` — vync-editing 참조 없음
- `commands/vync.md` — 이미 `$VYNC_HOME` 사용 중
- `.claude-plugin/install.sh` — 이미 정상

## 리스크 분석

| 시나리오 | 리스크 | 비고 |
|---------|--------|------|
| 최초 npm install | Low | install.sh → settings.env 먼저 설정 → 다음 세션부터 가용 |
| Sub-agent Bash 호출 | **PoC 필요** | settings.env 전파 여부 실제 검증 필요 |
| Read tool fallback | **PoC 필요** | AI가 $VYNC_HOME → 절대경로 치환 가능한지 검증 |
| 플러그인 버전 변경 | None | $VYNC_HOME은 프로젝트 루트 → 버전 무관 |
| 프로젝트 이동 후 npm install | None | VYNC_HOME 자동 갱신 |
| 다중 Vync 체크아웃 | Medium | 마지막 install 기준 (현행과 동일한 제약) |

---

## PoC 항목 (실행 전 검증 필수)

### PoC-1: Sub-agent에서 $VYNC_HOME 접근 가능 여부

**목적**: vync-translator sub-agent의 Bash에서 `$VYNC_HOME`이 확장되는지 확인
**방법**:
```
Agent({
  subagent_type: "vync:vync-translator",
  mode: "bypassPermissions",
  prompt: "## 테스트\nBash로 `echo $VYNC_HOME` 실행 후 결과를 반환해줘."
})
```
**기대**: `/Users/presence/projects/Vync` 출력
**실패 시 대안**: translator.md에 "메인 세션이 VYNC_HOME 값을 prompt에 포함" 패턴 추가

### PoC-2: Sub-agent에서 $VYNC_HOME 기반 스크립트 실행

**목적**: 실제 generate-id.js가 `$VYNC_HOME` 경로로 실행되는지
**방법**:
```
Agent({
  subagent_type: "vync:vync-translator",
  mode: "bypassPermissions",
  prompt: "## 테스트\nBash로 `node \"$VYNC_HOME/skills/vync-editing/scripts/generate-id.js\" 3` 실행 후 결과를 반환해줘."
})
```
**기대**: 3개 랜덤 ID 출력
**실패 시 대안**: PoC-1 실패와 동일

### PoC-3: Read tool fallback 경로 해석

**목적**: Sub-agent가 "$VYNC_HOME/..." 텍스트를 보고 실제 절대경로로 Read할 수 있는지
**방법**:
```
Agent({
  subagent_type: "vync:vync-translator",
  mode: "bypassPermissions",
  prompt: "## 테스트\n1. Bash로 `echo $VYNC_HOME` 실행\n2. 그 결과를 사용하여 `$VYNC_HOME/skills/vync-editing/references/mindmap.md`를 Read\n3. 첫 3줄을 반환해줘."
})
```
**기대**: mindmap.md 첫 3줄 (`# Mindmap Elements...`) 반환
**실패 시 대안**: fallback 섹션을 "Bash에서 `cat $VYNC_HOME/skills/.../mindmap.md`" 방식으로 변경

### PoC 순서

PoC-1 → (통과 시) PoC-2 → (통과 시) PoC-3
- PoC-1 실패 시: 대안 검토 후 계획 수정
- 전체 통과 시: 본 수정 실행

## 검증 결과 (2026-03-13)

### PoC 결과: 3/3 PASS
| # | 결과 | 비고 |
|---|------|------|
| PoC-1 | **PASS** | `echo $VYNC_HOME` → `/Users/presence/projects/Vync` |
| PoC-2 | **PASS** | generate-id.js 5개 ID + validate.js OK |
| PoC-3 | **PASS** | `echo $VYNC_HOME` → Read tool 절대경로 치환 → mindmap.md 정상 읽기 |

### E2E 검증 (새 세션): PASS
- 새 Claude Code 세션에서 `/vync create` 호출
- translator sub-agent가 `$VYNC_HOME` 기반 generate-id.js, validate.js 정상 실행
- .vync 파일에 마인드맵 JSON 작성 + 요약 반환 확인
- `Skill(vync)` → `Unknown skill` (네임스페이스 필요: `vync:vync`) — 별도 이슈, 경로 수정과 무관
