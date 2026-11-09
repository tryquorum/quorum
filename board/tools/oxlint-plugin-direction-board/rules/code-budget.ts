import { defineRule } from '@oxlint/plugins'
import { assertionKind, countLines, isTest, maxLines, readBaseline, repoPath } from '../codeBudget.ts'

export default defineRule({
  meta: { type: 'problem', schema: [] },
  create(context) {
    const file = repoPath(context.filename)
    const budget = readBaseline()[file] ?? {}
    const counts = { nonNull: 0, asAny: 0 }
    const record = (node: any) => { const kind = assertionKind(node); if (kind) counts[kind]++ }
    return {
      TSNonNullExpression: record, TSAsExpression: record, TSTypeAssertion: record,
      'Program:exit'(node) {
        const lines = countLines(context.sourceCode.text)
        const limit = Math.max(maxLines, budget.lines ?? 0)
        if (lines > limit) context.report({ node, message: `파일이 ${lines}줄이에요. 상한은 ${limit}줄이에요.` })
        if (isTest(file)) return
        for (const kind of ['nonNull', 'asAny'] as const) {
          const limit = budget[kind] ?? 0
          if (counts[kind] > limit) context.report({ node, message: `${kind}: ${counts[kind]}개예요. 기준선은 ${limit}개예요.` })
        }
      },
    }
  },
})
