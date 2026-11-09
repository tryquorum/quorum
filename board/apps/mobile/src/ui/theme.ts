import { DynamicColorIOS, StyleSheet } from 'react-native'
import { color, radius, text, type ColorName } from '@direction-board/design-tokens'

// 색은 공유 디자인 토큰에서 와요(웹과 같은 값). DynamicColorIOS 로 라이트·다크 값을 함께 주면 시스템 모양이 바뀔 때
// 다시 그리지 않아도 따라가요(GAP-14). 바탕은 라이트에선 옅은 회색 위 흰 묶음, 다크에선 검정 위 짙은 묶음.
// 왼쪽 세로 장식선(왼쪽 테두리·표시선·타임라인 줄)은 쓰지 않아요. 위계는 여백·글자 무게·바탕으로(docs/internals/mobile-ia.md).
const dyn = (light: ColorName, dark: ColorName = light) => DynamicColorIOS({ light: color.light[light], dark: color.dark[dark] })
export const colors = {
  ink: dyn('foreground'),
  muted: dyn('muted-foreground'),
  line: dyn('border'),
  page: dyn('muted', 'background'),
  card: dyn('card'),
  /** 옅은 바탕(칩·인용·코드·AI 결과). 라이트 화면 바탕(muted)과 카드(흰색) 어느 위에서도 보이게 border 단계 */
  fill: dyn('border', 'secondary'),
  input: dyn('input'),
  // 조작 경계(테두리 단추·입력)는 장식 선(border)이 아니라 control(배경 대비 3:1 이상, 토큰 시험)
  control: dyn('control'),
  primary: dyn('primary'),
  onPrimary: dyn('primary-foreground'),
  // 의미 색: 점·아이콘은 기본 값, 글자는 *-foreground(design-core.md)
  decide: dyn('decide'),
  done: dyn('done'),
  doneText: dyn('done-foreground'),
  warn: dyn('warn'),
  warnText: dyn('warn-foreground'),
  running: dyn('running'),
  ai: dyn('ai'),
  aiText: dyn('ai-foreground'),
}
export type Tone = 'neutral' | 'decide' | 'done' | 'warn' | 'running' | 'ai'
export const toneDot: Record<Tone, ReturnType<typeof dyn>> = {
  neutral: colors.muted,
  decide: colors.decide,
  done: colors.done,
  warn: colors.warn,
  running: colors.running,
  ai: colors.ai,
}

/** 내비게이션(머리·탭 필)처럼 색을 계산하는 곳에 줄 보통 문자열 색 */
export const schemeColors = (scheme: 'light' | 'dark') => {
  const c = color[scheme]
  return { ink: c.foreground, muted: c['muted-foreground'], line: c.border, page: scheme === 'dark' ? c.background : c.muted, card: c.card, primary: c.primary }
}

/** 간격(4pt 단위)과 누름 영역 */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, gutter: 16, target: 44 } as const

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: space.gutter, paddingTop: space.sm, gap: space.xl },
  text: { color: colors.ink, fontSize: text.base[0], lineHeight: text.base[1] },
  strong: { color: colors.ink, fontSize: text.base[0], lineHeight: text.base[1], fontWeight: '600' },
  meta: { color: colors.muted, fontSize: text.sm[0], lineHeight: text.sm[1] },
  small: { color: colors.muted, fontSize: text.xs[0], lineHeight: text.xs[1] },
  heading: { color: colors.ink, fontSize: text.lg[0], lineHeight: text.lg[1], fontWeight: '700' },
  /** 묶음: 테두리 없는 둥근 바탕 */
  group: { backgroundColor: colors.card, borderRadius: radius.xl, overflow: 'hidden' },
  /** 묶음 안 행 사이: 들여쓴 가는 가로 구분선 */
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: space.gutter },
  /** 입력칸: 글자 16pt, 높이 44pt 이상 */
  input: {
    minHeight: space.target,
    backgroundColor: colors.card,
    borderColor: colors.input,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: text.base[0],
  },
})
