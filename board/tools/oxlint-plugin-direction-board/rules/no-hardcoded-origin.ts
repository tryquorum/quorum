import { defineRule } from '@oxlint/plugins'
import { isTest, repoPath } from '../codeBudget.ts'
import { limitFor } from './backlog.ts'

export default defineRule({
  meta: { type: 'problem', schema: [] },
  create(context) {
    const file = repoPath(context.filename)
    if (!/(?:^|\/)(?:web|apps\/mobile|packages)\/.*\.[cm]?[jt]sx?$/u.test(file) || isTest(file) || /(?:^|\/)vite\.config\.[cm]?[jt]s$/u.test(file)) return {}
    let count = 0
    const inspect = (node: any) => {
      const value = node.type === 'Literal' ? node.value : node.value?.raw
      if (typeof value === 'string' && /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?=[:/\s?#]|$)/iu.test(value)) count++
    }
    return { Literal: inspect, TemplateElement: inspect, 'Program:exit'(node) {
      const limit = limitFor('no-hardcoded-origin', context.filename)
      if (count > limit) context.report({ node, message: `고정된 서버 주소 ${count}개가 있어요. 설정으로 받으세요 (기준선 ${limit}개).` })
    } }
  },
})
