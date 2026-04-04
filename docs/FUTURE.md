# Vync — 기능 아이디어 카탈로그

> "무엇을 만들 수 있을까" — 향후 개발 가능한 기능의 동기, 가치, 규모를 정리한다.
> 착수가 결정되면 `docs/plans/`에 설계 문서를 생성하고, 완료 시 `docs/archive/`로 이동한다.

## 상태 정의

| 상태 | 의미 |
|------|------|
| 💡 idea | 아이디어 단계. 동기와 개요만 정리됨 |
| 🔍 evaluating | 타당성 검토 중. plans/ 문서 또는 PoC 진행 중 |
| 📋 planned | 착수 결정. plans/ 설계 문서 확정, 구현 대기 |
| ✅ done | 구현 완료. plans/ → archive/ 이동됨 |

## 규모 기준

| 규모 | 기준 |
|------|------|
| S | 단일 파일 수정, 1시간 이내 |
| M | 2~5개 파일, 반나절 |
| L | 새 모듈/패키지, 1~2일 |
| XL | 아키텍처 변경, 3일 이상 |

---

## 요약

| ID | 기능 | 상태 | 규모 | 관련 |
|----|------|------|------|------|
| F-001 | [MCP 서버](#f-001) | 📋 planned | L | D-010 |
| F-002 | [AI Agent 파이프라인](#f-002) | 💡 idea | XL | — |
| F-003 | [Markdown/Mermaid 변환](#f-003) | 💡 idea | M | D-003, F-001 |
| F-004 | [충돌 해결 고도화](#f-004) | 💡 idea | L~XL | D-008 |
| F-005 | [파일 메타데이터 v2](#f-005) | 💡 idea | M | D-005 |
| F-006 | [.vync Document Package](#f-006) | 🔍 evaluating | XL | D-005 |
| F-007 | [파일 연결 UX](#f-007) | 💡 idea | S~M | D-012 |
| F-008 | [Graph View / 온톨로지 편집기](#f-008) | ✅ done | L | D-019 |
| F-009 | [자동 업데이트 + npm 배포](#f-009) | 💡 idea | M | D-012 |
| F-010 | [파일 간 링크 + 대시보드](#f-010) | 💡 idea | L | D-014 |
| F-011 | [보안 고도화](#f-011) | 💡 idea | M | — |
| F-012 | [vync watch 데몬](#f-012) | 💡 idea | M | — |
| F-013 | [역변환 (PlaitElement → MD/Mermaid)](#f-013) | 💡 idea | L | D-003 |
| F-014 | [토큰 최적화](#f-014) | 🔍 evaluating | M | D-013, D-016 |

---

## 상세

### F-001

**MCP 서버**

**상태**: 📋 planned · **규모**: L · **관련**: D-010
**의존**: 없음 (현재 아키텍처로 바로 착수 가능)

**동기**: 현재 AI 편집은 prose 프로토콜(vync-translator sub-agent)을 통해 이루어짐. MCP는 구조화된 도구를 Claude Code에 직접 제공하여, prose 해석의 모호성을 제거하고 피드백 루프를 정밀하게 만든다.

**개요**: `.vync` 파일을 읽고 쓰는 MCP 서버. 독립 프로세스(stdio transport)로 동작하며, 요소 단위 CRUD + 장면 설명 + 변경 감지를 도구로 제공. 참고: mcp_excalidraw (26개 Tool, 피드백 루프 패턴).

**가치**:
- AI 편집 정확도 향상 (구조화된 입출력 → prose 해석 오류 제거)
- 피드백 루프 강화 (`describe_scene`으로 현재 상태 인식)
- 기존 prose 프로토콜의 근본적 한계 해결 (I-001, I-005의 구조적 원인)

**기술 방향**:
- 패키지: `packages/mcp-server` (모노레포 추가)
- 기술: `@modelcontextprotocol/sdk` (Node.js, stdio transport)
- Tier 1 (핵심): read/write file, describe scene/changes, add/update/delete element
- Tier 2 (변환): from markdown, from mermaid
- Tier 3 (AI 강화): generate, edit, screenshot, snapshot

**비고**: 2026년 내 착수 목표. translator prose 프로토콜의 한계가 명확해진 시점에 우선순위 상승.

---

### F-002

**AI Agent 파이프라인**

**상태**: 💡 idea · **규모**: XL · **관련**: —
**의존**: F-001 (MCP 서버 위에 구축하는 것이 자연스러움)

**동기**: 자연어 명령 하나로 적절한 시각화 유형을 자동 선택하고 생성하는 흐름. 현재는 사용자가 시각화 유형을 직접 지정해야 함.

**개요**: Intent Router가 자연어를 분류(`@mindmap`, `@flow`, `@canvas`, `@edit`)하고, 유형별 Agent가 중간 형식(Markdown, Mermaid 등)을 거쳐 PlaitElement[]를 생성. DeepDiagram 패턴 참고 (AGPL-3.0이므로 클린룸 재구현 필수, 코드 0줄).

**가치**: 사용자가 "이 프로세스를 시각화해줘"만 말하면 적절한 다이어그램이 생성됨.

**비고**: F-001(MCP) 완료 후 재평가. 규모가 크므로 단계적 접근 필요.

---

### F-003

**Markdown/Mermaid 변환**

**상태**: 💡 idea · **규모**: M · **관련**: D-003, F-001
**의존**: F-001 (MCP Tier 2 도구로 제공 가능)

**동기**: AI가 JSON 직접 편집 대신 익숙한 형식(Markdown, Mermaid)을 거쳐 다이어그램을 생성할 수 있으면 진입 장벽이 낮아짐. D-003에서 MVP 제외했으나, MCP 도구로 자연스럽게 제공 가능.

**개요**: `vync convert plan.md` CLI 또는 MCP `vync_from_markdown`/`vync_from_mermaid` 도구. Drawnix에 이미 변환기(md-to-board, mmd-to-board)가 존재하므로 래핑 수준.

**가치**: AI 편집의 대안 경로 확보 (JSON 직접 편집이 어려운 복잡한 구조에 유용).

---

### F-004

**충돌 해결 고도화**

**상태**: 💡 idea · **규모**: L~XL · **관련**: D-008
**의존**: 없음

**동기**: D-008(Last Write Wins)는 단일 사용자 시나리오에서는 충분하나, 웹과 CLI에서 동시 편집 시 한쪽 변경이 무조건 덮어씌워짐. 실사용에서 데이터 손실 위험.

**개요**: 단계적 고도화 — (1) 비충돌 요소 자동 머지, (2) 변경 알림 다이얼로그, (3) 3-way merge, (4) CRDT 기반 실시간 협업.

**가치**: 동시 편집 시 데이터 손실 방지. 장기적으로 다중 사용자 협업 가능.

**비고**: (1)~(2)는 M 규모, (3)~(4)는 XL. 실사용 중 충돌 빈도를 관찰 후 우선순위 결정.

---

### F-005

**파일 메타데이터 v2**

**상태**: 💡 idea · **규모**: M · **관련**: D-005
**의존**: 없음

**동기**: 새 세션에서 "이 파일이 언제, 어디서 마지막으로 수정되었는지" 알 수 없음. 서버 없이도, 다른 머신에서도 파일 자체에서 확인 가능하면 유용.

**개요**: `.vync` 포맷을 `version: 2`로 확장. `lastModified`, `lastModifiedBy` ("web" | "claude" | "external") 필드 추가. 기존 v1 파일은 하위 호환.

**가치**: 파일 자기 기술(self-describing) 강화. 세션 간 변경 추적의 기반.

**비고**: 7-P1(snapshot 기반 diff read)과 보완적. 마이그레이션 스크립트 필요.

---

### F-006

**.vync Document Package**

**상태**: 🔍 evaluating · **규모**: XL · **관련**: D-005
**의존**: 없음 (그러나 **breaking change** — 전체 파이프라인 수정)
**설계**: [`plans/2026-03-12-vync-document-package.md`](./plans/2026-03-12-vync-document-package.md)

**동기**: 현재 단일 JSON 파일 구조는 다중 캔버스를 하나의 프로젝트로 묶을 수 없음. macOS Document Package(`.pages`, `.key`와 동일 패턴)로 전환하면 Finder에서 단일 "파일"로 보이면서 내부에 여러 캔버스를 포함.

**개요**: `project.vync/` 디렉토리 번들. manifest.json + 개별 캔버스 JSON. `LSTypeIsPackage: true` UTI 선언.

**가치**: 다중 캔버스의 자연스러운 그룹핑. Finder UX 개선.

**비고**: 기존 단일 파일 워크플로우 전체가 깨지는 breaking change. Hub Server, FileRegistry, CLI, Electron, 프론트엔드, chokidar, sub-agent 모두 수정 필요. 신중한 평가 후 결정.

---

### F-007

**파일 연결 UX**

**상태**: 💡 idea · **규모**: S~M · **관련**: D-012
**의존**: 없음 (DMG 패키징 + UTI 등록 이미 완료)

**동기**: DMG 설치 시 파일 연결은 자동 등록되지만, 사용자가 "기본 앱으로 설정"을 모를 수 있음. 또한 .vync 파일에 전용 아이콘이 없어 시각적 구분 불가.

**개요**:
- P2: 첫 실행 안내 다이얼로그 ("Finder에서 우클릭 > 이 앱으로 열기 > 항상")
- P3: .vync 전용 파일 아이콘 (`.icns` / `.ico` 커스텀 디자인)

**가치**: 데스크톱 앱으로서의 완성도.

---

### F-008

**Graph View / 온톨로지 편집기**

**상태**: ✅ done · **규모**: L · **관련**: D-019
**의존**: 없음 (기존 캔버스와 독립)
**설계**: [`archive/2026-03-14-graph-view-proposal.md`](./archive/2026-03-14-graph-view-proposal.md)
**PoC**: [`archive/2026-03-14-graph-view-poc.md`](./archive/2026-03-14-graph-view-poc.md)
**구현**: [`archive/2026-03-16-graph-view-implementation.md`](./archive/2026-03-16-graph-view-implementation.md)

**동기**: 마인드맵/플로우차트는 위계적 구조에 강하지만, 개념 간 다대다 관계(온톨로지)를 표현하기 어려움. 지식 그래프 형태의 편집 뷰가 있으면 "생각이 보이는 대화"의 표현 범위가 넓어짐.

**개요**: 개념(Entity)을 노드, 관계(Relationship)를 엣지로 시각화하는 독립 페이지. React Flow v12 + ELK.js 기반. 10~100 노드 규모. `.vync` 확장자 유지 + `type` 필드 분기.

**가치**: 온톨로지/지식 구조 탐색. 기존 마인드맵/드로잉과 다른 사고 모델 지원.

---

### F-009

**자동 업데이트 + npm 배포**

**상태**: 💡 idea · **규모**: M · **관련**: D-012
**의존**: 없음

**동기**: 현재 업데이트는 수동(`git pull + npm install`). 데스크톱 앱 사용자에게는 자동 업데이트가, CLI 사용자에게는 `npx vync`가 자연스러움.

**개요**: Electron `autoUpdater` + GitHub Releases. npm에 `vync` 패키지 발행하여 `npx vync init`/`npx vync open` 가능.

**가치**: 사용자 접근성 대폭 향상. 설치 장벽 제거.

---

### F-010

**파일 간 링크 + 대시보드**

**상태**: 💡 idea · **규모**: L · **관련**: D-014
**의존**: Phase 9 (멀티 탭 UI) 완료 ✅

**동기**: 현재 각 `.vync` 파일은 독립적. 프로젝트 수준에서 파일 간 관계를 시각화하거나, 전체 파일 목록을 조감하는 뷰가 없음.

**개요**: 파일 간 하이퍼링크 + 프로젝트 대시보드 (파일 목록, 최근 수정, 미리보기).

**가치**: 다중 파일 워크플로우의 탐색성과 조직화.

---

### F-011

**보안 고도화**

**상태**: 💡 idea · **규모**: M · **관련**: —
**의존**: 없음 (기본 보안 Phase 8에서 구현 완료)

**동기**: 기본 보안(validateFilePath, Host/Origin 검증)은 구현되었으나, 디렉토리 접근 제한 고도화, 인증/인가 등 추가 강화 여지.

**개요**: 디렉토리 스코프 제한 강화, 선택적 토큰 인증, rate limiting.

**가치**: 네트워크 환경에서의 안전한 사용.

---

### F-012

**vync watch 데몬**

**상태**: 💡 idea · **규모**: M · **관련**: —
**의존**: 없음

**동기**: UI 없이 파일 변경을 감시하면서 자동 변환 파이프라인(예: `.md` → `.vync`)을 실행하는 백그라운드 서비스.

**개요**: `vync watch <dir>` — 지정 디렉토리의 파일 변경 감지 + 규칙 기반 자동 처리.

**가치**: CI/CD 파이프라인이나 자동화 워크플로우에 통합 가능.

---

### F-013

**역변환 (PlaitElement → Markdown/Mermaid)**

**상태**: 💡 idea · **규모**: L · **관련**: D-003
**의존**: 없음

**동기**: `.vync` 캔버스를 텍스트 형식으로 내보내면, 다른 도구에서 활용하거나 문서에 임베드 가능.

**개요**: PlaitElement[] → Markdown(마인드맵), PlaitElement[] → Mermaid(플로우차트) 변환기. ArrowLine 바인딩 등 복잡한 구조의 역변환은 기술적 난이도 높음.

**가치**: 데이터 이식성. lock-in 방지.

---

### F-014

**토큰 최적화**

**상태**: 🔍 evaluating · **규모**: M · **관련**: D-013, D-016
**의존**: 없음
**분석**: [`plans/2026-03-13-token-optimization.md`](./plans/2026-03-13-token-optimization.md)

**동기**: 현재 plugin 파이프라인이 세션당 ~4,400 토큰을 소비. 비용 절감 + 컨텍스트 윈도우 효율 + 응답 정확도를 동시에 개선할 여지.

**개요**: 분석 완료 — hooks.json 경량화, vync.md 조건부 로딩, translator prompt 압축 등 3~5개 최적화 기회 식별됨. 구현 우선순위 미결정.

**가치**: 비용 절감 + AI 응답 품질 간접 향상 (컨텍스트 윈도우 여유 확보).
