import { defineRule } from '@oxlint/plugins'
import { isTest, repoPath } from '../codeBudget.ts'
import { limitFor } from './backlog.ts'

export default defineRule({
  meta: { type: 'problem', schema: [] },
  create(context) {
    if (!isTest(repoPath(context.filename))) return {}
    let count = 0
    const inspect = (node: any) => {
      const value = node.type === 'Literal' ? node.value : node.value?.raw
      if (typeof value === 'string' && /(?:^|[\\/])data[\\/](?:board\.db(?:-wal|-shm)?|vault)(?:$|[\\/])/u.test(value)) count++
    }
    return { Literal: inspect, TemplateElement: inspect, CallExpression(node) {
      const args = node.arguments
      for (let i = 0; i + 1 < args.length; i++) {
        if (args[i].type === 'Literal' && args[i].value === 'data' && args[i + 1].type === 'Literal' &&
          typeof args[i + 1].value === 'string' && /^(?:board\.db(?:-wal|-shm)?|vault)$/u.test(args[i + 1].value)) count++
      }
    }, 'Program:exit'(node) {
      const limit = limitFor('no-live-data-path', context.filename)
      if (count > limit) context.report({ node, message: `실제 데이터 경로 ${count}개가 있어요. 임시 경로를 쓰세요 (기준선 ${limit}개).` })
    } }
  },
})
