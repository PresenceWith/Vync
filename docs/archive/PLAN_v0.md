# Vync — Visual Sync PoC

> 로컬 파일을 Single Source of Truth로 사용하여, 웹 UI에서의 시각적 편집과 외부 프로세스(AI/에디터 등)의 파일 수정이 양방향으로 실시간 동기화되는 시각적 계획 수립 도구

## 1. 프로젝트 개요

### 1.1 배경

AI(Claude Code 등)와 인간이 대화하면서 계획을 수립할 때, 텍스트만으로는 복잡한 구조를 이해하기 어렵다. 마인드맵, 플로우차트, 자유 캔버스 등 시각적 도구를 통해 **같은 파일을 바라보며** 이해도를 맞춰가는 워크플로우가 필요하다.

### 1.2 핵심 컨셉

```
┌──────────────┐                    ┌──────────────────┐                    ┌──────────────┐
│  Claude Code  │                    │  로컬 파일          │                    │  웹 브라우저    │
│  (파일 편집)    │ ── Write/Edit ──→ │  .vync JSON       │ ── chokidar ──→   │  Vync UI      │
│              │                    │  (Source of Truth) │                    │  (시각적 편집)  │
│              │ ←── Read ──────── │                    │ ←── auto-save ── │              │
└──────────────┘                    └──────────────────┘                    └──────────────┘
                                           ↕ WebSocket
                                    ┌──────────────────┐
                                    │  Node.js 미들웨어   │
                                    │  (파일 감시 + WS)   │
                                    └──────────────────┘
```

**핵심 원칙:**
- **파일 = Source of Truth** — 어떤 프로세스든 파일만 수정하면 반영됨
- **Claude Code 전용이 아님** — vim, VS Code, 스크립트 등 어떤 도구로든 파일 수정 시 반영
- **양방향 동기화** — 웹→파일(auto-save), 파일→웹(auto-reload)

### 1.3 지원할 시각화 유형

| 유형 | 용도 | AI 편집 경로 |
|------|------|-------------|
| 마인드맵 | 계층적 아이디어 정리, 브레인스토밍 | Markdown → markdown-to-drawnix |
| 플로우차트 | 프로세스 흐름, 의사결정 트리, 아키텍처 | Mermaid → mermaid-to-drawnix |
| 자유 캔버스 | 자유로운 노드 배치, 화이트보드 | PlaitElement[] JSON 직접 편집 |

---

## 2. 기술 스택 분석: Drawnix

### 2.1 Drawnix란

- **GitHub**: github.com/plait-board/drawnix
- **프레임워크**: Next.js + TypeScript (91.2%)
- **코어 엔진**: Plait 프레임워크 (Slate 영감의 드로잉 프레임워크)
- **스타일링**: Tailwind CSS
- **라이선스**: MIT

### 2.2 Plait 프레임워크 아키텍처

Plait은 Slate(리치 텍스트 에디터)에서 영감을 받은 드로잉 프레임워크:
- **코어**: 기본 화이트보드 (줌, 패닝)만 제공
- **플러그인 시스템**: 모든 비즈니스 기능은 플러그인으로 구현
  - `@plait/mind` — 마인드맵 (자동 레이아웃 알고리즘)
  - `@plait/draw` — 플로우차트, 기본 도형, 프리핸드
  - `@plait/flow` — 프로세스 상태 시각화

### 2.3 데이터 모델

- **핵심 구조**: `PlaitElement[]` — JSON 배열
- **변환 도구**:
  - `markdown-to-drawnix`: Markdown → PlaitElement[] (마인드맵)
  - `mermaid-to-drawnix`: Mermaid → PlaitElement[] (플로우차트)
- **local-first**: 현재 브라우저 캐시(localStorage/IndexedDB) 기반 저장

### 2.4 Drawnix 선택 이유

