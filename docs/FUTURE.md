# Vync — 후속 확장 로드맵

> MVP 이후 확장 사항을 정리한다. 우선순위는 MVP 완료 후 재평가.
> 4개 오픈소스 프로젝트 분석 결과(→ archive/RESEARCH-4-PROJECTS.md)에서 도출된 패턴을 포함.

---

## 1. MCP 서버 (→ D-010)

Claude Code에 구조화된 AI 조작 도구를 제공하는 MCP 서버. MVP에서 제외되었으나, AI 편집 경험을 크게 개선할 수 있음.

**참고 프로젝트**: mcp_excalidraw (26개 Tool, 피드백 루프 패턴)

### 핵심 도구 (Tier 1)

| Tool | 설명 |
|------|------|
| `vync_read_file` | 파일 전체 읽기 |
| `vync_write_file` | 파일 전체 쓰기 |
| `vync_describe_scene` | 장면을 텍스트로 설명 (피드백 루프 핵심) |
| `vync_add_element` | 요소 추가 |
| `vync_update_element` | 요소 수정 |
| `vync_delete_element` | 요소 삭제 |

### 변환 도구 (Tier 2)

| Tool | 설명 |
|------|------|
| `vync_from_markdown` | Markdown → 마인드맵 |
| `vync_from_mermaid` | Mermaid → 플로우차트 |

### AI 강화 (Tier 3)

| Tool | 설명 |
|------|------|
| `vync_generate` | 자연어 → 다이어그램 생성 |
| `vync_edit` | 자연어로 기존 다이어그램 수정 |
| `vync_get_screenshot` | 렌더링 스크린샷 |
| `vync_snapshot` / `vync_restore_snapshot` | 스냅샷 저장/복원 |

**아키텍처**: 독립 프로세스 (stdio transport), .vync 파일을 직접 읽고 쓴다.
**기술**: @modelcontextprotocol/sdk (Node.js)
**구조 변경**: 모노레포 전환 필요 (packages/web + packages/mcp-server + packages/shared)

---

## 2. AI Agent 파이프라인

**참고 프로젝트**: DeepDiagram (3단계 Intent Router + 다중 Agent)
**주의**: AGPL-3.0이므로 클린룸 재구현 필수. 패턴만 차용, 코드 0줄.

### Intent Router

자연어 명령을 적절한 Agent로 분류:
1. 명시적 접두사: `@mindmap`, `@flow`, `@canvas`, `@edit`
2. 키워드 휴리스틱: "구조"→mindmap, "프로세스"→flow
3. LLM 의도 분류 (Anthropic API + 컨텍스트)

### Agent별 역할

| Agent | 중간 형식 | 출력 |
|-------|---------|------|
| MindmapAgent | LLM → Markdown → md-to-drawnix | MindElement[] |
| FlowAgent | LLM → Mermaid → mmd-to-drawnix | DrawElement[] + ConnectorElement[] |
| CanvasAgent | LLM → PlaitElement[] 직접 생성 | PlaitElement[] |
| EditAgent | 현재 장면 + 명령 → JSON Patch | 수정된 PlaitElement[] |

**기술**: TypeScript 순수 async 함수 (LangGraph 없음), @anthropic-ai/sdk

---

## 3. Markdown/Mermaid 변환 파이프라인

D-003에서 MVP 제외. AI가 JSON 직접 편집이 너무 어렵다면 재검토.

**옵션**:
- `vync convert plan.md` CLI 명령어
- 서버 사이드 자동 변환 (`.md` 감지 시)
- MCP Tier 2 도구 (`vync_from_markdown`, `vync_from_mermaid`)

**전제**: Phase 1 평가 완료 — 마인드맵/도형은 AI 편집 용이, ArrowLine 바인딩은 어려움. D-003(JSON 직접 편집) 유지 결정. 변환 파이프라인은 MCP Tier 2 도구로 후속 제공 가능.

---

## 4. 충돌 해결 고도화

D-008에서 Last Write Wins로 결정. 후속 개선 옵션:

1. 편집 중인 요소와 외부 변경 요소가 겹치지 않으면 자동 머지
2. 외부 변경 알림 다이얼로그 (선택적)
3. 3-way merge (공통 조상 기준)
4. CRDT 기반 실시간 협업 (장기)

---

## 5. 기타 확장

| 항목 | 설명 |
|------|------|
| 배포/패키징 | Electron DMG 패키징 구현 완료 (→ D-012). 추가: 코드 서명/공증, 자동 업데이트, `npx vync`/npm 발행 |
| 다중 파일 | 다중 탭, 대시보드, 파일 간 링크 |
| 보안 | 디렉토리 접근 제한, WebSocket localhost 제한 |
| `vync watch` | UI 없이 파일 감시 데몬 (자동 변환 파이프라인용) |
| Drawnix 업스트림 추적 | 주기적 upstream diff, 핵심 변경 최소화 |
| 역변환 | PlaitElement[] → Markdown/Mermaid (기술적 난이도 높음) |
