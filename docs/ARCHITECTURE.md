# Vync — 아키텍처

> 시스템 구조, 데이터 흐름, 기술 스택, 파일 포맷을 정의한다.
> 설계 근거는 [DECISIONS.md](./DECISIONS.md), 후속 확장은 [FUTURE.md](./FUTURE.md) 참조.

---

## 1. 시스템 개요

로컬 `.vync` JSON 파일을 Source of Truth로, 웹 UI와 외부 도구(Claude Code, vim 등)가 양방향 실시간 동기화되는 시각적 계획 수립 도구.

```
┌──────────────┐                    ┌──────────────────┐                    ┌──────────────┐
│  Claude Code  │                    │  .vync JSON 파일  │                    │  웹 브라우저    │
│  (JSON 편집)   │ ── Write/Edit ──→ │  (Source of Truth) │ ── chokidar ──→   │  Vync UI      │
│              │                    │                    │                    │  (캔버스 편집)  │
│              │ ←── Read ──────── │                    │ ←── auto-save ── │              │
└──────────────┘                    └──────────────────┘                    └──────────────┘
                                           ↕ WebSocket
                                    ┌──────────────────┐
                                    │  Custom Node      │
                                    │  Server (:3100)   │
                                    │  HTTP + WS +      │
                                    │  chokidar +       │
                                    │  Vite middleware   │
                                    └──────────────────┘
```

**핵심 원칙** (→ D-004):
- 파일 = Source of Truth — 어떤 프로세스든 파일만 수정하면 반영됨
- 단일 프로세스 — HTTP, WebSocket, chokidar가 하나의 Custom Node Server에 통합 (dev: Vite middleware, prod: 정적 파일 서빙)
- Claude Code 전용이 아님 — vim, VS Code, 스크립트 등 어떤 도구로든 동작

---

## 2. 데이터 흐름

### 2.1 외부 편집 → 웹 UI

```
외부에서 .vync 파일 수정 (Claude Code, vim 등)
  → chokidar 감지 (300ms 디바운싱)
  → content hash 비교 (에코 방지, → D-009)
  → 실제 변경이면 WebSocket으로 전송
  → 프론트엔드가 PlaitElement[] 교체
  → 캔버스 자동 업데이트 (조용히, → D-007)
```

### 2.2 웹 UI → 파일

```
캔버스에서 노드 편집
  → Plait onChange 이벤트
  → 디바운싱 (300ms)
  → API 호출 (PUT /api/sync)
  → 서버가 원자적 쓰기 (tmp + rename)
  → content hash 업데이트 (에코 방지)
```

### 2.3 충돌 시나리오 (→ D-008: Last Write Wins)

```
웹 UI에서 편집 중 + 외부에서 동시 수정
  → 서버의 단일 쓰기 큐에서 순차 처리
  → 나중에 도착한 쓰기가 최종 상태
  → 먼저 쓴 내용은 덮어써짐 (별도 알림 없음)
  → 양쪽 모두 최종 상태로 즉시 동기화
```

단일 사용자 시나리오에서는 동시 편집이 드물다. 발생하더라도 양쪽이 즉시 최종 상태로 동기화되므로 사용자가 곧바로 재편집 가능.

---

## 3. 기술 스택

| 레이어 | 기술 | 근거 |
|--------|------|------|
| 프론트엔드 | Drawnix (Vite 6 + React + TypeScript + Plait) | D-002 |
| 서버 | Custom Node Server + Vite middleware mode + ws (WebSocket) | D-004 |
| 파일 감시 | chokidar | Node.js 표준, 크로스 플랫폼 |
| 파일 포맷 | .vync (JSON) | D-005 |
| CLI | Node.js (bin 스크립트) | D-006 |
| 패키지 매니저 | npm + nx monorepo | D-011 |
| 데스크톱 | Electron + electron-builder (macOS DMG) | D-012 |
| 테스트 | Vitest | Vite 생태계, TS 네이티브 |

---

## 4. 파일 포맷 (.vync)

