# Handoff: 스파이더 솔리테어 — Crisp Classic 테마 적용

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
   - **수트 색**: 수정 불필요 — 참고 이미지처럼 검정/빨강 2색만 쓰므로 기존 `isRedSuit()` 분기를 그대로 둡니다 (토큰만 `#c8102e` / `#111111` 로 바뀜)
   - **겹침 기본값**: `DEFAULT_CARD_OVERLAP 0.58 → 0.82`, `MAX_CARD_OVERLAP 0.86 → 0.9`

폰트는 CSS 첫 줄 `@import` (Figtree 400~900) 가 처리합니다. index.html 의 Fraunces / IBM Plex Sans `<link>` 는 지워도 됩니다.

## 이 테마가 바꾸는 것

**색 (토큰만 교체 — 기존 var() 참조가 그대로 살아남습니다)**

| 토큰 | 기존 | 변경 |
|---|---|---|
| `--felt-900 / 800 / radial` | 딥그린 `#0a3320 / #123f28 / #175231` | 밝은 초록 `#0f6b2e / #1a8a3f / #2aa04c` |
| `--surface` | `#0d2c1e` | `#0d5524` |
| `--card-face` | `#f7f2e7` | **`#ffffff`** |
| `--card-back-1 / 2` | 버건디 `#7a2230 / #4c1620` | 붉은 격자 `#c9313a / #8f1a22` |
| `--wood-1 / 2` | `#5b3a24 / #34210f` | 초록 `#0d5524 / #08401b` |
| `--gold` / `--gold-ink` | `#dcae44` / `#2a2205` | `#f2c230` / `#2a2205` |
| `--red-suit` / `--black-suit` | `#b3392c` / `#16201a` | **`#c8102e` / `#111111`** (순빨강 / 순검정) |
| `--font-display` | Fraunces | **Figtree 800** (숫자도 본문 서체의 굵은 단계로) |
| `--font-body` | IBM Plex Sans | **Figtree** |

**형태·여백**

| 항목 | 기존 | 변경 | 이유 |
|---|---|---|---|
| 카드 라운드 | `4px` | `5px` | 참고 이미지처럼 각진 카드 |
| 카드 테두리/그림자 | `0 2px 4px rgba(0,0,0,.35)` | `1px solid rgba(0,0,0,.3)` + `0 1.5px 3px rgba(0,0,0,.32)` | 초록 위에서 카드 윤곽이 또렷하게 |
| `--card-overlap` | `58%` | `82%` | 노출 띠를 약 21px 로 조여 열 전체가 한 화면에 |
| `.tableau` gap / padding | `2px` / `10px 5px 6px` | `3px` / `10px 6px 6px` | 카드 사이 숨 |
| 빈 열 표시 | `2px dashed` / `5px` | `1.5px dashed rgba(255,255,255,.17)` / `5px` | 카드 라운드와 일치 |
| 버튼 라운드 | `10~16px` | `999px` (알약) | 손가락 타깃 |
| 오버레이 카드 | `18px` | `28px` | 컨테이너 라운드 |

**카드 앞면 — 가장 중요한 변경**

`.idx` 를 가운데 정렬(`justify-content:center`)에서 **좌우 분산**으로 바꿉니다.

```css
.idx { top:2px; left:4px; right:4px; height:19px;
       justify-content:space-between; align-items:center;
       font:800 20px/1 "Figtree"; letter-spacing:-.05em }
.idx span:last-child { font:800 13px/1 "Figtree" }   /* 수트 — 띠 오른쪽 */
.idx.wide { font-size:18px; letter-spacing:-.07em }  /* "10" */
```

스파이더는 카드가 거의 항상 겹칩니다. 노출되는 **상단 19px 띠 안에 숫자(왼쪽)와 수트(오른쪽)를 가로로 나란히** 두면, 열 전체가 위에서 아래로 한 번에 읽힙니다. `.center-mark` 는 **띠 아래(top 22px)에 34px 불투명 대형 수트**로 들어가 — 완전히 보이는 맨 아래 카드에서 열의 끝을 또렷하게 알려줍니다.

**뒷면 = A안 (붉은 격자 + 중앙 로고)** — 붉은 바탕(`#c9313a → #8f1a22`) + 흰 3px 교차 격자 + 중앙 마름모 메달리온. `.card.face-down::after` 와 `.stock-card::after` 가 그 메달리온을 그립니다.

로고 이미지를 쓰려면 파일 하나 넣고 한 줄만 켜면 됩니다:

```
1) spider-solitaire/public/card-logo.svg  (또는 .png, 정사각 권장)
2) spider-theme.css 의 :root 에서 주석 해제 →  --card-logo: url("/card-logo.svg");
```

로고를 안 넣어도 메달리온만으로 완결된 모양이므로 지금 상태로 바로 써도 됩니다. 마름모 모양을 원치 않으면 `--card-logo-clip: none`, 크기는 `--card-logo-size` (기본 58%) 로 조절합니다.

**힌트** — 초록 펠트 위에서는 초록 하이라이트가 안 보이므로 **골드(`#f2c230`)** outline + 1.1s 글로우 펄스. 드롭 가능 열은 `rgba(242,194,48,.22)` 로 채워집니다.

**J · Q · K** — 참고 이미지처럼 궁정 카드에 그림이 들어갑니다. 현재는 금·적·청 3단 블록으로 자리만 잡아둔 상태이니, 실제 그림 파일을 받으면 `.card.court` 규칙으로 교체해 드립니다.

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
- 완전히 보이는 맨 아래 카드의 대형 수트가 숫자 띠와 겹치지 않는지
- 드래그 시 카드가 살짝 기울고(2.5°) 드롭 가능 열이 테라코타로 차는지
