# Vync — 세션 컨텍스트 보존 문서

> 기획 세션(2026-03-07)에서 논의된 핵심 맥락과 사고 과정을 보존한다.
> 후속 세션에서 이 문서를 읽으면 설계 의도를 완전히 복원할 수 있어야 한다.

---

## 1. 프로젝트의 근본 동기

**문제**: AI(Claude Code 등)와 인간이 대화하면서 계획을 수립할 때, 텍스트만으로는 복잡한 구조를 이해하기 어렵다.

**해결**: 로컬 파일을 Single Source of Truth로 하여, 웹 UI의 시각적 편집과 외부 프로세스(AI/에디터)의 파일 수정이 양방향으로 실시간 동기화되는 도구를 만든다.

**핵심 가치**: "같은 파일을 바라보며 이해도를 맞추는 워크플로우"

---

## 2. 핵심 사용 시나리오 (우선순위순)

1. **Claude Code와 협업 계획 수립** — AI가 .vync JSON을 생성/수정하면 웹 UI에 마인드맵/플로우차트가 실시간 반영
2. **시각적 미세 조정** — AI가 만든 구조를 사용자가 웹 UI에서 노드 이동, 수정, 삭제
3. **기존 시각화를 AI에게 공유** — 사용자가 웹에서 만든 것을 Claude Code가 .vync 파일을 읽어 이해
4. **혼자 시각적 정리** — Claude 없이 순수 화이트보드로 사용

---

## 3. 설계 결정의 사고 과정

### 3.1 "왜 Drawnix 포크인가"

세 가지 옵션을 분석했다:

- **포크+수정**: 기존 UI 100% 재사용, 저장 메커니즘만 교체. 가장 빠른 시작.
- **Plait 직접 사용**: 완전한 제어권이지만 UI를 처음부터 만들어야 함. 개발 시간 2~3배.
- **Drawnix 임베드**: 결합도는 낮지만 Drawnix가 외부 데이터 주입 API를 제공하는지 불확실.

MVP 목표에서 속도와 완성도의 균형점은 **포크+수정**이었다. 장기적으로 Drawnix가 요구에 맞지 않으면 Plait 직접 사용으로 전환할 수 있다 (Fallback 경로).

### 3.2 "왜 JSON 직접 편집인가 (Markdown/Mermaid 변환 제외)"

세 가지 AI 편집 경로를 분석했다:

- **소스 파일 기반** (.md → 자동 변환 → .vync): AI에게 쉽지만, 웹 UI 편집을 소스에 역변환하는 것이 기술적으로 매우 어려움. 양방향 호환 불가.
- **JSON 직접 편집**: 단일 포맷으로 양방향 완전 호환. 다만 PlaitElement[] 구조가 복잡.
- **하이브리드**: 두 모드를 관리해야 하는 복잡성.

**결정적 요인**: "양방향 완전 호환"이 프로젝트의 핵심 가치(같은 파일을 바라보며 동기화)와 가장 부합. PlaitElement[] 복잡성은 CLAUDE.md + JSON Schema + 예시로 완화.

### 3.3 "왜 CLI 중심인가"

사용 시나리오에서 사용자는 **이미 터미널에서 Claude Code와 작업 중**이다. 따라서:
- 파일 관리를 위해 웹 UI에 별도 기능을 만드는 것은 과도
- `vync open plan.vync` 한 줄이면 충분
- 웹 UI는 순수 캔버스 에디터로서 복잡도를 최소화

### 3.4 "왜 조용히 자동 반영인가"

세 가지 알림 방식을 분석했다:
- **토스트+자동 반영**: 정보성이지만, AI가 빈번히 수정하면 토스트가 스팸처럼 됨
- **조용히 자동**: Google Docs처럼 자연스러운 경험. AI 수정이 "그냥 나타나는" 느낌
- **확인 팝업**: 작업 흐름을 방해. AI 협업에서는 최악의 UX