```json
{
  "version": 1,
  "viewport": { "zoom": 1, "x": 0, "y": 0 },
  "elements": [
    {
      "id": "abc123",
      "type": "mindmap",
      "data": { "topic": { "text": "Root" } },
      "children": [],
      "width": 200,
      "height": 50,
      "isRoot": true,
      "points": [[0, 0]]
    }
  ]
}
```

### 4.1 PlaitElement 기본 인터페이스

```typescript
// @plait/core
interface PlaitElement {
  [key: string]: any;
  id: string;              // idCreator(5) — 5자 랜덤 문자열
  children?: PlaitElement[];
  points?: Point[];        // Point = [number, number]
  type?: string;
  groupId?: string;
  angle?: number;
}
```

**ID 생성**: `idCreator(length=5)` — `ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz` 문자셋에서 5자 랜덤. UUID/nanoid 아님.

### 4.2 요소 타입별 구조

**PlaitMind / MindElement (마인드맵)**:
```typescript
// @plait/mind — 루트 노드
interface PlaitMind extends MindElement {
  type: 'mind' | 'mindmap';
  points: Point[];           // [[x, y]] 루트 위치 (1점)
}

// 모든 마인드맵 노드 (루트 포함)
interface MindElement extends PlaitElement {
  type: 'mind_child' | 'mind' | 'mindmap';
  children: MindElement[];   // 자식 노드 (트리 구조)
  data: BaseData;            // { topic: { children: SlateNode[] } }
  rightNodeCount?: number;
  manualWidth?: number;
  fill?: string;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  shape?: 'round-rectangle' | 'underline';
  branchColor?: string;
  branchWidth?: number;
  branchShape?: 'bight' | 'polyline';
  layout?: MindLayoutType;
  isCollapsed?: boolean;
}
```

**PlaitGeometry (도형 — rectangle, ellipse, diamond, text 등)**:
```typescript
// @plait/draw
interface PlaitGeometry extends PlaitElement {
  type: 'geometry';
  points: [Point, Point];    // [[x1,y1], [x2,y2]] 바운딩 박스
  shape: GeometryShapes;     // 'rectangle' | 'ellipse' | 'diamond' | 'text' | ...
  text?: ParagraphElement;   // Slate 텍스트 노드
  fill?: string;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  angle?: number;
  opacity?: number;
}
```

**PlaitArrowLine (화살표 연결선)**:
```typescript
// @plait/draw
interface PlaitArrowLine extends PlaitElement {
  type: 'arrow-line';
  shape: 'elbow' | 'curve' | 'straight';
  points: Point[];           // 경유점
  source: ArrowLineHandle;   // { marker: string, connection?: [number, number], boundId?: string }
  target: ArrowLineHandle;
  texts: ArrowLineText[];
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  opacity: number;
}
```

**PlaitVectorLine (벡터 라인)**:
```typescript
interface PlaitVectorLine extends PlaitElement {
  type: 'vector-line';
  shape: 'straight' | 'curve';
  points: Point[];
  strokeColor?: string;
  strokeWidth?: number;
  fill?: string;
  opacity: number;
}
```

**PlaitImage (이미지)**:
```typescript
interface PlaitImage extends PlaitElement {
  type: 'image';
  points: [Point, Point];    // 바운딩 박스
  url: string;
  angle: number;
}
```

### 4.3 좌표계

- `Point = [number, number]` — `[x, y]` 튜플
- 도형/이미지: `points = [[x1,y1], [x2,y2]]` — 좌상단, 우하단 (바운딩 박스)
- 마인드맵 루트: `points = [[x, y]]` — 단일 위치점 (자식 노드는 레이아웃 엔진이 자동 배치)
- 화살표 라인: `points = [Point, ...]` — 시작점, 경유점(들), 끝점

### 4.4 Transforms API (외부 조작)

Plait는 Slate 스타일의 Transforms API를 제공:

```typescript
// 노드 조작
NodeTransforms.insertNode(board, node, path);
NodeTransforms.setNode(board, partialNode, path);
NodeTransforms.removeNode(board, path);
NodeTransforms.moveNode(board, path, newPath);

// 요소 제거
CoreTransforms.removeElements(board, elements);

// 뷰포트
BoardTransforms.fitViewport(board);
ViewportTransforms.setViewport(board, viewport);

// 프래그먼트 삽입 (변환기에서 사용)
board.insertFragment({ elements }, startPoint, operationType);
```

