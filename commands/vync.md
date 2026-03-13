---
description: Vync server and file management (init, open, close, stop, diff, create, read, update)
allowed-tools: Bash, Read, Agent
argument-hint: <init|open|close|stop|diff|create|read|update> [args]
---

Run the Vync CLI or delegate to the vync-translator sub-agent.

## Subcommands

### CLI (direct execution)
- `init <file>` — Create an empty .vync canvas file in CWD/.vync/
- `open <file>` — Register file with hub server and open browser. Starts server if not running.
- `close [file]` — Unregister file from server. If no files remain, server stops.
  - `--keep-server` — Unregister but keep server running.
- `stop` — Stop the running Vync server
- `diff [file]` — 마지막 동기화 이후 변경사항 표시 (프로그래밍적)
  - `--no-snapshot` — diff만 보고 스냅샷 갱신 안 함

For these, run via Bash:
```bash
node "$VYNC_HOME/bin/vync.js" <subcommand> [args]
```

### Sub-agent delegation (context window 보호)
- `create <description>` — 맥락 분석 → 시각화 판단 → .vync 생성 + 서버 열기
- `read [file]` — diff 실행 → 의미적 번역
- `update <instruction>` — diff 확인 → 맥락+지시 기반 .vync 수정 + 서버 열기

For these, use the Agent tool with `subagent_type: "vync:vync-translator"`.

## Sub-agent 호출 절차

### 파일경로 해결 (메인 세션 책임 — sub-agent 호출 전에 반드시 수행)

1. 사용자가 파일명 지정 → 절대경로로 변환 (bare name → `CWD/.vync/<name>.vync`)
2. CWD/.vync/에 .vync 파일이 하나만 있음 → 그 파일 사용
3. 여러 .vync 파일 있음 → 사용자에게 확인
4. .vync 파일 없음 (create 시) → `vync init <filename>` 먼저 실행
5. **항상 절대경로**로 sub-agent에 전달

### Create

1. 파일경로 해결 (없으면 `vync init` 먼저)
2. 대화 맥락 요약 (2-5문장)
3. Agent tool 호출:

```
Agent({
  description: "Vync create visualization",
  subagent_type: "vync:vync-translator",
  mode: "bypassPermissions",
  prompt: "## 작업: Create\n파일: <absolute_path>\n\n## 대화 맥락\n<메인 세션이 요약한 현재 논의 상황, 2-5문장>\n\n## 지시\n<구체적 지시 or '맥락에 맞게 판단해서 시각화해줘'>\n<선호하는 유형이 있으면: 'mindmap 형식으로' 등>"
})
```

4. Sub-agent의 시각화 요약을 사용자에게 전달

### Read

1. 파일경로 해결
2. `vync diff <file>` 실행 (Bash) → 프로그래밍적 diff 결과 획득
3. 대화 맥락 요약 (2-5문장)
4. Agent tool 호출:

```
Agent({
  description: "Vync read + translate diff",
  subagent_type: "vync:vync-translator",
  mode: "bypassPermissions",
  prompt: "## 작업: Read\n파일: <absolute_path>\n\n## 대화 맥락\n<현재 논의 상황>\n\n## 유저 피드백 (diff)\n<diff 결과>\n\n## 지시\n위 변경사항을 대화 맥락에 비춰 의미적으로 번역해줘."
})
```

5. Sub-agent의 구조화된 반환을 활용:
   - **확신 높음**: 의도를 대화에 자연스럽게 반영 + 제안 전달
     예: "기획의 세부 활동으로 리서치를 보시는 것 같은데, 개발 쪽도 정리할까요?"
   - **확신 중간**: 추론 언급 + 확인 포함
     예: "A-B, C-D로 묶으셨네요. 이 구분으로 진행할까요?"
   - **확신 낮음**: 요약(사실)만 간략히 언급, 의도 추론은 하지 않음
     예: "구조에 약간 변화가 있네요."

### Update

1. 파일경로 해결
2. `vync diff <file>` 실행 (유저 수정이 있었을 수 있으므로)
3. 대화 맥락 + diff + 지시 정리
4. Agent tool 호출:

```
Agent({
  description: "Vync update visualization",
  subagent_type: "vync:vync-translator",
  mode: "bypassPermissions",
  prompt: "## 작업: Update\n파일: <absolute_path>\n\n## 대화 맥락\n<현재 논의 상황>\n\n## 유저 피드백 (diff)\n<diff 결과 or '없음'>\n\n## 지시\n<구체적 수정 지시>"
})
```

5. Sub-agent의 변경 요약을 사용자에게 전달
