import { describe, expect, test } from 'bun:test'
import { color, type ColorName, type Scheme } from './index.ts'
import { contrast, over } from './contrast.ts'

// 실제로 놓이는 앞색·바탕 쌍의 대비를 고정해요. 글자는 4.5, 조작 경계·포커스 링·상태 점과 아이콘은 3.0 (WCAG 1.4.3, 1.4.11).
const TEXT: ColorName[] = ['foreground', 'muted-foreground', 'ai-foreground', 'running-foreground', 'done-foreground', 'warn-foreground', 'decide']
const MARK: ColorName[] = ['control', 'ring', 'done', 'running', 'warn', 'ai', 'decide', 'no-area']
const SURFACES: ColorName[] = ['background', 'card', 'muted', 'sidebar', 'sidebar-accent']
// 반투명 틴트 위 글자: [글자, 틴트, 알파]
const TINTED: [ColorName, ColorName, number][] = [['ai-foreground', 'ai', 0.1], ['done-foreground', 'done', 0.1], ['warn-foreground', 'warn', 0.05], ['decide', 'decide', 0.1]]

for (const scheme of ['light', 'dark'] as Scheme[]) {
  const c = color[scheme]
  describe(scheme, () => {
    for (const bg of SURFACES) {
      for (const fg of TEXT) test(`글자 ${fg} / ${bg} ≥ 4.5`, () => expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5))
      for (const fg of MARK) test(`표시 ${fg} / ${bg} ≥ 3`, () => expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(3))
    }
    for (const [fg, tint, alpha] of TINTED) {
      for (const bg of SURFACES) {
        test(`틴트 위 ${fg} / ${tint}·${alpha} on ${bg} ≥ 4.5`, () => expect(contrast(c[fg], over(c[tint], c[bg], alpha))).toBeGreaterThanOrEqual(4.5))
      }
    }
    test('사이드바 선택 행 글자 ≥ 4.5', () => expect(contrast(c['sidebar-accent-foreground'], c['sidebar-accent'])).toBeGreaterThanOrEqual(4.5))
    test('주 단추 글자 ≥ 4.5', () => expect(contrast(c['primary-foreground'], c.primary)).toBeGreaterThanOrEqual(4.5))
    // 스크롤 막대는 평소엔 옅고(장식), 가리키거나 스크롤하는 동안의 손잡이는 조작 표시라 놓이는 바탕 대비 3:1 이상
    for (const bg of [...SURFACES, 'popover'] as ColorName[]) test(`스크롤 손잡이(활성) / ${bg} ≥ 3`, () => expect(contrast(c['scrollbar-active'], c[bg])).toBeGreaterThanOrEqual(3))
  })
}

test('라이트·다크가 같은 이름을 가져요', () => {
  expect(Object.keys(color.dark).sort()).toEqual(Object.keys(color.light).sort())
})

