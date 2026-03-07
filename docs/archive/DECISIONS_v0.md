# Vync MVP — 설계 결정서

> 2026-03-07 기획 세션에서 확정된 설계 결정사항.
> 이 문서는 "왜 이렇게 결정했는가"의 근거를 포함한다.

---

## 1. 확정된 결정사항

### 1.1 프로젝트 범위: MVP (실사용 가능)

**결정**: PoC가 아닌 MVP 수준. 실제로 Claude Code와 함께 계획 수립에 사용할 수 있는 수준.

**포함 범위**:
- CLI 도구 (`vync init`, `vync open`)
- 안정적 양방향 파일 동기화
- 기본 에러 핸들링 (JSON 파싱 실패, 파일 잠금 등)
- AI 편집 지원 도구 (CLAUDE.md, JSON Schema, 예시 파일)

**제외 범위**:
- 패키징/배포 (`npx vync`로 설치 가능한 수준은 후속)
- 다중 사용자/원격 협업
- 문서화 사이트

**근거**: 순수 PoC는 검증 후 버려지기 쉽고, 프로덕트 수준은 범위가 과도하다. "자기 자신이 실제로 쓸 수 있는 도구"가 적절한 목표.

---

### 1.2 기반 전략: Drawnix 포크 + 수정

**결정**: Drawnix 저장소를 포크하여 파일 동기화 레이어를 추가한다.

**대안 및 기각 사유**:
| 대안 | 기각 사유 |
|------|----------|
| Plait 직접 사용 (자체 앱) | UI(도구모음, 패널, 컨텍스트 메뉴 등)를 처음부터 구축해야 하여 개발 시간 2~3배 증가 |
| Drawnix를 컴포넌트로 임베드 | Drawnix가 외부 데이터 주입 API를 제공하는지 불확실, 통합 복잡성 높음 |

**수정 범위**:
- 저장 메커니즘: localStorage/IndexedDB → 파일 시스템 (.vync JSON)
- WebSocket 레이어 추가 (실시간 파일 변경 감지)
- Custom Server 설정 (chokidar + WS)
- 불필요한 기능 제거 또는 비활성화 (클라우드 저장 등)

**리스크**:
- 업스트림 변경 추적이 어려움 → 핵심 변경을 최소화하고 레이어로 분리
- Drawnix가 초기 프로젝트라 불안정할 수 있음 → Phase 1에서 검증 후 진행 여부 결정

---

### 1.3 AI 편집 경로: PlaitElement[] JSON 직접 편집

**결정**: AI(Claude Code)는 .vync 파일의 PlaitElement[] JSON을 직접 읽고 수정한다. Markdown/Mermaid 변환 파이프라인은 MVP에서 제외.

**대안 및 기각 사유**:
| 대안 | 기각 사유 |
|------|----------|
| 소스 파일 기반 (.md/.mmd → 자동 변환) | 웹 UI 편집을 소스에 역변환하는 것이 기술적으로 매우 어려움. 두 포맷 간 일관성 유지 부담 |
| 하이브리드 (초기 생성은 .md, 이후 수정은 JSON) | 복잡성 증가, AI에게 두 가지 모드를 안내해야 함 |

**단일 경로의 장점**:
- 웹 UI 편집과 AI 편집이 동일한 포맷을 사용하여 양방향 완전 호환
- 파일이 하나뿐이라 동기화 로직이 단순
- 충돌 해결이 간단 (파일 하나의 Last Write Wins)

**단일 경로의 도전**:
- PlaitElement[] JSON이 복잡하여 AI 편집 오류 가능성 → CLAUDE.md + JSON Schema + 예시로 완화
- AI가 좌표계를 이해해야 함 → 가이드 문서에 좌표계 설명 포함

---

### 1.4 동기화 아키텍처: Next.js Custom Server

**결정**: 단일 Next.js Custom Server 프로세스에 HTTP, WebSocket, chokidar를 통합.

```
vync open plan.vync
  └─ Next.js Custom Server (:3000)
     ├─ HTTP     — 페이지 서빙 + API Routes (/api/sync)
     ├─ WebSocket — 실시간 파일 변경 알림
     └─ chokidar  — 파일 시스템 감시
```