**조용히 자동**을 선택했지만, 사용자가 편집 중일 때 외부 변경이 덮어쓰는 문제는 인지하고 있다. 이건 구현 시 "편집 중인 요소와 외부 변경 요소가 겹치는지"를 판단하여 후속 개선 가능.

### 3.5 "왜 래핑된 JSON인가"

- **네이키드 PlaitElement[]**: Drawnix 내부 포맷과 동일하여 호환성 높지만, 버전/뷰포트 메타데이터를 넣을 곳이 없음
- **래핑 `{ version, viewport, elements }`**: 약간의 오버헤드로 확장성 확보. AI는 `elements` 필드만 편집하면 됨

---

## 4. 아키텍처 다이어그램

```
┌──────────────┐                    ┌──────────────────┐                    ┌──────────────┐
│  Claude Code  │                    │  .vync JSON 파일  │                    │  웹 브라우저    │
│  (JSON 편집)   │ ── Write/Edit ──→ │  (Source of Truth) │ ── chokidar ──→   │  Vync UI      │
│              │                    │                    │                    │  (캔버스 편집)  │
│              │ ←── Read ──────── │                    │ ←── auto-save ── │              │
└──────────────┘                    └──────────────────┘                    └──────────────┘
                                           ↕ WebSocket
                                    ┌──────────────────┐
                                    │  Next.js Custom   │
                                    │  Server (:3000)   │
                                    │  HTTP + WS +      │
                                    │  chokidar         │
                                    └──────────────────┘
```

**데이터 흐름**:

```
[외부 편집 → 웹 UI]
  외부에서 .vync 파일 수정
  → chokidar 감지
  → content hash 비교 (에코 방지)
  → 실제 변경이면 WebSocket으로 전송
  → 프론트엔드가 PlaitElement[] 교체
  → 캔버스 자동 업데이트 (조용히)

[웹 UI → 파일]
  캔버스에서 노드 편집
  → Plait onChange 이벤트
  → 디바운싱 (300~500ms)
  → WebSocket 또는 API로 서버에 전송
  → 서버가 원자적 쓰기 (tmp + rename)
  → content hash 업데이트 (에코 방지)
```

---

## 5. 파일 구조 (예상)

```
Vync/                              # Drawnix 포크
├── docs/
│   ├── PLAN.md                    # 원본 기획서
│   ├── DECISIONS.md               # 설계 결정서 (이 세션의 결과)
│   └── SESSION_CONTEXT.md         # 세션 컨텍스트 보존 (이 문서)
├── examples/
│   ├── mindmap.vync               # 마인드맵 예시 파일
│   └── flowchart.vync             # 플로우차트 예시 파일
├── bin/
│   └── vync.js                    # CLI 진입점 (vync init, vync open)
├── src/
│   ├── server/
│   │   ├── custom-server.ts       # Next.js Custom Server (HTTP + WS)
│   │   ├── file-watcher.ts        # chokidar 파일 감시
│   │   ├── sync-service.ts        # 동기화 로직 (에코 방지, 원자적 쓰기)
│   │   └── ws-handler.ts          # WebSocket 메시지 핸들러
│   └── ... (기존 Drawnix 소스)
├── .vync.schema.json              # JSON Schema
├── CLAUDE.md                      # AI 편집 가이드
├── pnpm-workspace.yaml
└── package.json
```

---

## 6. 핵심 기술 과제 상세

### 6.1 에코 방지 메커니즘

```
웹 편집 → 파일 저장 → chokidar 감지 → 다시 웹으로 → 무한 루프
```

**선택한 방법**: content hash 비교
- 서버가 파일을 쓸 때마다 해당 내용의 SHA-256 해시를 메모리에 저장
- chokidar가 변경을 감지하면, 새 파일 내용의 해시를 계산
- 저장된 해시와 동일하면 → 자체 쓰기이므로 무시
- 다르면 → 외부 변경이므로 WebSocket으로 전파

