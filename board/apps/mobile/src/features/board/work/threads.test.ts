import { expect, test } from 'bun:test'
import type { Run } from '@direction-board/contracts'
import { pendingDraft } from './threads'

const run = (p: Partial<Run>): Run => ({ id: 'r', target: 'item:b:1', prompt: '질문', provider: 'aside', model: 'm', model_name: 'M', effort: null, status: 'done', session_id: null, parent: null, output: '', error: null, error_kind: null, retry_of: null, last_activity_at: null, created_at: 1, finished_at: 2, kind: 'chat', ...p })

test('적용 안 한 최신 초안', () => {
  expect(pendingDraft([run({ id: 'd1', kind: 'draft', applied: 1, created_at: 1 }), run({ id: 'd2', kind: 'draft', created_at: 2 })])?.id).toBe('d2')
  expect(pendingDraft([run({ id: 'x' })])).toBeNull()
})