**근거**:
- 로컬 전용 도구이므로 서버리스/클라우드 배포 불필요
- 단일 프로세스 = 단일 포트 = 단순한 사용자 경험
- `vync open` 한 번으로 모든 것이 시작됨

**트레이드오프**:
- Next.js의 서버리스 최적화(ISR, Edge Functions 등) 사용 불가 → 로컬 도구에는 불필요
- 프로세스가 죽으면 모든 것이 중단 → 로컬 도구에서는 수용 가능

---

### 1.5 파일 포맷: 래핑된 JSON

**결정**: PlaitElement[] 배열을 메타데이터로 감싸는 구조.

```json
{
  "version": 1,
  "viewport": { "zoom": 1, "x": 0, "y": 0 },
  "elements": [
    {
      "id": "abc123",
      "type": "mindmap",
      "data": { "topic": { "text": "Root" } },
      "children": []
    }
  ]
}
```

**파일 확장자**: `.vync`

**설계 근거**:
- `version`: 향후 포맷 마이그레이션 지원
- `viewport`: 마지막 뷰 상태 복원 (줌, 스크롤 위치)
- `elements`: Drawnix/Plait 내부 데이터 모델과 직접 호환
- 래핑 구조이므로 향후 메타데이터 확장 용이 (title, tags, createdAt 등)

**대안 기각**:
- PlaitElement[] 네이키드 (메타데이터 없음): 버전 관리, 뷰포트 복원 불가

---

### 1.6 파일 관리 UX: CLI 중심

**결정**: 파일 관리는 CLI(`vync init`, `vync open`)로, 웹 UI는 순수 캔버스 에디터.

```bash
$ vync init plan.vync        # 빈 캔버스 파일 생성
$ vync open plan.vync         # 서버 시작 + 브라우저 열기
```

**웹 UI에 없는 것**: 파일 목록, 사이드바, 프로젝트 탐색기.

**근거**:
- 사용자가 이미 터미널에서 Claude Code와 작업 중이므로 CLI가 자연스러운 진입점
- 웹 UI는 시각적 편집에만 집중하여 복잡도 최소화
- Claude Code가 사용자에게 "vync open plan.vync로 확인하세요"라고 안내하기 쉬움

---

### 1.7 변경 알림 UX: 조용히 자동 반영

**결정**: 외부에서 파일이 변경되면 알림 없이 자동으로 캔버스를 업데이트.

**근거**:
- Google Docs처럼 자연스러운 실시간 경험
- AI가 파일을 수정할 때마다 "변경되었습니다" 팝업이 뜨면 방해됨
- 사용자가 웹에서 편집 중이 아닐 때는 조용한 반영이 최선

**주의 사항** (구현 시 고려):
- 사용자가 웹에서 활발히 편집 중일 때 외부 변경이 오면, 편집 내용이 덮어쓰일 수 있음
- 이 경우에 한해 미묘한 시각적 표시 (캔버스 테두리 깜빡임 등)를 추가할 수 있음 (MVP 후속)

---

### 1.8 충돌 해결: Last Write Wins

**결정**: 가장 마지막에 저장된 내용이 우선. 복잡한 머지 로직 없음.

**에코 방지**: content hash 비교로 자체 쓰기를 감지하여 무한 루프 차단.

**근거**: MVP에서는 단순함 우선. 실제 사용에서 충돌 빈도가 높으면 후속으로 개선.

---

### 1.9 AI 편집 지원 도구

**결정**: CLAUDE.md 가이드 + JSON Schema + 예시 파일 모두 제공.

| 도구 | 용도 |
|------|------|
| `CLAUDE.md` | .vync JSON 구조 설명, 편집 가이드, 좌표계, ID 생성 규칙 |
| `.vync.schema.json` | JSON Schema로 유효성 검증, 에디터 자동완성 |
| `examples/*.vync` | 마인드맵, 플로우차트 예시 파일 |

---

### 1.10 패키지 매니저: pnpm

**결정**: Drawnix가 pnpm workspace를 사용하므로 그대로 유지.

---

## 2. 추후 고려 및 논의사항

### 2.1 Markdown/Mermaid 변환 파이프라인 (다음 버전)