1. 마인드맵 + 플로우차트 + 자유 캔버스를 하나의 도구에서 통합 지원
2. Next.js 기반이므로 서버 사이드 파일 동기화 레이어 추가가 자연스러움
3. `markdown-to-drawnix`, `mermaid-to-drawnix`로 AI 편집 경로 확보
4. local-first 철학이 파일 기반 동기화와 부합
5. MIT 라이선스 오픈소스

---

## 3. 핵심 기술 과제

### 3.1 양방향 파일 동기화

**파일 → 웹 (외부 변경 감지)**
- chokidar로 파일 시스템 감시
- 변경 감지 시 WebSocket으로 프론트엔드에 알림
- 프론트엔드가 새 데이터를 로드하여 Plait board 업데이트

**웹 → 파일 (자동 저장)**
- Plait board의 onChange 이벤트 감지
- 디바운싱(300~500ms)을 적용하여 서버로 전송
- 서버가 파일에 원자적 쓰기(atomic write)

### 3.2 에코 방지 (Echo Prevention)

웹에서 변경 → 파일 저장 → chokidar가 감지 → 다시 웹으로 알림 → 무한 루프 문제

**해결 방안:**
- 서버가 "자신이 쓴 변경"인지 추적하는 플래그 사용
- 파일 쓰기 직전에 감시 일시 중지, 쓰기 후 재개
- 또는 content hash 비교로 실제 변경이 없으면 무시

### 3.3 충돌 해결 (Conflict Resolution)

사용자가 웹 UI에서 편집 중에 AI가 파일을 수정하는 경우:

**전략 (단순 → 복잡 순):**
1. **Last Write Wins** — 가장 단순. 마지막 저장이 우선 (PoC 단계)
2. **외부 변경 알림** — "파일이 외부에서 변경되었습니다. 반영할까요?" 다이얼로그
3. **3-way merge** — 공통 조상 기준으로 양쪽 변경을 머지 (향후 고도화)

PoC에서는 **Last Write Wins + 알림**으로 시작.

### 3.4 AI 편집 전략

| 편집 수준 | 방법 | AI 난이도 |
|-----------|------|----------|
| 전체 재생성 | Markdown/Mermaid 작성 → 변환 도구로 JSON 생성 → 파일 교체 | 쉬움 |
| 구조만 수정 | PlaitElement[] JSON에서 노드 추가/삭제/이름변경 | 보통 |
| 부분 편집 + 레이아웃 유지 | JSON patch로 특정 요소만 수정, 좌표 유지 | 어려움 |

**권장 워크플로우:**
1. AI가 Markdown/Mermaid 텍스트를 생성
2. 변환 도구가 PlaitElement[] JSON으로 변환
3. JSON 파일에 저장
4. 웹 UI에서 사용자가 시각적으로 미세 조정

### 3.5 Hot Reload 안정성

- **디바운싱**: 파일 변경 이벤트가 여러 번 발생할 수 있으므로 300ms 디바운싱
- **원자적 쓰기**: 임시 파일에 쓴 후 rename으로 교체 (파일이 반쯤 쓰인 상태 방지)
- **유효성 검증**: JSON 파싱 실패 시 이전 상태 유지

---

## 4. PoC 구현 계획

### Phase 1: 기반 구축 및 데이터 모델 파악

**목표**: Drawnix를 로컬에서 실행하고 데이터 모델을 완전히 이해한다.

- [ ] 1.1 Drawnix 저장소 클론 및 로컬 실행
- [ ] 1.2 PlaitElement[] JSON 구조 분석 (마인드맵, 플로우차트, 자유 캔버스 각각)
- [ ] 1.3 기존 저장/불러오기 메커니즘 코드 파악
- [ ] 1.4 markdown-to-drawnix / mermaid-to-drawnix CLI 동작 확인
- [ ] 1.5 데이터 모델 문서화

### Phase 2: 파일 동기화 레이어

**목표**: 파일 ↔ 웹 양방향 동기화의 기본 골격을 구현한다.

