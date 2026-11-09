import { defineRule } from '@oxlint/plugins'
import { isTest, repoPath } from '../codeBudget.ts'
import { limitFor } from './backlog.ts'

export default defineRule({
  meta: { type: 'problem', schema: [] },
  create(context) {
    const file = repoPath(context.filename)
    if (!/(?:^|\/)(?:web\/src\/components|apps\/mobile\/src)\//u.test(file) || /(?:^|\/)apps\/mobile\/src\/api\//u.test(file) || isTest(file)) return {}
    let count = 0
    return { CallExpression(node: any) {
      const callee = node.callee
      if ((callee.type === 'Identifier' && callee.name === 'fetch') ||
          (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'fetch' &&
           callee.object.type === 'Identifier' && ['window', 'globalThis'].includes(callee.object.name))) count++
    }, 'Program:exit'(node) {
      const limit = limitFor('no-direct-fetch', context.filename)
      if (count > limit) context.report({ node, message: `직접 fetch 호출이 ${count}개예요. API 모듈을 쓰세요 (기준선 ${limit}개).` })
    } }
  },
})
