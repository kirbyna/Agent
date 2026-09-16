# Handoff: 스파이더 솔리테어 — Organic 테마 적용

대상 저장소: **kirbyna/Agent**, 브랜치 `claude/spider-solitaire-iphone-plan-gm7ehm`, 경로 `spider-solitaire/`

## Claude Code 에게 그대로 붙여넣을 지시

> `design_handoff_spider_cards/README.md` 를 읽고 `spider-theme.css` 를 spider-solitaire 에 적용해줘.
> 게임 로직은 바꾸지 말고, index.html 에 스타일시트 링크 추가 + README 의 선택 패치 2건만 반영해줘.

## 적용 순서 (3단계, 로직 변경 없음)

1. `spider-theme.css` 를 `spider-solitaire/public/spider-theme.css` 로 복사
   (`public/` 이 없으면 만들거나, `src/` 에 두고 `main.ts` 상단에서 `import "./spider-theme.css"`)
2. `spider-solitaire/index.html` 의 `</style>` **바로 다음 줄**에 추가 — 순서가 중요합니다(뒤에 와야 덮어씀)
   ```html
   <link rel="stylesheet" href="/spider-theme.css" />
   ```
3. `src/main.ts` 선택 패치 2건 (CSS 파일 맨 아래 주석에 원문/변경본이 그대로 적혀 있음)
   - **4수트 색상 매핑**: `isRedSuit()` 2색 분기 → `SUIT_COLOR` 4색 맵.
     `renderTableau()` 와 `beginDragVisuals()` 두 곳 모두 수정
   - **겹침 기본값**: `DEFAULT_CARD_OVERLAP 0.58 → 0.82`, `MAX_CARD_OVERLAP 0.86 → 0.9`

폰트는 CSS 첫 줄 `@import` 가 처리합니다. index.html 의 Fraunces / IBM Plex Sans `<link>` 는 지워도 됩니다.

## 이 테마가 바꾸는 것

**색 (토큰만 교체 — 기존 var() 참조가 그대로 살아남습니다)**

| 토큰 | 기존 | 변경 |
|---|---|---|
| `--felt-900 / 800 / radial` | 딥그린 `#0a3320 / #123f28 / #175231` | 세이지 `#1b2113 / #2b3320 / #3d472b` |
| `--surface` | `#0d2c1e` | `#262e1c` |
| `--card-face` | `#f7f2e7` | `#f9f4ed` |
| `--card-back-1 / 2` | 버건디 `#7a2230 / #4c1620` | 테라코타 `#c9743d / #8c491a` |
| `--wood-1 / 2` | `#5b3a24 / #34210f` | `#6b3a17 / #402310` |
| `--gold` / `--gold-ink` | `#dcae44` / `#2a2205` | `#d67f48` / `#fff2eb` |
| `--red-suit` / `--black-suit` | `#b3392c` / `#16201a` | `#8c491a` / `#2e2b25` |
| (신규) `--club-suit` / `--diamond-suit` | — | `#7d8f5f` / `#c9743d` |
| `--font-display` | Fraunces | **Caprasimo** |
| `--font-body` | IBM Plex Sans | **Figtree** |

**형태·여백**

| 항목 | 기존 | 변경 | 이유 |
|---|---|---|---|
| 카드 라운드 | `4px` | `9px` | 시스템 전체가 과하게 둥근 기조 |
| 카드 테두리/그림자 | `0 2px 4px rgba(0,0,0,.35)` | `1px solid rgba(32,30,29,.14)` + `0 1.5px 3px rgba(32,30,29,.22)` | 밝은 펠트에서 카드가 붕 뜨지 않게 |
| `--card-overlap` | `58%` | `82%` | 노출 띠를 약 21px 로 조여 열 전체가 한 화면에 |
| `.tableau` gap / padding | `2px` / `10px 5px 6px` | `3px` / `10px 6px 6px` | 카드 사이 숨 |
| 빈 열 표시 | `2px dashed` / `5px` | `1.5px dashed rgba(240,250,225,.17)` / `9px` | 카드 라운드와 일치 |
| 버튼 라운드 | `10~16px` | `999px` (알약) | 시스템 규칙 |
| 오버레이 카드 | `18px` | `28px` | 컨테이너 라운드 |

**카드 앞면 — 가장 중요한 변경**

`.idx` 를 가운데 정렬(`justify-content:center`)에서 **좌우 분산**으로 바꿉니다.

```css
.idx { top:2px; left:4px; right:4px; height:19px;
       justify-content:space-between; align-items:center;
       font:400 19px/1 "Caprasimo"; letter-spacing:-.04em }
.idx span:last-child { font:800 13px/1 "Figtree" }   /* 수트 — 띠 오른쪽 */
.idx.wide { font-size:17px; letter-spacing:-.06em }  /* "10" */
```

스파이더는 카드가 거의 항상 겹칩니다. 노출되는 **상단 19px 띠 안에 숫자(왼쪽)와 수트(오른쪽)를 가로로 나란히** 두면, 열 전체가 위에서 아래로 한 번에 읽힙니다. `.center-mark` 는 중앙 심볼에서 **우하단 워터마크(46px, opacity .13)** 로 내려가, 완전히 보이는 맨 아래 카드에서만 읽히며 열의 끝을 알려줍니다.

**뒷면** — 버건디 해치 → 테라코타 바탕 + 세이지 점무늬(`6px` 그리드) + 크림 내부 링. 뒷면은 몇 px 만 노출되므로 무늬는 작고 촘촘해야 합니다.

**힌트** — 초록 outline → 테라코타 라이트(`#f6a06b`) outline + 1.1s 글로우 펄스. 드롭 가능 열은 `rgba(214,127,72,.2)` 로 채워집니다.

## 손대지 않는 것

게임 로직(`src/core/*`), 규칙, 점수(500 시작 / 이동 −1 / 완성 +100), 하우스 룰(빈 열 있어도 딜 가능), 사운드, 저장·이어하기, FLIP 애니메이션, 테스트 — 전부 그대로입니다. 이 작업은 **보기(뷰)만** 바꿉니다.

## Files

| 파일 | 용도 |
|---|---|
| `spider-theme.css` | **적용 대상.** index.html 뒤에 링크. 파일 맨 아래 주석에 선택 패치 원문이 있습니다 |
| `spider-solitaire-reference.html` | 브라우저로 여는 동작 시안(별도 프로토타입). 카드 스타일·수트 색·겹침 기준을 눈으로 확인하는 용도 — 이 파일을 저장소에 넣지는 마세요 |

## 확인 방법

`npm run dev` 후 iPhone 너비(390px)에서:
- 가장 긴 열이 하단 바를 넘지 않는지
- 겹친 카드의 숫자·수트가 전부 읽히는지
- 4수트에서 ♠♣♥♦ 가 서로 다른 색으로 보이는지
- 드래그 시 카드가 살짝 기울고(2.5°) 드롭 가능 열이 테라코타로 차는지
