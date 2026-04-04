# Vync — 이슈 레지스트리

> 발견된 버그와 기술적 문제를 추적한다. 해결되면 상태를 `resolved`로 변경하고 해결 내용을 기록한다.
> 설계 결정은 [DECISIONS.md](./DECISIONS.md), 구현 계획은 [PLAN.md](./PLAN.md) 참조.

---

## 이슈 목록

| ID | 제목 | 심각도 | 상태 | 컴포넌트 | 발견일 |
|----|------|--------|------|----------|--------|
| I-001 | [Sub-agent `.lastread` Write 실패](#i-001) | minor | resolved | vync-translator | 2026-03-14 |
| I-002 | [PUT /api/sync가 WebSocket 브로드캐스트 안 함](#i-002) | major | resolved | server | 2026-03-14 |
| I-003 | [Electron 모드에서 `vync open` 시 브라우저 중복 열림](#i-003) | minor | resolved | CLI (open.ts) | 2026-03-14 |
| I-004 | [probePort()가 mode를 항상 'daemon'으로 덮어씀](#i-004) | minor | resolved | CLI (open.ts) | 2026-03-14 |
| I-005 | [Semantic Sync 확신 과대평가 — 단일축 판단 + 무검증 수용](#i-005) | major | open | vync-translator, vync.md | 2026-03-14 |
| I-006 | [Diff 엔진 시각적 변동 미감지 — 위치/크기 변경 무시](#i-006) | minor | open | diff.ts | 2026-03-14 |
| I-007 | [React 컴포넌트 테스트 커버리지 부재](#i-007) | minor | resolved | apps/web, react-board, react-text | 2026-04-04 |
| I-008 | [file-board.tsx 디버그 console.log 잔존](#i-008) | minor | resolved | apps/web | 2026-04-04 |

---

## 상태 정의

| 상태 | 설명 |
|------|------|
| `open` | 발견됨, 미착수 |
| `in-progress` | 수정 진행 중 |
| `resolved` | 해결 완료 (해결일 + 방법 기록) |
| `won't-fix` | 수정하지 않기로 결정 (사유 기록) |

## 심각도 정의

| 심각도 | 설명 |
|--------|------|
| `critical` | 데이터 손실 또는 핵심 기능 불가 |
| `major` | 기능 저하, 워크어라운드 존재 |
| `minor` | 불편하지만 기능에 영향 없음 |

---

## 상세

### I-001

**Sub-agent `.lastread` Write 실패**

심각도: `minor` · 상태: `resolved` · 발견일: 2026-03-14 · 해결일: 2026-04-04
컴포넌트: `vync-translator` sub-agent / diff pipeline

**현상**:
Sub-agent가 `.vync` 파일 수정 후 `.lastread` 스냅샷 파일을 직접 Write하려 할 때, Claude Code의 Write 도구 안전 장치에 의해 차단됨.

**해결**:
`agents/vync-translator.md`에 `.lastread` 파일 직접 Write 금지 규칙을 추가. Create/Update 절차에서 직접 Write 대신 `vync diff <file>` 호출로 스냅샷을 갱신하도록 수정.

**해결 방향**:
- `agents/vync-translator.md`에 `.lastread` 파일을 직접 조작하지 말라는 명시적 지침 추가
- 또는 MCP 서버 전환 시 스냅샷 관리를 Tool API로 캡슐화하여 구조적으로 방지

---

### I-002

**PUT /api/sync가 WebSocket 브로드캐스트 안 함**

심각도: `major` · 상태: `resolved` · 발견일: 2026-03-14 · 해결일: 2026-03-14
컴포넌트: `tools/server/server.ts` (PUT /api/sync 핸들러)

**현상**:
브라우저 A가 캔버스 편집 → PUT /api/sync → 서버가 디스크에 쓰기 → chokidar가 감지하지만 `isWriting=true`로 에코 방지됨 → 다른 클라이언트(B)에 브로드캐스트 안 됨. 멀티 탭/멀티 윈도우 환경에서 편집이 다른 클라이언트에 반영되지 않음.

**근본 원인**:
PUT 핸들러가 `sync.writeFile()` 후 `res.json({ ok: true })`만 반환. chokidar 경로는 에코 방지(isWriting=true + hash 일치)로 항상 억제됨. 결과적으로 PUT으로 들어온 변경이 어떤 WS 클라이언트에도 전달되지 않음.

**해결**:
PUT 핸들러에서 `sync.writeFile()` 후 `registry.broadcastToFile(filePath, { type: 'file-changed', filePath, data })` 추가. PUT 클라이언트는 `remoteUpdateUntilRef` 메커니즘으로 수신 무시 (에코 방지).

---

### I-003

**Electron 모드에서 `vync open` 시 브라우저 중복 열림**

심각도: `minor` · 상태: `resolved` · 발견일: 2026-03-14 · 해결일: 2026-03-14
컴포넌트: `tools/cli/open.ts` (vyncOpen)

**현상**:
Electron 서버가 실행 중일 때 `vync open <file2>` 호출 시 파일 등록 후 시스템 브라우저도 열림. Electron 내에서 Hub WS로 탭이 자동 추가되므로 브라우저 열기는 불필요.

**근본 원인**:
`vyncOpen()`에서 서버가 이미 실행 중일 때 `info?.mode`를 확인하지 않고 항상 `openBrowserWithFile()` 호출.

**해결**:
`info?.mode !== 'electron'` 조건 추가. Electron 모드이면 파일 등록만 하고 브라우저 열기 생략.

---

### I-004

**probePort()가 mode를 항상 'daemon'으로 덮어씀**

심각도: `minor` · 상태: `resolved` · 발견일: 2026-03-14 · 해결일: 2026-03-14
컴포넌트: `tools/cli/open.ts` (probePort)

**현상**:
Electron 서버 실행 중 PID 파일이 없거나 stale일 때, `probePort()`가 포트에서 서버를 발견하면 PID 파일을 `mode: 'daemon'`으로 항상 복구. 이로 인해 Electron 서버임에도 `mode: 'daemon'`으로 기록됨.

**근본 원인**:
`probePort()`의 recoveredInfo에서 `mode: 'daemon'`으로 하드코딩.

**해결**:
`readServerInfo()`로 기존 PID 파일의 mode를 읽어서 보존. 기존 PID 파일이 없으면 `'daemon'` 기본값 사용.

---

### I-005

**Semantic Sync 확신 과대평가 — 단일축 판단 + 무검증 수용**

심각도: `major` · 상태: `open` · 발견일: 2026-03-14
컴포넌트: `agents/vync-translator.md` (Read §4), `commands/vync.md` (Read §5)

**현상**:
Semantic Sync 회귀 테스트(3라운드)에서 translator의 확신 레벨이 전 라운드 과대평가됨. F3 0/3 FAIL, 연쇄적으로 F4 1/3, F5 1/3 FAIL. 전체 8/15 (53%) → FAIL 판정.

**근본 원인**:
1. **Translator 단일축 판단**: `vync-translator.md:69-71`의 확신 기준이 행위 명확성(변경 복잡성)만 평가. D-017 설계의 2축 매트릭스(행위 × 동기)를 구현하지 않음.
2. **메인 세션 무검증 수용**: `vync.md:75-80`에서 translator 확신을 그대로 수용. 독립적 동기 명확성 평가 없음.
3. **책임 할당 비대칭**: 동기 명확성 판단에 필요한 정보(대화 전체 맥락, 유저 원문 발화)는 메인 세션에만 있으나, 확신 판단은 translator(제한된 맥락)에 할당됨.
4. **맥락 오염**: 메인 세션이 translator에게 전달하는 대화 맥락에 도메인 지식을 주입하여, translator가 유저의 모호성을 도메인 지식으로 보완 → 확신 추가 증폭.

**영향**:
- 유저의 모호한 발화("바꿔봤어")에 대해 과도하게 확신 있는 응답 생성
- 유저 의도를 사실로 단정하여 교정 기회 상실

**회귀 테스트 데이터**:

| 라운드 | 기대 확신 | 실제 확신 | 과대평가 정도 |
|--------|:--------:|:--------:|:----------:|
| A | 중간~높음 | 높음 | 미약 |
| B | 중간 | 높음 | 중간 |
| C | 낮음~중간 | 높음 | 심각 |

**해결 방향**:
→ [설계 문서](./plans/2026-03-14-semantic-sync-confidence-calibration.md) 참조. 확신 판단 책임을 Translator(해석 확신)와 메인 세션(동기 명확성)으로 분리하는 B' 접근법.

---

### I-006

**시각화 유형별 Diff 전략 필요 — 시각적 변동 미감지**

심각도: `major` · 상태: `open` · 발견일: 2026-03-14
컴포넌트: `tools/cli/diff.ts`

**현상**:
`vync diff`가 트리 위계와 텍스트 변경만 감지하고, 위치(points), 크기(width/height), 접기 상태(isCollapsed), 연결선 바인딩 변경, 스타일 변경 등 시각적 변동을 일절 감지하지 않음. Translator(시각화 전문가)가 diff를 유일한 입력으로 사용하므로, **diff가 못 보는 변경은 파이프라인 전체가 못 본다.**

**구조적 원인**:

1. **`FlatNode`의 좁은 추출 범위**: `flattenElements()`가 `id, text, parentId, type, childIds` 5개 필드만 추출. `.vync` JSON에 있는 `points`, `width`, `height`, `manualWidth`, `isCollapsed`, `strokeColor`, `source`/`target` 바인딩 등 모든 시각적 속성이 구조적으로 누락됨.

2. **`LAYOUT_FIELDS` 데드코드**: `diff.ts:35-41`에 `LAYOUT_FIELDS` Set이 정의되어 있으나 **코드 어디에서도 참조하지 않음**. `FlatNode` 추출 자체가 해당 필드를 포함하지 않으므로 필터링할 필요도 없는 상태. 설계 의도(레이아웃 필드 무시)의 흔적이나 실제 동작과 무관한 코드.

3. **마인드맵 중심 설계**: D-015에서 마인드맵(위계=시각구조)을 기준으로 diff를 설계하여, 플로우차트/자유 캔버스의 시각적 배치를 고려하지 않음.

**시각화 유형별 영향**:

| 시각화 유형 | 시각적 변동의 의미 | 현재 diff 감지 | 영향 |
|-----------|:----------------:|:------------:|:----:|
| **마인드맵** | 위치/크기는 레이아웃 엔진 자동 배치 → 사용자 의도 아님 | 위계+텍스트 감지 (충분) | 낮음 |
| **플로우차트** | 위치/크기/연결선은 사용자가 직접 배치 → 의도적 | **미감지** | **높음** |
| **자유 캔버스** | 모든 배치가 사용자 의도 | **미감지** | **높음** |

**감지 안 되는 시각적 변동 상세**:

| 사용자 행위 | .vync 필드 변경 | diff 감지 | 비고 |
|-----------|---------------|:--------:|------|
| 플로우차트 노드 이동 | `points` | X | 위치만 바뀌고 연결은 유지 |
| 노드 크기 조절 | `width`, `height`, `manualWidth` | X | 시각적 강조/축소 |
| 노드 접기/펼치기 | `isCollapsed` | X | 정보 숨기기 의도 |
| 연결선 대상 변경 | arrow-line `source`/`target` 바인딩 | X | 관계 재정의 |
| 연결선 추가/삭제 | arrow-line 요소 | O (added/removed) | 요소 존재 감지됨 |
| 텍스트 내 스타일 변경 | rich text children (bold/italic) | X | 강조 의도 |
| 도형 유형 변경 | geometry `shape` | X | 의미 전환 |

**해결 방향 — 시각화 유형별 diff 전략**:

`detectVizType()`이 이미 존재하므로(diff.ts:209), 유형별로 감지 필드를 분기하는 구조적 확장이 가능하다.

```
             detectVizType()
                  │
        ┌─────────┼──────────┐
        ▼         ▼          ▼
    mindmap    flowchart    generic
        │         │          │
  위계+텍스트   위계+텍스트   위계+텍스트
   (현재 유지)  +위치+크기   +위치+크기
               +연결 바인딩  +스타일
               +도형 유형
```

**마인드맵 위치 감지 주의**: 마인드맵에서 위치를 감지하면 자식 노드 1개 추가 시 형제 노드 전체가 재배치되어 "7개 노드 위치 변경"이 보고됨. 레이아웃 엔진 부수효과로 노이즈가 대량 발생하므로, **마인드맵은 현재 위계+텍스트 전략을 유지해야 한다.**

**구현 시 고려사항**:
- `FlatNode` 타입 확장 또는 유형별 별도 노드 타입 필요
- `computeDiff()`에 유형별 비교 로직 분기
- `enrichWithSemanticHints()`의 flowchart/generic 분기 활성화 (현재 `return changes`로 바이패스됨, diff.ts:234)
- 위치 변경의 semantic hint 설계: 좌표값 자체는 무의미 → "노드 A가 이동됨" 수준의 추상화 필요
- ~~`LAYOUT_FIELDS` 데드코드 정리~~ (완료, 2026-04-04)

---

### I-007

**React 컴포넌트 테스트 커버리지 부재**

심각도: `minor` · 상태: `resolved` · 발견일: 2026-04-04 · 해결일: 2026-04-04
컴포넌트: `apps/web/src/app/`, `packages/react-board/`, `packages/react-text/`

**현상**:
graph-view mappers를 제외하면 React 컴포넌트에 대한 테스트가 전혀 없음. `FileBoard`, `TabBar`, `App`, board hooks 모두 미테스트.

**해결**:
하이브리드 접근법 (순수 함수 추출 + RTL 렌더링 테스트):
- `computeElementDiff()` → `board-utils.ts`로 추출, 12 유닛 테스트 (remove/set/insert 3단계 각각 검증)
- `computeLabels()` → 6 유닛 테스트 (중복 basename 분기 등)
- `TabBar` → 8 RTL 렌더링 테스트 (탭 클릭, 닫기, 드롭다운, 빈 상태)
- 설계 spec: `docs/superpowers/specs/2026-04-04-react-test-coverage-design.md`

---

### I-008

**file-board.tsx 디버그 console.log 잔존**

심각도: `minor` · 상태: `resolved` · 발견일: 2026-04-04 · 해결일: 2026-04-04
컴포넌트: `apps/web/src/app/file-board.tsx`

**해결**:
3건의 `console.log`에 `import.meta.env.DEV` 가드 추가. 프로덕션 빌드에서 tree-shaken됨.

---
