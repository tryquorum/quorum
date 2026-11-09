// Workspace 색 규칙: 기본은 흰·회색 한 톤이에요. 연한 틴트 배경 + 같은 계열 글자(투톤)는 쓰지 않아요.
// 사람이 꼭 봐야 하는 것(보류·escalate·기한 지남·실패·Needs you 수·REPLAY)만 빨간 바탕에 흰 글씨.
// red-600(#e7000b)은 흰 글씨와 대비 약 4.6:1 로 WCAG AA 를 넘어요(--destructive #ff6467 은 약 2.8:1 이라 바탕으로 쓰지 않아요).
export const ALERT = "bg-red-600 text-white"
/** 보통 칩: 테두리만, 글자는 흐리게 */
export const CHIP = "border border-border text-muted-foreground"
