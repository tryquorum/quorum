import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineRule } from '@oxlint/plugins'
import { isTest, repoPath } from '../codeBudget.ts'

// 디자인 토큰을 거치지 않은 값(팔레트 직접 색, 임의 글자 크기, 색 리터럴)을 막아요. 규칙과 이유: docs/internals/design-core.md
// 기준선은 파일별 "남겨 둔 정확한 토큰 목록"이에요. 찾은 것과 기준선을 멀티셋으로 맞춰서, 새 것도, 사라졌는데 기준선에 남은 것도 보고해요.
const baseline: Record<string, string[]> = JSON.parse(readFileSync(resolve(import.meta.dirname, '../raw-style-baseline.json'), 'utf8'))

const PALETTE = /(?:^|:|!)(?:bg|text|border|ring|fill|stroke|outline|decoration|from|via|to|shadow|divide|placeholder|caret|accent)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d+)?!?$/u
const ARBITRARY_TEXT = /(?:^|:)text-\[\d+(?:\.\d+)?(?:px|rem)\]!?$/u
const HEX_ONLY = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu
const COLOR_FN_ONLY = /^(?:rgba?|hsla?|oklch)\([^)]*\)$/iu
const ARBITRARY_COLOR = /(?:^|:)!?[a-z-]+-\[(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch)\()/iu
const CSS_LIKE = /[a-z-]+\s*:\s*[^;{}]+;/iu
const CSS_COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|oklch)\(/giu

export function rawStyleTokens(text: string): string[] {
  const found: string[] = []
  const whole = text.trim()
  if (HEX_ONLY.test(whole) || COLOR_FN_ONLY.test(whole)) return [whole]
  if (CSS_LIKE.test(text)) for (const m of text.matchAll(CSS_COLOR)) found.push(m[0])
  for (const token of text.split(/\s+/u)) if (token && (PALETTE.test(token) || ARBITRARY_TEXT.test(token) || ARBITRARY_COLOR.test(token))) found.push(token)
  return found
}

export default defineRule({
  meta: { type: 'problem', schema: [] },
  create(context) {
    const file = repoPath(context.filename)
    if (!/(?:^|\/)(?:web\/src|mobile\/src)\//u.test(file) || isTest(file)) return {}
    const hits: { token: string; node: any }[] = []
    const inspect = (node: any) => {
      const value = node.type === 'Literal' ? node.value : node.value?.raw
      if (typeof value === 'string') for (const token of rawStyleTokens(value)) hits.push({ token, node })
    }
    return { Literal: inspect, TemplateElement: inspect, 'Program:exit'(program) {
      const left = new Map<string, number>()
      for (const token of baseline[file] ?? []) left.set(token, (left.get(token) ?? 0) + 1)
      for (const { token, node } of hits) {
        const n = left.get(token) ?? 0
        if (n > 0) left.set(token, n - 1)
        else context.report({ node, message: `토큰을 거치지 않은 값 "${token}"이에요. 디자인 토큰(bg-done, text-2xs 등)을 쓰세요.` })
      }
      for (const [token, n] of left) for (let i = 0; i < n; i++) context.report({ node: program, message: `"${token}"이 이제 없어요. raw-style-baseline.json 에서 지우세요.` })
    } }
  },
})

