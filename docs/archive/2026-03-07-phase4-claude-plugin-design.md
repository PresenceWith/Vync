# Phase 4: Claude Code 통합 플러그인 설계

> 2026-03-07 확정. Claude Code의 전역 확장 시스템을 통해 .vync 파일의 전체 라이프사이클을 관리.

---

## 목표

Claude Code 세션 안에서 .vync 파일의 **생성 -> 서버 시작 -> 편집 -> 검증 -> 서버 종료** 전체 라이프사이클을 관리하는 통합 도구 구축.

- 스코프: **전역** (`~/.claude/`)
- 서버 관리: **플러그인(Command)에서 관리**, CLI를 기반 레이어로 사용
- 검증: **PostToolUse hook으로 자동**

---

## 컴포넌트 (5개)

| # | 컴포넌트 | 유형 | 역할 | 스코프 |
|---|---------|------|------|--------|
| 1 | `bin/vync.js` + `src/cli/` | CLI | 기반 레이어. 서버 시작/종료, 파일 생성 | npm link (전역) |
| 2 | `vync-editing` | Skill | 지식 레이어. 편집 가이드 + 검증 스크립트 + 예시 | ~/.claude/skills/ |
| 3 | `/vync` | Command | 유틸리티. CLI thin wrapper (init/open/stop/read) | ~/.claude/commands/ |
| 4 | `/vync-create` | Command | 핵심 진입점. 다이어그램 생성 (Skill 트리거) | ~/.claude/commands/ |
| 5 | PostToolUse + SessionEnd | Hooks | 자동 검증 + 서버 정리 | ~/.claude/settings.json |

---

## 의존성 그래프

```
[Skill: vync-editing] ← 독립 (의존성 0)
    ^                 ^
    |                 |
    | 참조            | scripts/ 사용
    |                 |
[Cmd: /vync-create]  [Hook: PostToolUse]
                      [Hook: SessionEnd]
[Cmd: /vync] --> [CLI: bin/vync.js] --> [src/server/]
```

**규칙**:
- Skill은 순수 지식 + 유틸리티. 다른 것에 의존하지 않음.
- CLI는 Vync 서버 코드에 의존하지만, 플러그인 시스템과는 독립.
- Commands/Hooks는 CLI 또는 Skill에만 의존.

---

## 파일 구조

```
Vync/
├── bin/vync.js                     # CLI 진입점 (shebang, process.argv)
├── src/cli/
│   ├── init.ts                     # vync init: 빈 .vync 파일 생성
│   └── open.ts                     # vync open: 서버 시작 + 브라우저 열기
│
├── claude-plugin/                  # Claude Code 플러그인 소스
│   ├── install.sh                  # ~/.claude/에 심볼릭 링크 + 설정 머지
│   ├── uninstall.sh                # 정리
│   │
│   ├── skills/
│   │   └── vync-editing/
│   │       ├── SKILL.md            # 트리거 + 개요 + 편집 워크플로우
│   │       ├── references/
│   │       │   ├── mindmap.md      # 마인드맵 상세 가이드
│   │       │   ├── geometry.md     # 도형 상세 가이드
│   │       │   ├── arrow-line.md   # 연결선 + 바인딩 가이드
│   │       │   └── coordinates.md  # 좌표계 + 레이아웃
│   │       ├── scripts/
│   │       │   ├── validate.js     # JSON Schema 검증 (hook에서 사용)
│   │       │   └── generate-id.js  # idCreator(5) 유틸리티
│   │       └── assets/
│   │           ├── schema.json     # .vync JSON Schema
│   │           ├── mindmap.vync    # 마인드맵 예시
│   │           └── flowchart.vync  # 플로우차트 예시
│   │
│   ├── commands/
│   │   ├── vync.md                 # /vync init|open|stop|read
│   │   └── vync-create.md          # /vync-create <type> <desc>
│   │
│   └── hooks.json                  # PostToolUse + SessionEnd 설정
│
└── .vync.schema.json               # JSON Schema (프로젝트 루트 복사본)
```

---

## 컴포넌트 상세

### 1. CLI (bin/vync.js + src/cli/)

기반 레이어. 터미널에서 직접 실행 가능하며, /vync 커맨드가 내부적으로 호출.