### 4.5 외부 데이터 주입 (WebSocket 수신 시)

`<Wrapper>` 컴포넌트 (`packages/react-board/src/wrapper.tsx:189-207`)에서 `value` prop 변경 감지 시 자동 업데이트:

```typescript
useEffect(() => {
  if (value !== context.board.children && !FLUSHING.get(board)) {
    board.children = value;
    listRender.update(board.children, { ... });
    BoardTransforms.fitViewport(board);
  }
}, [value]);
```

→ React state로 `value`를 관리하고, WebSocket 메시지 수신 시 state를 업데이트하면 보드가 자동 갱신됨.

---

## 5. 프로젝트 구조

```
Vync/                              # Drawnix 포크 (nx monorepo)
├── apps/
│   └── web/                       # Vite + React 프론트엔드
│       ├── src/
│       │   ├── app/
│       │   │   └── app.tsx        # 메인 앱 컴포넌트               [VYNC 수정: localforage → API]
│       │   └── main.tsx
│       └── vite.config.ts
├── packages/
│   ├── drawnix/                   # Drawnix UI 라이브러리
│   │   └── src/
│   │       ├── drawnix.tsx        # <Drawnix> 컴포넌트 (onChange, value props)
│   │       ├── data/              # 직렬화/역직렬화 (json.ts, blob.ts, filesystem.ts)
│   │       └── components/        # 툴바, 다이얼로그 등
│   └── react-board/               # Plait ↔ React 브릿지
│       └── src/
│           ├── wrapper.tsx        # <Wrapper> — value prop 변경 시 보드 갱신
│           └── board.tsx          # <Board> — SVG 캔버스 렌더링
│   └── shared/                    # 공유 타입 및 유틸리티 (@vync/shared)
│       └── src/
│           ├── index.ts           # barrel export
│           ├── types.ts           # .vync 파일 포맷 타입
│           └── hash.ts            # content hash 유틸리티 (SHA-256)
├── tools/                         # [VYNC 추가] 서버 + CLI + Electron
│   ├── electron/
│   │   ├── main.ts                # Electron main process (단일 인스턴스, 파일 연결, dev/prod) [VYNC 추가]
│   │   └── preload.ts             # preload (window.vyncDesktop 플래그) [VYNC 추가]
│   ├── server/
│   │   ├── server.ts              # Custom Node Server (startServer export + 직접 실행 가드)
│   │   ├── file-watcher.ts        # chokidar 파일 감시
│   │   ├── sync-service.ts        # 동기화 로직 (에코 방지 + 원자적 쓰기 + JSON 유효성 검증)
│   │   └── ws-handler.ts          # WebSocket 메시지 핸들러
│   └── cli/
│       ├── main.ts                # CLI 진입점 (subcommand 라우팅)
│       ├── init.ts                # vync init: 빈 .vync 파일 생성
│       ├── open.ts                # vync open/stop: 서버 시작/종료 + PID 관리
│       ├── resolve.ts             # resolveVyncPath(): 경로 해석 (bare name → .vync/ 하위)
│       └── __tests__/
│           ├── init.test.ts       # init 유닛 테스트
│           └── open.test.ts       # smart restart + vyncStop 유닛 테스트
├── bin/
│   └── vync.js                    # CLI 진입점 (CommonJS, tsx spawn) [VYNC 추가]
├── .claude-plugin/                # Claude Code 플러그인 (marketplace 표준) [VYNC 추가]
│   ├── plugin.json                # 플러그인 메타데이터
│   ├── install.sh                 # ~/.claude/에 심볼릭 링크 + 설정 머지
│   ├── uninstall.sh               # 정리
│   ├── hooks.json                 # PostToolUse + SessionEnd 설정
│   ├── skills/
│   │   └── vync-editing/          # 편집 가이드 Skill
│   │       ├── SKILL.md
│   │       ├── references/        # 상세 가이드 (mindmap, geometry, arrow-line, coordinates)
│   │       ├── scripts/           # validate.js, generate-id.js
│   │       └── assets/            # schema.json, 예시 .vync 파일
│   ├── agents/                    # 커스텀 sub-agent (vync-translator)   [VYNC 추가: Phase 7]
│   └── commands/                  # /vync 슬래시 커맨드 (create/read/update 통합)
├── docs/                          # 프로젝트 문서
├── examples/                      # .vync 예시 파일                [VYNC 추가]
├── electron-builder.yml           # Electron 패키징 설정 (macOS DMG)  [VYNC 추가]
├── .vync.schema.json              # JSON Schema (프로젝트 루트 복사본) [VYNC 추가]
├── nx.json                        # nx monorepo 설정
└── package.json                   # 루트 package.json (npm, bin 필드 포함)
```

