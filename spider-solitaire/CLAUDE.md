# 디자인 동기화 규칙 (스파이더 솔리테어)

이 저장소의 **디자인은 외부 디자인 도구에서 관리**되고, 결과물은 항상
`design_handoff_spider_cards/` 폴더로 들어온다.

## "디자인 적용해줘" 라고 하면 (매번 이 순서로)

1. `design_handoff_spider_cards/README.md` 를 읽는다. (내용이 매번 갱신됨 — 기억에 의존하지 말고 다시 읽을 것)
2. `design_handoff_spider_cards/spider-theme.css` 를 `spider-solitaire/public/spider-theme.css` 로 복사(덮어쓰기).
3. `spider-solitaire/index.html` 의 `</style>` 바로 다음 줄에 링크가 있는지 확인, 없으면 추가:
   `<link rel="stylesheet" href="/spider-theme.css" />`
4. README 의 "선택적 소스 패치" 항목을 확인해 `src/main.ts` 에 반영한다.
   (이미 반영돼 있으면 건너뛴다. 값이 바뀌었으면 새 값으로 갱신)
5. `npm run build` 와 `npm test` 로 깨지지 않았는지 확인한다.
6. 커밋 후 **현재 브랜치에 푸시**한다. 커밋 메시지: `design: Organic 테마 적용 (<날짜>)`
7. 마지막에 **커밋 URL** 과 바꾼 파일 목록을 한 줄로 알려준다.

## 지켜야 할 경계

- 게임 로직(`src/core/*`), 규칙, 점수, 테스트는 **수정 금지**. 보기(뷰)만 바꾼다.
- `design_handoff_spider_cards/spider-solitaire-reference.html` 은 참고용 시안이다.
  저장소 빌드에 포함하지 말고, 여기서 코드를 베껴오지도 말 것.
- 디자인 값(색·크기·여백)을 임의로 "개선"하지 않는다. README 에 적힌 값이 기준이다.
- CSS 는 `index.html` 의 `<style>` **뒤에** 와야 덮어쓴다. 순서를 바꾸지 말 것.