**서브커맨드**:
- `vync init <file>` -- 빈 캔버스 .vync 파일 생성. 이미 존재하면 에러.
- `vync open <file>` -- 서버 시작 + 브라우저 열기. background process로 실행, PID를 /tmp/vync-server.pid에 저장.
- `vync stop` -- PID 파일 기반으로 서버 종료.

**프로젝트 경로 해결**:
- `VYNC_HOME` 환경변수 우선
- 없으면 cwd에서 상위로 탐색하여 Vync 프로젝트 package.json 탐색
- 못 찾으면 에러 메시지 + 종료

**기존 server.ts 재사용**:
- `src/server/server.ts`의 `main()` 함수를 export하여 `open.ts`에서 import 호출
- 브라우저 열기: `open` npm 패키지 (크로스 플랫폼)

### 2. Skill: vync-editing

핵심 지식 패키지. Claude Code가 .vync JSON을 올바르게 편집할 수 있도록 가이드.

**SKILL.md 트리거 조건** (description 키워드):
- `.vync` 파일 편집/생성/수정
- 마인드맵, 다이어그램, 플로우차트, 캔버스 생성
- PlaitElement, Plait, Drawnix 관련 작업

**SKILL.md 본문** (~100단어 개요):
- .vync 파일 포맷 요약 (version, viewport, elements)
- ID 생성 규칙 (idCreator(5), 문자셋)
- 편집 워크플로우: 1) 대상 파일 확인 2) references/ 로드 3) 생성/수정 4) 검증
- 주의사항: children 배열 비어있으면 안 됨, boundId 참조 정확성