MVP에서 제외했지만, AI가 PlaitElement[] JSON을 직접 편집하는 것이 너무 어렵거나 오류가 많다면 재검토 필요.

**옵션들**:
- `vync convert plan.md` CLI 명령어 추가
- 서버 사이드 자동 변환 (`.md` 파일 감지 시)
- AI가 "의도"를 표현하면 시스템이 JSON patch 생성

**전제 조건**: Phase 1에서 PlaitElement[] JSON 구조를 분석한 후, AI 편집 난이도를 실제로 평가.

### 2.2 웹 UI에서의 편집 → 소스 역변환

웹 UI에서 시각적으로 편집한 내용을 사람이 읽을 수 있는 형태(Markdown 등)로 역변환하는 것은 장기적으로 가치 있지만 기술적 난이도가 높다.

- PlaitElement[] → Markdown: 레이아웃 정보(좌표, 스타일)가 손실됨
- PlaitElement[] → Mermaid: 부분적으로 가능하지만 완전한 왕복 변환은 어려움

### 2.3 다중 파일 동시 편집

현재 설계는 `vync open <file>` 로 단일 파일을 여는 구조. 향후:
- 다중 탭 지원 (`vync open` 에 여러 파일 전달)
- 대시보드/파일 탐색기 UI 추가
- 파일 간 링크/참조

### 2.4 충돌 해결 고도화

Last Write Wins를 넘어서:
- 외부 변경 알림 팝업 ("파일이 외부에서 변경되었습니다. 반영할까요?")
- 3-way merge (공통 조상 기준 양쪽 변경 머지)
- Operational Transform 또는 CRDT 기반 실시간 협업

### 2.5 배포/패키징

MVP 이후 다른 개발자도 사용할 수 있도록:
- `npx vync` / `bunx vync` 으로 즉시 실행
- npm 패키지 발행
- 글로벌 설치 지원 (`npm install -g vync`)

### 2.6 보안

로컬 서버가 파일 시스템에 접근하므로:
- 접근 가능한 디렉토리를 프로젝트 루트로 제한
- WebSocket 연결을 localhost로 제한
- API 엔드포인트에 대한 접근 제어

### 2.7 Drawnix 업스트림 추적

포크 전략의 장기적 리스크:
- Drawnix 업스트림에 중요 버그 수정/기능이 추가될 때 머지 어려움
- 완화: 변경을 최소화하고 레이어로 분리, 주기적으로 upstream diff 확인
- 최악의 경우: Plait 라이브러리 직접 사용으로 전환 (Fallback 옵션 B)

### 2.8 `vync watch` 명령어

파일 감시 데몬을 UI 없이 백그라운드로 실행하는 명령어. 자동 변환 파이프라인이 추가되면 유용.

### 2.9 사용자 편집 중 외부 변경 처리

"조용히 자동 반영" 정책에서, 사용자가 활발히 편집 중일 때 외부 변경이 들어오면:
- 현재: Last Write Wins로 외부 변경이 사용자 편집을 덮어씀
- 개선안: 편집 중인 요소와 외부 변경 요소가 겹치지 않으면 머지, 겹치면 사용자 편집 우선

---

## 3. 기술 스택 요약

| 레이어 | 기술 |
|--------|------|
| 프론트엔드 | Drawnix (Next.js + TypeScript + Plait + Tailwind CSS) |
| 서버 | Next.js Custom Server + ws (WebSocket) |
| 파일 감시 | chokidar |
| 파일 포맷 | .vync (JSON) |
| CLI | Node.js (bin 스크립트) |
| 패키지 매니저 | pnpm |

---

## 4. 구현 Phase 요약

| Phase | 목표 | 핵심 산출물 |
|-------|------|------------|
| 1 | Drawnix 포크 + 데이터 모델 파악 | 포크된 저장소, PlaitElement[] 구조 문서화 |
| 2 | 파일 동기화 레이어 | Custom Server, chokidar, WebSocket, API Routes |
| 3 | 양방향 동기화 완성 | 에코 방지, 원자적 쓰기, 에러 핸들링 |
| 4 | CLI 도구 + AI 지원 | vync init/open, CLAUDE.md, JSON Schema, 예시 파일 |
| 5 | E2E 검증 | Claude Code ↔ 웹 UI 전체 루프 테스트 |
