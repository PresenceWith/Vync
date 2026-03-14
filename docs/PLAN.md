# Vync — 구현 계획

> Phase별 작업 목록과 완료 기준. 현재 진행 상태를 추적한다.
> 설계 근거는 [DECISIONS.md](./DECISIONS.md), 시스템 구조는 [ARCHITECTURE.md](./ARCHITECTURE.md) 참조.

---

## 현재 상태

**Phase**: Post-MVP 안정화 — 2026-03-14
- Phase 1~9 (MVP): 완료 (2026-03-07 ~ 2026-03-09)
- Diff Pipeline (D-015/D-016): 완료 (2026-03-11)
- Server Lifecycle Fix (PR #10): 완료 (2026-03-11)
- macOS 코드 서명 + 공증: 완료 (2026-03-11)
- Tab Bar "+" 버튼 수정 (PR #11): 완료 (2026-03-12, develop 병합)
- Semantic Sync (D-017/D-018): 완료 (PR #14, 2026-03-13, develop 병합)
- Plugin Path Fix (PR #15): 완료 ($VYNC_HOME 기반 경로, 2026-03-13, develop 병합)
- Asar Unpacked Path Fix: 완료 (정적 파일 경로 수정, `fcba037`)
- Fix: Electron/Web Sync + Duplicate Browser Opening: 완료 (2026-03-14, develop)
  - PUT /api/sync 후 WebSocket 브로드캐스트 추가 (I-002)
  - Electron 모드에서 `vync open` 시 브라우저 중복 열기 방지 (I-003)
  - probePort() mode 보존 (I-004)
  - 95개 테스트 PASS (신규 2개)
- **develop → main 병합 필요** (develop가 main 대비 20+ 커밋 ahead)

---

## 완료된 Phase 요약

> 상세 체크박스 목록은 [completed-phases.md](./archive/completed-phases.md) 참조.

| Phase | 이름 | 완료일 | PR/커밋 | 완료 기준 요약 |
|-------|------|--------|---------|---------------|
| 1 | Drawnix 포크 + 데이터 모델 파악 | 2026-03-07 | — | Drawnix 실행, PlaitElement[] 문서화, AI 편집 난이도 평가 |
| 2 | 파일 동기화 레이어 | 2026-03-07 | — | Custom Server :3100, WS 알림, board 갱신 |
| 3 | 양방향 동기화 완성 | 2026-03-07 | — | 웹↔파일 양방향, 에코 루프 0, JSON 실패 안전 |
| 4 | CLI + Claude Code 플러그인 | 2026-03-07 | — | vync init/open, Skill 가이드, PostToolUse 자동 검증 |
| 5 | E2E 검증 (MVP) | 2026-03-07 | — | 전체 루프 ~0.6초, 에코 0회, JSON 실패 안전 |
| 6 | Electron 데스크톱 앱 | 2026-03-08 | — | Electron thin shell, vync open spawn, DMG |
| 7 | Sub-agent 번역 레이어 | 2026-03-09 | — | vync-translator, context window 보호, 7-P1 diff-aware read |
| 8 | 멀티 파일 Hub Server | 2026-03-09 | PR #6 | 다중 파일 동시 관리, FileRegistry, file-scoped WS |
| 9 | 멀티 탭 UI | 2026-03-09 | PR #7 | 탭 바, Hub WS, 실시간 탭 동기화 |
| — | Diff Pipeline (D-015/D-016) | 2026-03-11 | PR #9 | 구조적 diff 엔진, Sub-agent 시각화 전문가 |
| — | Server Lifecycle Fix | 2026-03-11 | PR #10 | EADDRINUSE recovery, 포트 프로브 |
| — | macOS 코드 서명 + 공증 | 2026-03-11 | `588fd97` | Gatekeeper 통과, Notarized Developer ID |
| — | Tab Bar + 버튼 수정 | 2026-03-12 | PR #11 | CSS 클리핑 수정, discover 엔드포인트 |
| — | Semantic Sync (D-017/D-018) | 2026-03-13 | PR #14 | semantic hints, 4-필드 구조화 반환 |
| — | Plugin Path Fix | 2026-03-13 | PR #15 | $VYNC_HOME 기반 경로 |
| — | Asar Unpacked Path Fix | 2026-03-13 | `fcba037` | 정적 파일 경로 수정 |
| — | Electron/Web Sync Fix | 2026-03-14 | PR #16 | PUT 브로드캐스트, 중복 브라우저 방지 |

---

## 리스크

| 리스크 | 영향 | 완화 방안 | 평가 시점 |
|--------|------|----------|----------|
| Drawnix가 초기 프로젝트라 API 불안정 | 높음 | Plait 직접 사용으로 Fallback | Phase 1 |
| PlaitElement[] JSON이 AI 편집에 복잡 | **평가 완료** | 마인드맵/도형은 용이, ArrowLine 바인딩은 어려움. CLAUDE.md + Schema로 충분히 완화 가능 → D-003 유지 (ARCHITECTURE.md §7) | Phase 1 |
| 양방향 동기화 시 데이터 손실 | **해소** | 원자적 쓰기(tmp+rename) + SHA-256 content hash + isWriting 플래그 + JSON 유효성 검증 + lastValidContent fallback 구현 완료 | Phase 3 |
| Custom Server에서 HMR과 WS 충돌 | **해소** | Vite HMR은 내부 WS 사용, 동기화 WS는 독립 경로 /ws — 충돌 없음 | Phase 1에서 확인 |
| 대용량 .vync 파일에서 SHA-256 해싱 지연 | 낮음 | 일반 사용 시 파일 크기 소규모 예상. 병목 시 incremental hash 검토 | Phase 3 (구현 완료, 성능 문제 미발견) |
| AI가 잘못된 PlaitElement JSON 생성 | **검증 완료** | JSON Schema 검증 + Skill 예시로 충분히 완화. Phase 5 E2E에서 Claude Code의 shape 변경/요소 추가 정상 반영 확인 → D-003 유지 | Phase 4 (Phase 5에서 검증) |
| chokidar가 빠른 연속 변경 시 이벤트 누락 | 낮음 | 디바운싱으로 완화. 누락 시 polling fallback 검토 | Phase 3 (awaitWriteFinish 300ms 설정 완료) |
| Agent tool 커스텀 에이전트 미작동 | **해소** | Spike 검증 완료: 커스텀 에이전트 인식(V1), Skill 자동 로드(V3), Prose 반환(V5) 모두 PASS. PostToolUse hook은 sub-agent에서 미발동(V4) → 명시적 validate.js 호출로 해결 | Phase 7 Spike (2026-03-09) |

---

## 미결 질문 (구현 시 결정)

| ID | 질문 | 비고 | 결정 시점 |
|----|------|------|----------|
| Q-001 | Drawnix 포크 세부 전략 (전체 복사 vs submodule) | **해결**: 전체 복사 전략 채택. upstream remote으로 cherry-pick 가능 | Phase 1.1 |
| Q-002 | WebSocket 메시지 포맷 (전체 파일 vs diff) | **해결**: 전체 파일 전송 채택. `{ type: 'file-changed', data: VyncFile }` 포맷. 파일 크기가 소규모이므로 diff 불필요 | Phase 2.4 |
| Q-003 | Plait board 업데이트 API 존재 여부 | **해결**: `<Wrapper>` value prop 변경 시 자동 갱신 + NodeTransforms API 존재 | Phase 1.4 |
| Q-004 | Custom Server에서 HMR + WS 공존 방법 | **해결**: Vite HMR은 내부 WS 사용, 동기화 WS는 독립 `ws` 라이브러리로 /ws 경로에 마운트. 서로 독립적이라 충돌 없음 | Phase 2.1 |
| Q-005 | PlaitElement의 ID 생성 규칙 (UUID? nanoid?) | **해결**: `idCreator(5)` — 커스텀 5자 랜덤 문자열 (ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz) | Phase 1.2 |