- [ ] 2.1 Next.js API Route: 파일 읽기/쓰기 엔드포인트 (`/api/sync`)
- [ ] 2.2 chokidar 파일 감시 서비스 (Next.js 서버 사이드)
- [ ] 2.3 WebSocket 서버 (변경 알림 채널)
- [ ] 2.4 프론트엔드 WebSocket 클라이언트 → Plait board 업데이트
- [ ] 2.5 에코 방지 메커니즘 구현

### Phase 3: 양방향 동기화 완성

**목표**: 안정적인 양방향 동기화를 완성한다.

- [ ] 3.1 웹 UI onChange → 디바운싱 → API 호출 → 파일 저장
- [ ] 3.2 외부 변경 감지 → content hash 비교 → 웹 UI 반영
- [ ] 3.3 원자적 파일 쓰기 (tmp + rename)
- [ ] 3.4 간단한 충돌 알림 UI
- [ ] 3.5 에러 핸들링 (파일 잠금, 파싱 실패 등)

### Phase 4: AI 편집 경로 검증

**목표**: Claude Code가 파일을 수정하면 웹 UI에 반영되는 전체 루프를 검증한다.

- [ ] 4.1 Claude Code에서 Markdown 작성 → 마인드맵 자동 생성 테스트
- [ ] 4.2 Claude Code에서 Mermaid 작성 → 플로우차트 자동 생성 테스트
- [ ] 4.3 PlaitElement[] JSON 직접 편집 → 노드 추가/수정/삭제 테스트
- [ ] 4.4 사용자가 웹에서 편집 → 파일 변경 → Claude Code가 읽기 테스트
- [ ] 4.5 E2E 시나리오: AI-인간 협업 계획 수립 시뮬레이션

---

## 5. 리스크 및 완화 방안

| 리스크 | 영향 | 완화 방안 |
|--------|------|----------|
| Drawnix가 초기 프로젝트라 API 불안정 | 높음 | Plait 코어 API에 의존, Drawnix는 래퍼로만 활용. 최악의 경우 직접 React+Plait 앱 구축 |
| PlaitElement JSON이 AI가 편집하기 어려운 구조 | 중간 | markdown-to-drawnix/mermaid-to-drawnix 변환 경로를 주 편집 방식으로 사용 |
| 양방향 동기화 시 데이터 손실 | 높음 | 원자적 쓰기 + 백업 파일 유지 + content hash 검증 |
| 웹 UI에서의 시각적 편집이 Drawnix에서 제한적 | 중간 | Phase 1에서 Drawnix의 편집 능력을 먼저 검증 후 진행 여부 결정 |
| Next.js 서버에서 chokidar 사용 시 성능/호환성 문제 | 낮음 | 별도 Node.js 프로세스로 분리 가능 |

---

## 6. 대안 경로 (Fallback)

Drawnix가 요구사항을 충족하지 못할 경우:

1. **Excalidraw + 커스텀 파일 동기화**: 자유 캔버스 위주. AI 편집은 전체 재생성 방식
2. **다중 렌더러 통합**: Markmap(마인드맵) + Mermaid(플로우차트) + Excalidraw(캔버스)를 탭으로 전환
3. **직접 구축**: React Flow + D3 + chokidar + WebSocket으로 맞춤형 도구 빌드

---

## 7. 성공 기준

PoC가 성공했다고 판단하는 기준:

- [ ] 로컬 파일(.vync JSON)을 열면 웹 UI에 마인드맵/플로우차트가 렌더링됨
- [ ] 웹 UI에서 노드를 추가/이동/삭제하면 로컬 파일이 자동 저장됨
- [ ] 외부에서(vim, Claude Code 등) 파일을 수정하면 웹 UI가 자동 갱신됨
- [ ] Claude Code가 Markdown을 작성하면 마인드맵이 자동 생성됨
- [ ] Claude Code가 Mermaid를 작성하면 플로우차트가 자동 생성됨
- [ ] 전체 루프가 3초 이내에 반영됨
