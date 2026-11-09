// Workspace 색 규칙 (cxc-dev-uiux-design color-system: hue budget, semantic colors).
// 기본은 흰·회색 한 톤이에요. 연한 틴트 배경 + 같은 계열 글자(투톤)는 쓰지 않아요.
// 강조를 색 하나에 몰지 않아요: 결정이 필요한 것은 색 대신 대비(반전된 중립 칩)로,
// 빨강은 실제 위험(기한 지남·실패·오류)에만 글자/테두리로 써요. 진한 빨간 바탕은 쓰지 않아요.
/** 결정이 필요해요: Needs you 수, 보류(hold), escalate */
export const DECIDE = "bg-foreground text-background"
/** 기한이 지났어요: 빨간 글자만 */
export const LATE = "text-red-400"
/** 실패·오류: 빨간 테두리 + 빨간 글자, 바탕 없음 */
export const ALERT = "border border-red-500/45 text-red-400"
/** 보통 칩: 테두리만, 글자는 흐리게 */
export const CHIP = "border border-border text-muted-foreground"