---

## 6. 핵심 기술 과제

### 6.1 에코 방지 (→ D-009)

```
1. 파일 쓰기 시 content의 SHA-256 해시를 메모리에 저장
2. chokidar가 변경 감지 시 새 파일의 해시 계산
3. 저장된 해시와 동일 → 자체 쓰기 → 무시
4. 다르면 → 외부 변경 → WebSocket 알림
```

**Race Condition 시나리오**:

```
T1: 서버가 파일 쓰기 시작 (hash 아직 미저장)
T2: chokidar가 쓰기 감지 → 해시 비교 시도
T3: 서버가 hash 저장 완료
→ T2에서 hash가 없으므로 외부 변경으로 오인 → 에코 발생
```

**해결**: `isWriting` 플래그를 사용한 쓰기 잠금.

```
1. 쓰기 시작 전: isWriting = true
2. 파일 쓰기 (tmp + rename)
3. content hash 저장
4. isWriting = false
5. chokidar 이벤트 수신 시: isWriting === true → 대기 후 재확인
```

### 6.2 원자적 쓰기

```
1. 임시 파일에 내용 쓰기: /path/to/.file.vync.tmp
2. JSON 유효성 검증
3. rename()으로 원본 파일 교체 (POSIX atomic)
4. 실패 시 이전 파일 유지
```

### 6.3 디바운싱

- **웹 → 파일**: onChange 이벤트를 300ms 디바운싱
- **파일 → 웹**: chokidar 이벤트를 300ms 디바운싱

### 6.4 JSON 유효성 검증

- 파일 읽기 시 JSON.parse 실패하면 이전 유효한 상태 유지
- 에러 로그를 서버 콘솔에 출력

### 6.5 보안

로컬 전용 도구이므로 최소한의 보안 조치:

- **네트워크 바인딩**: 서버는 `127.0.0.1` (localhost)에만 바인딩. 외부 네트워크에서 접근 불가.
- **CORS**: `Access-Control-Allow-Origin: http://localhost:3100` 으로 제한.
- **파일 접근 범위**: CLI에서 지정한 .vync 파일만 읽기/쓰기. 서버가 임의 경로에 접근하지 않음.
- **WebSocket**: `ws://localhost:3100` 에서만 수신. Origin 헤더 검증.

### 6.6 초기화/종료 흐름

**PID 파일 포맷** (`~/.vync/server.pid`):
```
<pid>
<mode>        # daemon | electron | foreground
<file-path>   # 서빙 중인 .vync 파일 절대경로
```

**경로 해석 (`resolveVyncPath`)** — bare filename은 `.vync/` 하위 디렉터리:
```
vync init myplan         → CWD/.vync/myplan.vync  (bare filename)
vync init ./myplan       → CWD/myplan.vync        (명시적 상대경로)
vync init /tmp/test      → /tmp/test.vync         (절대경로)
```
`bin/vync.js`가 `VYNC_CALLER_CWD` 환경변수로 호출자의 원래 CWD를 전달.

