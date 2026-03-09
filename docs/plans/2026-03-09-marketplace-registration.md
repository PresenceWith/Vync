# Design: Claude Code Marketplace 등록

**Date:** 2026-03-09
**Status:** Draft
**Depends on:** Phase 9 완료 (Multi-Tab UI)

## Goal

Vync Claude Code 플러그인을 마켓플레이스에 등록하여, 프로젝트를 clone하지 않고도 `/plugin install vync`로 설치하고 `/plugin update`로 업데이트할 수 있도록 한다.

현재 설치 방식 (npm postinstall → install.sh 심링크)은 개발자 전용. 마켓플레이스 등록으로 일반 사용자도 접근 가능하게 확장.

## 리서치 결과

### 마켓플레이스 시스템 분석

- Claude Code 마켓플레이스는 **GitHub repo 기반 self-hosted** 방식이 표준
- claude-hud, everything-claude-code 등 주요 플러그인 모두 동일 패턴 사용
- `.claude-plugin/`에는 `plugin.json` + `marketplace.json`만 위치
- commands, skills, agents, hooks는 **프로젝트 루트 레벨**에 위치해야 함

### Repo 크기 이슈

- Vync repo: working tree ~3GB (node_modules, dist 포함), `.git` 4.4MB
- 마켓플레이스 clone 시 `.gitignore` 대상은 제외됨 → git tracked 파일만 clone
- 실제 clone 크기: 수십 MB 수준 → 문제 없음
- 비교: claude-hud ~2.6MB, everything-claude-code ~46MB, claude-plugins-official ~7.7MB

### 설치 흐름

```
사용자: /plugin marketplace add PresenceWith/Vync
        → GitHub repo clone → ~/.claude/plugins/marketplaces/PresenceWith-Vync/

사용자: /plugin install vync@PresenceWith-Vync
        → marketplace에서 plugin 복사 → ~/.claude/plugins/cache/PresenceWith-Vync/vync/<version>/
        → commands, skills, agents, hooks 자동 등록

사용자: /plugin update vync@PresenceWith-Vync
        → marketplace git pull → 새 버전 복사 → 자동 재등록
```

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| P-1 | 같은 repo에서 self-hosted marketplace | 코드와 플러그인 한 repo, 버전 동기화 쉬움. 업계 표준 패턴 (claude-hud, ECC 동일). |
| P-2 | 루트 레벨 파일 재배치 | 마켓플레이스 표준 필수사항. `.claude-plugin/` 안에서 루트로 이동. |
| P-3 | hooks.json validate 인라인화 | 마켓플레이스 설치 시 `$HOME/.claude/skills/` 경로가 달라짐. 인라인 node 스크립트로 경로 독립성 확보. |
| P-4 | 개발자 모드 (install.sh) 병행 유지 | npm install → postinstall로 기존 개발자 워크플로우 유지. 마켓플레이스와 충돌 없음. |
| P-5 | Anthropic Official Directory는 안정화 후 | 먼저 self-hosted로 검증, 이후 공식 제출 (clau.de/plugin-directory-submission). |

## Architecture

### 현재 구조 → 목표 구조

```
# 현재 (.claude-plugin/ 안에 모든 것)     # 목표 (마켓플레이스 표준)
.claude-plugin/                            .claude-plugin/
├── plugin.json                            ├── plugin.json      ← 수정
├── hooks.json                             ├── marketplace.json ← 신규
├── install.sh                             ├── install.sh       ← 경로 수정
├── uninstall.sh                           └── uninstall.sh     ← 확인
├── agents/                                agents/              ← 루트로 이동
│   └── vync-translator.md                 └── vync-translator.md
├── commands/                              commands/            ← 루트로 이동
│   └── vync.md                            └── vync.md
└── skills/                                skills/              ← 루트로 이동
    └── vync-editing/                      └── vync-editing/
        ├── SKILL.md                           └── (전체 유지)
        ├── references/ (4)                hooks/               ← 루트에 신규
        ├── scripts/ (2)                   └── hooks.json       ← 인라인화
        └── assets/ (3)
```

### hooks.json 인라인화

현재 PostToolUse hook이 `$HOME/.claude/skills/vync-editing/scripts/validate.js`를 참조.
마켓플레이스 설치 시 이 경로는 존재하지 않음 (플러그인이 `~/.claude/plugins/cache/`에 설치됨).

해결: validate.js 핵심 로직 (version, viewport, elements 검증)을 인라인 node 스크립트로 변환.
validate.js 원본은 skills/vync-editing/scripts/에 유지 (sub-agent가 명시적으로 호출 가능).

