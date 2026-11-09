// 출처: board/packages/contracts/src/text.ts (방향판 2ee6e8a) 의 normTitle·SAME_TITLE_MIN 만.
/** 같은 일 판정용 제목: NFC, 소문자, 공백·문장부호·기호 제거. 서버 dedup 과 웹 빠른 추가가 같은 규칙을 써요 */
export const normTitle = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")
/** 비교할 글자가 이보다 적으면 잘못 합칠 수 있어 같은 일로 보지 않아요 */
export const SAME_TITLE_MIN = 4
