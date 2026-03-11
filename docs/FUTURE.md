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
| `vync_describe_changes` | 마지막 읽기 이후 변경사항을 prose로 설명 (웹→Claude 인식 핵심) |
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
**구조 변경**: 이미 모노레포 구조 (apps/web + packages/shared). MCP 서버 패키지 추가 필요 (packages/mcp-server)

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
| MindmapAgent | LLM → Markdown → md-to-board converter | MindElement[] |
| FlowAgent | LLM → Mermaid → mmd-to-board converter | DrawElement[] + ConnectorElement[] |
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

### 4-1. 파일 메타데이터 확장 (P2)

.vync 파일 포맷을 `version: 2`로 확장하여 변경 추적 메타데이터를 내장. D-005 재검토 대상.

```json
{
  "version": 2,
  "lastModified": "2026-03-09T15:30:00Z",
  "lastModifiedBy": "web",
  "viewport": { ... },
  "elements": [ ... ]
}
```

**용도**: 새 세션에서도 "언제, 어디서 마지막으로 수정되었는지" 즉시 파악. 파일 자체에 정보가 내장되므로 서버 없이도, 다른 머신에서도 확인 가능.

**구현 시 고려사항**:
- `version: 1` → `version: 2` 마이그레이션 스크립트 필요
- `lastModifiedBy` 값: `"web"` | `"claude"` | `"external"` (vim 등)
- 서버 sync-service.ts와 프론트엔드 file-board.tsx의 쓰기 경로에 메타데이터 갱신 로직 추가
- 기존 `version: 1` 파일은 메타데이터 없이 정상 동작 (하위 호환)

**P1 (snapshot 기반 diff read)과의 관계**: P1은 외장 스냅샷(.lastread)으로 변경 감지, P2는 파일 내장 메타데이터. 상호 독립적이며 보완적. P1만으로 같은 세션/다음 세션 diff 가능, P2는 파일 자체의 자기 기술(self-describing) 강화.

---

## 5. 기타 확장

| 항목 | 설명 |
|------|------|
| 배포/패키징 | Electron DMG 패키징 구현 완료 (→ D-012). 추가: 코드 서명/공증, 자동 업데이트, `npx vync`/npm 발행 |
| 다중 파일 | **1단계 완료** (Phase 8, → D-014): Hub Server + 멀티 윈도우. **2단계 완료** (Phase 9): 멀티 탭 UI ([설계](../docs/archive/2026-03-09-multi-tab-ui-design.md)). 후속: 대시보드, 파일 간 링크 |
| 보안 | 기본 보안 구현 완료 (Phase 8): validateFilePath(allowlist + .vync + realpath) + Host 헤더 검증 + CORS + WS Origin 검증. 추가: 디렉토리 접근 제한 고도화 |
| `vync watch` | UI 없이 파일 감시 데몬 (자동 변환 파이프라인용) |
| 업스트림 (Drawnix) 추적 | 주기적 upstream diff, 핵심 변경 최소화 |
| 역변환 | PlaitElement[] → Markdown/Mermaid (기술적 난이도 높음) |
