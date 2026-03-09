---
description: Vync server and file management (init, open, close, stop, read, create, update)
allowed-tools: Bash, Read, Agent
argument-hint: <init|open|close|stop|create|read|update> [args]
---
<!-- GITHUB-UPDATE-POC-MARKER -->

Run the Vync CLI or delegate to the vync-translator sub-agent.

## Subcommands

### CLI (direct execution)
- `init <file>` — Create an empty .vync canvas file in CWD/.vync/
- `open <file>` — Register file with hub server and open browser. Starts server if not running.
- `close [file]` — Unregister file from server. If no files remain, server stops.
  - `--keep-server` — Unregister but keep server running.
- `stop` — Stop the running Vync server

For these, run via Bash:
```bash
node "$VYNC_HOME/bin/vync.js" <subcommand> [args]
```

### Sub-agent delegation (context window 보호)
- `create <type> <description>` — prose → .vync 생성 + 서버 열기
- `read [file]` — .vync → prose 번역
- `update <instruction>` — 기존 .vync 점진적 편집 + 서버 열기

For these, use the Agent tool with `subagent_type: "vync-translator"`.

## Sub-agent 호출 절차

### 파일경로 해결 (메인 세션 책임 — sub-agent 호출 전에 반드시 수행)

1. 사용자가 파일명 지정 → 절대경로로 변환 (bare name → `CWD/.vync/<name>.vync`)
2. CWD/.vync/에 .vync 파일이 하나만 있음 → 그 파일 사용
3. 여러 .vync 파일 있음 → 사용자에게 확인
4. .vync 파일 없음 (create 시) → `vync init <filename>` 먼저 실행
5. **항상 절대경로**로 sub-agent에 전달

### Create

1. 대화 맥락에서 구조 추출 → 트리 prose로 정리
2. 파일경로 해결 (없으면 `vync init` 먼저)
3. Agent tool 호출:

```
Agent({
  description: "Vync create <type>",
  subagent_type: "vync-translator",
  mode: "bypassPermissions",
  prompt: "## 작업: Create\n타입: <type>\n파일: <absolute_path>\n\n## 구조\n<prose 트리>"
})
```

4. Sub-agent의 한 줄 요약을 사용자에게 전달

### Read

1. 파일경로 해결
2. Agent tool 호출:

```
Agent({
  description: "Vync read file",
  subagent_type: "vync-translator",
  prompt: "## 작업: Read\n파일: <absolute_path>"
})
```

3. Sub-agent의 prose 요약을 대화에 통합
   - diff가 포함된 경우 ("변경: ..."), 변경 내용을 대화 맥락에 반영
   - "(변경 없음)"인 경우, 현재 상태만 참고

### Update

1. 파일경로 해결
2. 수정 지시를 자연어로 정리 (모호하면 사용자에게 확인)
3. Agent tool 호출:

```
Agent({
  description: "Vync update diagram",
  subagent_type: "vync-translator",
  mode: "bypassPermissions",
  prompt: "## 작업: Update\n파일: <absolute_path>\n\n## 수정 지시\n<자연어 지시>"
})
```

4. Sub-agent의 변경 요약을 사용자에게 전달

## Prose 정리 가이드 (Create/Update 시)

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
