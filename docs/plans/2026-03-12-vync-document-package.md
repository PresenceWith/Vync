# .vync Document Package (번들 포맷 전환)

> 상태: **미결정** — 아키텍처 전환 여부 결정 필요

## 배경

현재 `.vync` = 단일 JSON 파일. 사용자가 원하는 것: `.vync` 확장자가 macOS Document Package(디렉토리 번들)로 동작하여, Finder에서 더블클릭 시 Electron이 열리고 내부 캔버스 목록을 표시.

## 목표 구조

```
project.vync/              ← Finder에서는 단일 "파일"로 보임
├── manifest.json          ← 메타데이터 (이름, 버전, 캔버스 순서 등)
├── canvas-a.json          ← 개별 캔버스 (기존 VyncFile JSON 포맷)
├── canvas-b.json
└── ...
```

- macOS: `LSTypeIsPackage: true` UTI 선언 → Finder가 디렉토리를 불투명 파일로 표시
- 참고: Pages(`.pages`), Keynote(`.key`), Xcode(`.xcodeproj`)와 동일한 패턴

## Breaking Change

**기존 단일 `.vync` JSON 파일 워크플로우가 완전히 깨짐.** 같은 확장자가 파일→디렉토리로 바뀌므로:

- 기존 `.vync` 파일 마이그레이션 필수 (파일 → 디렉토리 변환)
- Hub Server, FileRegistry, CLI, Electron, 프론트엔드 전체 수정
- chokidar 감시 대상 변경 (단일 파일 → 디렉토리 내 파일들)
- `/vync` 커맨드, vync-translator sub-agent 경로 체계 변경

## 영향 범위

| 영역 | 변경 | 규모 |
|------|------|------|
| `electron-builder.yml` | UTI: `LSTypeIsPackage: true`, `conforms-to: com.apple.package` | 소 |
| `tools/electron/main.ts` | `open-file`에서 디렉토리 수신 → 내부 스캔 | 중 |
| `tools/server/server.ts` | 번들 단위 파일 관리, API 경로 변경 | 대 |
| `tools/server/file-registry.ts` | 번들(디렉토리) 기반 등록/감시 | 대 |
| `apps/web/` | 캔버스 리스트 UI (번들 진입 시 목록 먼저 표시) | 대 |
| `tools/cli/` | `vync init` → 번들 디렉토리 생성, 경로 체계 변경 | 중 |
| `packages/shared/` | VyncFile 타입, WsMessage 경로 체계 | 중 |
| `commands/vync.md` | 서브커맨드 경로 변경 | 소 |
| `agents/vync-translator.md` | 파일 경로 → 번들 내 캔버스 경로 | 소 |

## 결정 사항

1. **내부 캔버스 확장자**: `.json`? `.canvas`? (기존 VyncFile 포맷은 동일, 확장자만 결정)
2. **manifest.json 스키마**: 어떤 메타데이터를 포함할 것인가
3. **마이그레이션 전략**: 자동 변환 스크립트? 수동?
4. **Finder 패키지 동작 수용 여부**: 내부가 숨겨지는 것이 의도에 맞는지 (우클릭 → "패키지 내용 보기"만 가능)
5. **현재 Hub Server 아키텍처와의 관계**: 번들 = 프로젝트 단위? 멀티 번들 동시 열기?