**서버 시작 (`vync open <file>`)** — 스마트 재시작 + Electron 우선, 폴백으로 tsx daemon:
```
1. 경로 해석 (resolveVyncPath) → 파일 존재 확인 → 없으면 에러 메시지 + 종료
2. 기존 서버 상태 확인 (3-state 감지):
   - PID 파일 읽기 → 프로세스 존재 확인 (kill 0) → HTTP 헬스체크 (HEAD /api/sync)
   - none: 서버 없음 → 정상 시작
   - same-file: 같은 파일 서빙 중 → 브라우저만 열기 (Electron이면 로그만 출력)
   - different-file: 다른 파일 서빙 중 → 자동 stop → 새 파일로 시작
3. [Electron 모드 — 기본] electron dist/electron/main.js <file>을 detached spawn
   [tsx 데몬 모드 — 폴백] tsx로 server.ts를 detached 자식 프로세스로 spawn
   [포그라운드 모드 — --foreground] 현재 프로세스 내에서 startServer() 직접 호출
4. 300ms 간격 폴링으로 서버 준비 대기 (최대 10초)
5. PID 파일에 ServerInfo 기록 (pid/mode/filePath)
```

**서버 종료 (`vync stop` / Ctrl+C / SIGTERM)**:
```
1. PID 파일에서 ServerInfo 읽기
2. SIGTERM 전송 → 프로세스 종료 대기 (최대 5초)
3. 타임아웃 시 SIGKILL 에스컬레이션
4. 포트 해제 확인 (net.createConnection 프로브, 최대 2초)
5. PID 파일 삭제
```

**서버 내부 종료 (SIGTERM 수신 시)**:
```
1. 미완료 쓰기 작업 완료 대기 (최대 3초 타임아웃)
2. WebSocket 연결 정리 (client.terminate())
3. chokidar 감시 중지
4. HTTP 서버 종료
5. 프로세스 종료
```

**파일 손상 시 (런타임)**:
```
외부에서 .vync 파일을 잘못된 JSON으로 덮어쓴 경우:
  → JSON.parse 실패
  → 이전 유효한 상태 유지 (메모리 내)
  → 서버 콘솔에 경고 출력
  → 다음 유효한 쓰기를 대기
```

---

## 7. AI 편집 난이도 평가 (Phase 1.7)

> PlaitElement[] JSON을 AI(Claude Code)가 직접 편집할 때의 난이도를 필드별로 분류한다.
> 결론: JSON 직접 편집 단일 경로(D-003)를 **유지**한다.

### 7.1 난이도 등급 정의

| 등급 | 정의 | AI 가이드 필요 수준 |
|------|------|-------------------|
| **쉬움** | 값의 의미가 자명하고, 잘못된 값을 넣어도 렌더링이 깨지지 않음 | CLAUDE.md 예시만으로 충분 |
| **보통** | 구조를 알아야 하지만, 패턴이 고정적이라 템플릿 복붙으로 해결 가능 | CLAUDE.md 템플릿 + JSON Schema |
| **어려움** | 다른 요소와의 참조 관계 또는 레이아웃 엔진 의존성이 있어 잘못 편집 시 깨짐 | Schema + 예시 + 주의사항 명시, 일부 필드는 AI 편집 비권장 |

### 7.2 공통 필드

| 필드 | 난이도 | 비고 |
|------|--------|------|
| `id` | 쉬움 | `idCreator(5)` 규칙만 따르면 됨. 5자 랜덤 문자열 (문자셋: `ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz`). **중복 금지**만 지키면 OK |
| `type` | 쉬움 | 고정 enum: `'mindmap'`, `'mind_child'`, `'geometry'`, `'arrow-line'`, `'vector-line'`, `'image'` |
| `points` | 보통 | 타입별로 의미가 다름 (아래 참조). 좌표값 자체는 단순하지만, 바운딩 박스 규칙(x1<x2, y1<y2) 준수 필요 |
| `groupId` | 쉬움 | 그룹핑 시 동일 ID 부여. 선택적 |
| `angle` | 쉬움 | 라디안 값. 0이면 회전 없음 |

### 7.3 스타일 필드 (모든 타입 공통)

| 필드 | 난이도 | 비고 |
|------|--------|------|
| `fill` | 쉬움 | CSS 색상 문자열 (`'#ff0000'`, `'rgb(…)'`) |
| `strokeColor` | 쉬움 | CSS 색상 문자열 |
| `strokeWidth` | 쉬움 | 숫자 (기본 2) |
| `strokeStyle` | 쉬움 | `'solid'` \| `'dashed'` \| `'dotted'` |
| `opacity` | 쉬움 | 0~1 숫자 |