## Implementation Steps

### Step 1: 파일 재배치 (git mv)

```bash
git mv .claude-plugin/commands commands
git mv .claude-plugin/skills skills
git mv .claude-plugin/agents agents
mkdir hooks
git mv .claude-plugin/hooks.json hooks/hooks.json
```

### Step 2: plugin.json 업데이트

`.claude-plugin/plugin.json`:

```json
{
  "name": "vync",
  "description": "Visual planning tool with real-time file sync. Create and edit mindmaps, flowcharts, and diagrams from Claude Code.",
  "version": "0.1.0",
  "author": {
    "name": "PresenceWith",
    "url": "https://github.com/PresenceWith"
  },
  "homepage": "https://github.com/PresenceWith/Vync",
  "repository": "https://github.com/PresenceWith/Vync",
  "license": "MIT",
  "keywords": ["whiteboard", "mindmap", "flowchart", "diagram", "visual-planning", "file-sync"]
}
```

### Step 3: marketplace.json 생성

`.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "PresenceWith-Vync",
  "description": "Visual planning tool with real-time file sync for Claude Code",
  "owner": {
    "name": "PresenceWith",
    "email": "presence042@gmail.com"
  },
  "plugins": [
    {
      "name": "vync",
      "source": "./",
      "description": "Create and edit mindmaps, flowcharts, and diagrams with real-time file sync between Claude Code and web UI",
      "version": "0.1.0",
      "author": {
        "name": "PresenceWith",
        "url": "https://github.com/PresenceWith"
      },
      "homepage": "https://github.com/PresenceWith/Vync",
      "repository": "https://github.com/PresenceWith/Vync",
      "license": "MIT",
      "category": "productivity",
      "tags": ["whiteboard", "mindmap", "flowchart", "diagram", "visual-planning", "file-sync"]
    }
  ]
}
```

### Step 4: hooks.json 수정

`hooks/hooks.json` — PostToolUse validate를 인라인 스크립트로 변경:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "<인라인 node 검증 스크립트>"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "<기존 Hub Server 정리 스크립트 유지>"
          }
        ]
      }
    ]
  }
}
```

### Step 5: install.sh 업데이트

경로를 `$SCRIPT_DIR/` → `$PROJECT_ROOT/` 기준으로 변경:
- skills: `$PROJECT_ROOT/skills/vync-editing`
- commands: `$PROJECT_ROOT/commands/vync.md`
- agents: `$PROJECT_ROOT/agents/vync-translator.md`
- hooks: `$PROJECT_ROOT/hooks/hooks.json`

### Step 6: CLAUDE.md 업데이트

플러그인 섹션 경로 설명을 마켓플레이스 표준 구조로 업데이트.

## Files to Modify

| File | Action |
|------|--------|
| `commands/vync.md` | git mv from `.claude-plugin/commands/` |
| `skills/vync-editing/` | git mv (전체 디렉토리) |
| `agents/vync-translator.md` | git mv from `.claude-plugin/agents/` |
| `hooks/hooks.json` | git mv + PostToolUse 인라인화 |
| `.claude-plugin/plugin.json` | author → object, homepage 추가 |
| `.claude-plugin/marketplace.json` | 새로 생성 |
| `.claude-plugin/install.sh` | 경로 $PROJECT_ROOT/ 기준 변경 |
| `.claude-plugin/uninstall.sh` | 확인 (변경 최소) |
| `CLAUDE.md` | 플러그인 구조 설명 업데이트 |

## Verification

1. `/plugin validate .` → 플러그인 매니페스트 유효성 확인
2. 로컬 마켓플레이스 테스트:
   ```bash
   /plugin marketplace add /Users/presence/projects/Vync
   /plugin install vync@PresenceWith-Vync
   ```
3. 기능 확인:
   - `/vync` 명령어 전체 (init, open, close, stop, create, read, update)
   - `vync-editing` 스킬 로드
   - `vync-translator` 에이전트 인식
   - PostToolUse hook (.vync 검증)
4. 개발자 모드: `npm install` → install.sh 정상 동작
5. GitHub 마켓플레이스 (push 후):
   ```bash
   /plugin marketplace add PresenceWith/Vync
   /plugin install vync@PresenceWith-Vync
   ```

## User Installation Workflow (Result)

```bash
# 1회: 마켓플레이스 등록
/plugin marketplace add PresenceWith/Vync

# 플러그인 설치
/plugin install vync@PresenceWith-Vync

# 업데이트
/plugin update vync@PresenceWith-Vync
```
