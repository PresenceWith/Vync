import { Translations } from '../types';

const koTranslations: Translations = {
  // Toolbar items
  'toolbar.hand': '손 도구 — H',
  'toolbar.selection': '선택 — V',
  'toolbar.mind': '마인드맵 — M',
  'toolbar.text': '텍스트 — T',
  'toolbar.arrow': '화살표 — A',
  'toolbar.shape': '도형',
  'toolbar.image': '이미지 — Cmd+U',
  'toolbar.extraTools': '추가 도구',

  'toolbar.pen': '펜 — P',
  'toolbar.eraser': '지우개 — E',

  'toolbar.arrow.straight': '직선 화살표',
  'toolbar.arrow.elbow': '꺾인 화살표',
  'toolbar.arrow.curve': '곡선 화살표',

  'toolbar.shape.rectangle': '직사각형 — R',
  'toolbar.shape.ellipse': '타원 — O',
  'toolbar.shape.triangle': '삼각형',
  'toolbar.shape.terminal': '터미널',
  'toolbar.shape.noteCurlyLeft': '왼쪽 중괄호 메모',
  'toolbar.shape.noteCurlyRight': '오른쪽 중괄호 메모',
  'toolbar.shape.diamond': '마름모',
  'toolbar.shape.parallelogram': '평행사변형',
  'toolbar.shape.roundRectangle': '둥근 직사각형',

  // Zoom controls
  'zoom.in': '확대 — Cmd++',
  'zoom.out': '축소 — Cmd+-',
  'zoom.fit': '화면에 맞추기',
  'zoom.100': '100%로 확대',

  // Themes
  'theme.default': '기본',
  'theme.colorful': '컬러풀',
  'theme.soft': '소프트',
  'theme.retro': '레트로',
  'theme.dark': '다크',
  'theme.starry': '별빛',

  // Colors
  'color.none': '테마 색상',
  'color.unknown': '기타 색상',
  'color.default': '기본 검정',
  'color.white': '흰색',
  'color.gray': '회색',
  'color.deepBlue': '짙은 파랑',
  'color.red': '빨강',
  'color.green': '초록',
  'color.yellow': '노랑',
  'color.purple': '보라',
  'color.orange': '주황',
  'color.pastelPink': '파스텔 핑크',
  'color.cyan': '청록',
  'color.brown': '갈색',
  'color.forestGreen': '짙은 초록',
  'color.lightGray': '밝은 회색',

  // General
  'general.undo': '실행 취소',
  'general.redo': '다시 실행',
  'general.menu': '앱 메뉴',
  'general.duplicate': '복제',
  'general.delete': '삭제',

  // Language
  'language.switcher': '언어',
  'language.chinese': '中文',
  'language.english': 'English',
  'language.russian': 'Русский',
  'language.arabic': 'عربي',
  'language.vietnamese': 'Tiếng Việt',
  'language.korean': '한국어',

  // Menu items
  'menu.open': '열기',
  'menu.saveFile': '파일 저장',
  'menu.exportImage': '이미지 내보내기',
  'menu.exportImage.svg': 'SVG',
  'menu.exportImage.png': 'PNG',
  'menu.exportImage.jpg': 'JPG',
  'menu.cleanBoard': '보드 지우기',
  'menu.github': 'GitHub',

  // Dialog translations
  'dialog.mermaid.title': 'Mermaid 가져오기',
  'dialog.mermaid.description': '현재 지원하는 유형:',
  'dialog.mermaid.flowchart': '순서도',
  'dialog.mermaid.sequence': '시퀀스 다이어그램',
  'dialog.mermaid.class': '클래스 다이어그램',
  'dialog.mermaid.otherTypes':
    ', 그 외 다이어그램 유형은 이미지로 렌더링됩니다.',
  'dialog.mermaid.syntax': 'Mermaid 문법',
  'dialog.mermaid.placeholder': '여기에 Mermaid 차트 정의를 작성하세요…',
  'dialog.mermaid.preview': '미리보기',
  'dialog.mermaid.insert': '삽입',
  'dialog.markdown.description':
    'Markdown 문법을 마인드맵으로 자동 변환합니다.',
  'dialog.markdown.syntax': 'Markdown 문법',
  'dialog.markdown.placeholder': '여기에 Markdown 텍스트를 작성하세요...',
  'dialog.markdown.preview': '미리보기',
  'dialog.markdown.insert': '삽입',
  'dialog.error.loadMermaid': 'Mermaid 라이브러리 로드 실패',

  // Extra tools menu items
  'extraTools.mermaidImport': 'Mermaid 가져오기',
  'extraTools.markdownImport': 'Markdown 가져오기',

  // Clean confirm dialog
  'cleanConfirm.title': '보드 지우기',
  'cleanConfirm.description':
    '보드 전체가 지워집니다. 계속하시겠습니까?',
  'cleanConfirm.cancel': '취소',
  'cleanConfirm.ok': '확인',

  // Link popup items
  'popupLink.delLink': '링크 삭제',

  // Tool popup items
  'popupToolbar.fillColor': '채우기 색상',
  'popupToolbar.fontSize': '글꼴 크기',
  'popupToolbar.fontColor': '글꼴 색상',
  'popupToolbar.link': '링크 삽입',
  'popupToolbar.stroke': '테두리',
  'popupToolbar.opacity': '불투명도',

  // Text placeholders
  'textPlaceholders.link': '링크',
  'textPlaceholders.text': '텍스트',

  // Line tool
  'line.source': '시작점',
  'line.target': '끝점',
  'line.arrow': '화살표',
  'line.none': '없음',

  // Stroke style
  'stroke.solid': '실선',
  'stroke.dashed': '파선',
  'stroke.dotted': '점선',

  //markdown example
  'markdown.example': `# 시작합니다

  - 이 버그 누가 만들었나 볼까 🕵️ ♂️ 🔍
    - 😯 💣
      - 알고 보니 나였다 👈 🎯 💘

  - 갑자기 실행이 안 된다, 왜일까 🚫 ⚙️ ❓
    - 갑자기 실행이 된다, 왜일까? 🎢 ✨
      - 🤯 ⚡ ➡️ 🎉

  - 실행되는 코드는 🐞 🚀
    - 건드리지 마라 🛑 ✋
      - 👾 💥 🏹 🎯

  ## 남자일까 여자일까 👶 ❓ 🤷 ♂️ ♀️

  ### Hello world 👋 🌍 ✨ 💻

  #### 와, 개발자다 🤯 ⌨️ 💡 👩 💻`,

  // Draw elements text
  'draw.lineText': '텍스트',
  'draw.geometryText': '텍스트',

  // Mind map elements text
  'mind.centralText': '중심 주제',
  'mind.abstractNodeText': '요약',

  'tutorial.title': 'Vync',
  'tutorial.description':
    '마인드맵, 순서도, 자유 그리기 등을 포함한 올인원 화이트보드',
  'tutorial.dataDescription': '모든 데이터는 브라우저에 로컬로 저장됩니다',
  'tutorial.appToolbar': '내보내기, 언어 설정, ...',
  'tutorial.creationToolbar': '도구를 선택하여 작업을 시작하세요',
  'tutorial.themeDescription': '밝은 테마와 어두운 테마 전환',
};

export default koTranslations;