### 7.4 Slate 텍스트 노드 (ParagraphElement)

마인드맵의 `data.topic`과 도형의 `text`에 사용되는 Slate JSON 구조.

| 난이도 | **보통** |
|--------|---------|

```json
{
  "children": [
    { "text": "일반 텍스트" },
    { "text": "굵은 글자", "bold": true },
    { "text": "기울임", "italic": true },
    { "text": "코드", "code": true },
    { "text": "밑줄", "underlined": true },
    { "text": "취소선", "strike": true },
    { "text": "색상", "color": "#ff0000" }
  ],
  "align": "center"
}
```

**AI 편집 가이드**:
- 단순 텍스트: `{ "children": [{ "text": "내용" }] }` — 이 패턴만 외우면 90% 해결
- 서식 있는 텍스트: leaf 객체에 `bold`, `italic` 등 boolean 추가
- 링크: `{ "type": "link", "url": "https://...", "children": [{ "text": "링크텍스트" }] }` — 별도 element 타입
- **주의**: `children` 배열은 비어 있으면 안 됨. 최소 `[{ "text": "" }]`

### 7.5 마인드맵 (PlaitMind / MindElement)

| 필드 | 난이도 | 비고 |
|------|--------|------|
| `type` | 쉬움 | 루트: `'mindmap'`, 자식: `'mind_child'` |
| `points` | 쉬움 | 루트만 `[[x, y]]` 1점. 자식 노드는 레이아웃 엔진이 자동 배치하므로 points 불필요 |
| `data.topic` | 보통 | ParagraphElement (§7.4). 단순 텍스트면 쉬움 |
| `children` | 쉬움 | MindElement[] 재귀 트리. 구조적으로 직관적 |
| `rightNodeCount` | 보통 | standard 레이아웃에서 오른쪽에 배치할 자식 수. 생략 시 자동 분배 |
| `shape` | 쉬움 | `'round-rectangle'` \| `'underline'` |
| `branchColor/Width/Shape` | 쉬움 | 가지 스타일. 선택적 |
| `layout` | 쉬움 | 레이아웃 방향. 선택적 (기본: standard) |
| `isCollapsed` | 쉬움 | 접힘 상태. boolean |
| `data.emojis` | 보통 | 이모지 배열. 구조를 알아야 하지만 사용 빈도 낮음 |
| `data.image` | 어려움 | 이미지 데이터. URL/크기 정보 필요. AI 편집으로 추가하기 어려움 |

**AI 편집 용이성**: **높음** — 마인드맵은 트리 구조가 직관적이고, 핵심 필드(topic 텍스트 + children 계층)만으로 유의미한 편집 가능. AI의 주요 사용 사례(계획 수립, 구조화)에 최적.

### 7.6 도형 (PlaitGeometry)

| 필드 | 난이도 | 비고 |
|------|--------|------|
| `type` | 쉬움 | 항상 `'geometry'` |
| `shape` | 쉬움 | BasicShapes(`'rectangle'`, `'ellipse'`, `'diamond'`, `'text'` 등) / FlowchartSymbols(`'process'`, `'decision'` 등) / UMLSymbols |
| `points` | 보통 | `[[x1,y1], [x2,y2]]` 바운딩 박스. x1<x2, y1<y2 규칙 필요. 크기 = (x2-x1) × (y2-y1) |
| `text` | 보통 | ParagraphElement (§7.4). 일부 shape는 텍스트 없음 |
| `autoSize` | 쉬움 | text shape 전용. boolean |

**AI 편집 용이성**: **높음** — shape 종류가 많지만 구조가 균일. 좌표 계산(겹치지 않게 배치)만 신경 쓰면 됨.

### 7.7 화살표 연결선 (PlaitArrowLine)