**references/** (필요 시 로드):
- `mindmap.md`: MindElement 구조, 트리 계층, data.topic, rightNodeCount. 마인드맵 생성 템플릿 포함.
- `geometry.md`: PlaitGeometry 구조, shape enum 전체 목록, points 바운딩 박스 규칙. 도형 배치 템플릿 포함.
- `arrow-line.md`: PlaitArrowLine 구조, boundId + connection 좌표 매핑 테이블, 연결선 생성 주의사항.
- `coordinates.md`: 좌표계 규칙, Point 타입, 바운딩 박스, 레이아웃 패턴 (격자 배치, 트리 배치).

**scripts/**:
- `validate.js`: stdin으로 파일 경로 받아 JSON Schema 검증. exit 0 = OK, exit 1 = 에러 (stderr에 상세).
- `generate-id.js`: idCreator(5) 구현. `node generate-id.js` -> 5자 랜덤 ID 출력. 테스트/디버깅용.

**assets/**:
- `schema.json`: .vync JSON Schema. VyncFile 최상위 + elements oneOf (mindmap, geometry, arrow-line, vector-line, image).
- `mindmap.vync`: 3단계 마인드맵 예시 (루트 + 2레벨 자식).
- `flowchart.vync`: 도형 3개 + 연결선 2개 플로우차트 예시.

### 3. Command: /vync

CLI thin wrapper. Claude Code 안에서 서버 관리.

```yaml
---
description: Vync 서버 및 파일 관리 (init, open, stop, read)
allowed-tools: Bash(vync:*), Read
argument-hint: <init|open|stop|read> [file]
---
```

**동작**:
- `$ARGUMENTS`를 `vync` CLI에 전달: `vync $ARGUMENTS`
- `read <file>` 서브커맨드만 특수 처리: Read 도구로 파일을 읽고 사람이 읽을 수 있는 형태로 요약

### 4. Command: /vync-create

핵심 편집 진입점. Skill을 명시적으로 트리거하여 다이어그램 생성.

```yaml
---
description: .vync 다이어그램 생성 (마인드맵, 플로우차트, 자유 배치)
allowed-tools: Read, Write, Edit, Bash
argument-hint: <mindmap|flowchart|diagram> <description>
---
```

**동작**:
1. vync-editing skill 참조 (명시적 안내)
2. 타입에 맞는 references/ 로드 안내
3. 대상 .vync 파일 확인 (없으면 init 제안)
4. Claude가 PlaitElement[] JSON 생성
5. Write로 파일에 저장
6. PostToolUse hook이 자동 검증

### 5. Hooks

**PostToolUse** (Edit|Write on *.vync):
```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "jq -r '.tool_input.file_path // \"\"' | { read f; [[ \"$f\" == *.vync ]] && node ~/.claude/skills/vync-editing/scripts/validate.js \"$f\" || exit 0; }"
  }]
}
```
- .vync 확장자 사전 필터링 (~10ms 오버헤드)
- .vync 파일인 경우만 validate.js 실행
- 검증 실패 시 stderr에 경고 출력 (Claude가 피드백으로 수신)

**SessionEnd**:
```json
{
  "matcher": "*",
  "hooks": [{
    "type": "command",
    "command": "[ -f /tmp/vync-server.pid ] && kill $(cat /tmp/vync-server.pid) 2>/dev/null && rm /tmp/vync-server.pid; exit 0"
  }]
}
```
- 서버 PID 파일 존재 시 프로세스 종료 + PID 파일 삭제

---

## 설치/제거

### install.sh

1. Skill 심볼릭 링크: `~/.claude/skills/vync-editing -> claude-plugin/skills/vync-editing`
2. Commands 심볼릭 링크: `~/.claude/commands/vync.md`, `~/.claude/commands/vync-create.md`
3. Settings 머지: `jq`로 기존 `~/.claude/settings.json`에 hooks 설정 안전하게 추가
4. 환경변수: `VYNC_HOME` 설정 (settings.json의 env 섹션)
5. CLI 전역 등록: `npm link` 실행

### uninstall.sh

1. 심볼릭 링크 제거
2. Settings에서 vync hooks 제거
3. VYNC_HOME 환경변수 제거
4. `npm unlink` 실행

---

## 사용자 워크플로우

```bash
# 1회: 설치
cd ~/projects/Vync && ./claude-plugin/install.sh

# Claude Code 세션
> /vync init plan.vync              # 빈 캔버스 생성
> /vync open plan.vync              # 서버 시작 + 브라우저 열기
> /vync-create mindmap "Sprint 1 계획: 인증, 결제, 대시보드"
#   -> skill 로드 -> MindElement[] 생성 -> Write -> 자동 검증
#   -> 웹 UI에 즉시 마인드맵 반영
> "에러 핸들링 브랜치 추가해줘"      # 자연어 -> skill 자동 트리거
> /vync stop                        # 서버 종료
# (세션 종료 시 SessionEnd hook이 자동 정리)
```

---

## 기존 Phase 4 태스크 매핑

| 기존 태스크 | 새 위치 |
|------------|---------|
| 4.1 `vync init` | CLI (bin/vync.js + src/cli/init.ts) |
| 4.2 `vync open` | CLI (bin/vync.js + src/cli/open.ts) |
| 4.3 CLAUDE.md | Skill: vync-editing (SKILL.md + references/) |
| 4.4 .vync.schema.json | Skill: assets/schema.json + Hook: validate.js |
| 4.5 examples/*.vync | Skill: assets/mindmap.vync, flowchart.vync |

---

## 리뷰에서 발견된 리스크와 대응

| 리스크 | 대응 |
|--------|------|
| 전역 Hook이 모든 세션에서 실행 | .vync 확장자 사전 필터링 (~10ms) |
| 전역 플러그인이 Vync 프로젝트에 의존 | VYNC_HOME 환경변수 + 프로젝트 탐색 fallback |
| CLAUDE.md 없이 Skill 트리거 불확실 | description 키워드 + /vync-create 명시적 진입점 |
| settings.json hooks 머지 충돌 | jq로 안전 머지 (기존 hook 보존) |
| 다른 프로젝트에서 오트리거 | Skill 본문에서 .vync 파일 존재 확인 분기 |
| npm link 깨짐 (프로젝트 이동) | VYNC_HOME fallback |

---

## 향후 확장 (Phase 4 이후)

- **Agent: vync-editor** -- 복잡한 10+ 노드 다이어그램 위임. Skill 안정화 후 추가.
- **MCP Server** -- D-010에서 MVP 제외. 구조화된 AI 조작 API.
- **배포 가능 플러그인** -- .claude-plugin/ manifest + marketplace 등록.