### 6.2 원자적 파일 쓰기

```javascript
// 반쯤 쓰인 파일을 읽는 것을 방지
writeFileSync(tmpPath, content);  // 임시 파일에 쓰기
renameSync(tmpPath, targetPath);  // 원자적 교체
```

### 6.3 디바운싱

- **웹 → 파일**: onChange 이벤트를 300~500ms 디바운싱
- **파일 → 웹**: chokidar 이벤트를 300ms 디바운싱 (에디터가 여러 번 저장할 수 있으므로)

### 6.4 JSON 유효성 검증

- 파일 읽기 시 JSON.parse 실패하면 이전 유효한 상태를 유지
- 에러 로그를 서버 콘솔에 출력 (웹 UI에는 표시하지 않음)

---

## 7. PlaitElement[] 구조 (Phase 1에서 상세화 필요)

Phase 1에서 Drawnix를 실행하고 실제 데이터를 분석해야 한다. 현재까지 알려진 정보:

- **마인드맵**: `@plait/mind` — 계층적 노드 구조, 자동 레이아웃
- **플로우차트/도형**: `@plait/draw` — 노드 + 연결선, 수동 좌표 배치
- **변환 도구**: `markdown-to-drawnix`, `mermaid-to-drawnix` — 이들의 출력 구조가 PlaitElement[]의 실제 형태를 이해하는 열쇠

**Phase 1 핵심 작업**:
1. Drawnix에서 마인드맵을 만들고 localStorage/IndexedDB에서 JSON 추출
2. 플로우차트도 동일하게 JSON 추출
3. 두 JSON의 구조를 비교 분석
4. markdown-to-drawnix CLI로 변환 결과 확인
5. AI가 편집하기 쉬운 필드 vs 어려운 필드 분류
6. 결과를 .vync.schema.json과 CLAUDE.md에 반영

---

## 8. 성공 기준 (MVP)

- [ ] `vync init plan.vync` 로 빈 캔버스 파일 생성됨
- [ ] `vync open plan.vync` 로 서버 시작 + 브라우저에서 캔버스 렌더링됨
- [ ] 웹 UI에서 노드 추가/이동/삭제 → .vync 파일이 자동 저장됨
- [ ] 외부에서(vim, Claude Code 등) .vync 파일 수정 → 웹 UI가 자동 갱신됨 (조용히)
- [ ] Claude Code가 CLAUDE.md를 읽고 .vync JSON을 올바르게 편집할 수 있음
- [ ] 전체 루프(외부 편집 → 웹 반영, 웹 편집 → 파일 저장)가 3초 이내
- [ ] JSON 파싱 실패 시 이전 상태 유지 (크래시 없음)
- [ ] 에코 루프 없이 안정적으로 동작

---

## 9. 미결 질문 (구현 시 결정)

1. **WebSocket 메시지 포맷**: 전체 파일 내용 전송 vs diff/patch 전송?
   → MVP에서는 전체 파일 전송이 단순. 파일 크기가 문제될 때 최적화.

2. **Drawnix의 저장 메커니즘 구조**: localStorage 기반 코드가 어디에 있고, 어떻게 교체 가능한지?
   → Phase 1에서 코드 분석 필요.

3. **Plait board 업데이트 API**: 외부에서 데이터를 주입하여 캔버스를 업데이트하는 API가 존재하는지?
   → Phase 1에서 Plait 문서/코드 분석 필요.

4. **Custom Server에서 Next.js 개발 모드와 프로덕션 모드 처리**: HMR과 WebSocket이 충돌하지 않는지?
   → Phase 2에서 구현 시 확인.

5. **ID 생성 규칙**: PlaitElement의 id 필드는 어떤 포맷? UUID? nanoid? 숫자?
   → Phase 1에서 Drawnix 코드 분석으로 확인.