| 필드 | 난이도 | 비고 |
|------|--------|------|
| `type` | 쉬움 | 항상 `'arrow-line'` |
| `shape` | 쉬움 | `'straight'` \| `'curve'` \| `'elbow'` |
| `source.marker` / `target.marker` | 쉬움 | `'arrow'`, `'none'`, `'open-triangle'` 등 enum |
| `source.boundId` / `target.boundId` | **어려움** | 연결 대상 도형의 `id` 참조. **잘못된 ID → 연결 깨짐**. AI가 도형을 먼저 생성하고 해당 ID를 참조해야 함 |
| `source.connection` / `target.connection` | **어려움** | `[number, number]` — 도형 위의 연결점 비율 (0~1). `[0.5, 0]`=상단 중앙, `[1, 0.5]`=오른쪽 중앙. 도형 형태에 따라 유효한 값이 다름 |
| `points` | **어려움** | 연결선의 경유점. 특히 elbow 라인은 레이아웃 엔진이 자동 계산하므로 AI가 직접 설정하면 깨질 수 있음 |
| `texts` | 보통 | `[{ text: ParagraphElement, position: 0.5 }]` — position은 선 위 비율(0~1) |
| `opacity` | 쉬움 | 0~1 |

**AI 편집 용이성**: **중간~낮음** — 독립 선(bound 없음)은 쉽지만, 도형에 바인딩된 연결선은 `boundId`와 `connection` 좌표의 정확성이 필요. 플로우차트 생성 시 가장 까다로운 부분.

### 7.8 이미지 (PlaitImage)

| 필드 | 난이도 | 비고 |
|------|--------|------|
| `type` | 쉬움 | `'image'` |
| `points` | 보통 | 바운딩 박스 |
| `url` | **어려움** | 이미지 URL 또는 data URI. AI가 이미지를 생성/제공하기 어려움 |
| `angle` | 쉬움 | 회전 |

**AI 편집 용이성**: **낮음** — 이미지 자체를 AI가 제공하기 어려움. 기존 이미지의 위치/크기 변경은 가능.

### 7.9 종합 평가

```
쉬움 ████████████████████ 스타일, enum, boolean, 단순 좌표
보통 ████████████         Slate 텍스트, 바운딩 박스 좌표, 마인드맵 트리
어려움 ████                ArrowLine 바인딩, 이미지 URL, elbow 경유점
```

**결론: D-003 (JSON 직접 편집) 유지**

1. **AI의 주요 사용 사례(계획 수립 = 마인드맵)가 가장 쉬운 영역**. topic 텍스트와 children 계층만으로 충분한 가치 전달.
2. **도형 배치(플로우차트)도 실용적 수준에서 가능**. shape + points + text 패턴이 균일.
3. **어려운 필드(ArrowLine 바인딩, 이미지)는 빈도가 낮고 회피 가능**. 연결선 없는 독립 도형으로도 유의미한 다이어그램 생성 가능. 연결선이 필요하면 CLAUDE.md에 `boundId` + `connection` 가이드를 상세히 제공.
4. **CLAUDE.md + JSON Schema + 예시 파일로 충분히 완화 가능**. 변환 파이프라인(D-003 재검토)은 불필요.

### 7.10 CLAUDE.md 작성 시 우선순위

1. **필수**: 마인드맵 생성/편집 가이드 (topic 텍스트 + children 트리 + ID 규칙)
2. **필수**: 도형 생성 가이드 (shape enum + points 바운딩 박스 + text)
3. **권장**: ArrowLine 바인딩 가이드 (boundId + connection 좌표 매핑 테이블)
4. **참고**: 전체 스타일 속성 레퍼런스
5. **비권장**: 이미지 삽입 (웹 UI에서 직접 수행 권장)

---

## 8. Drawnix 이벤트 시스템 (동기화 후킹 포인트)

```typescript
<Drawnix
  value={elements}
  viewport={viewport}
  theme={theme}
  onChange={(data: BoardChangeData) => {}}       // 전체 변경 → 파일 저장 트리거
  onValueChange={(value: PlaitElement[]) => {}}  // 요소만 변경
  onViewportChange={(viewport: Viewport) => {}}  // 줌/팬
  afterInit={(board: PlaitBoard) => {}}           // 초기화 완료
/>
```

포크 시 수정 사항:
1. localforage 저장소 → API Route 호출로 교체
2. WebSocket 리스너 추가 → 외부 변경 시 Plait board 갱신
3. onChange → debounce(300ms) → PUT /api/sync
