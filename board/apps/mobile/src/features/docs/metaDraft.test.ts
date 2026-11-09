import { expect, test } from 'bun:test'
import { fieldRules, metaAtRisk, metaSummary, restoreMeta, type MetaGuard } from './metaDraft'

const ok: MetaGuard = { busy: false, blocked: false, conflict: false, error: '', storageError: false }
const base = { title: '회의', area: '업무', status: 'open', due: '' }
const inputs = { ...base, propDrafts: {}, newKey: '' }

test('종류별로 고칠 수 있는 칸은 서버 meta.ts 와 같아요', () => {
  expect(fieldRules('doc', 'open')).toMatchObject({ title: true, area: true, due: true, status: true, dueWithTime: false })
  expect(fieldRules('todo', 'open')).toMatchObject({ title: true, area: true, dueWithTime: true })
  expect(fieldRules('signal', 'open')).toMatchObject({ title: true, area: false, due: false, status: true })
  expect(fieldRules('run', 'open')).toMatchObject({ title: false, area: false, status: true, titleHint: '대화 제목은 첫 질문이라 바꿀 수 없어요' })
  expect(fieldRules('doc', 'archived')).toMatchObject({ title: false, area: false, status: false, props: true })
})

test('저장 안 된 값·오류·저장 중이면 접을 수 없어요. 제목은 쓰는 동안은 위험으로 치지 않아요', () => {
  expect(metaAtRisk(inputs, base, ok, false)).toBe(false)
  expect(metaAtRisk({ ...inputs, title: '회의2' }, base, ok, true)).toBe(false)
  expect(metaAtRisk({ ...inputs, title: '회의2' }, base, ok, false)).toBe(true)
  expect(metaAtRisk({ ...inputs, propDrafts: { 단계: '검토' } }, base, ok, false)).toBe(true)
  expect(metaAtRisk(inputs, base, { ...ok, busy: true }, false)).toBe(true)
  expect(metaAtRisk({ ...inputs, newKey: ' x ' }, base, ok, false)).toBe(true)
})

test('요약 줄과 보관 입력 복원(막힌 상태로)', () => {
  expect(metaSummary({ area: '업무', status: 'done', due: '2026-11-07T09:30', props: [{ key: 'a', type: 'text', value: '' }] })).toBe('업무 · 끝남 · 2026-11-07 09:30 · 속성 1')
  expect(metaSummary({ area: '', status: '', due: '', props: [] })).toBe('속성')
  const r = restoreMeta({ version: 4, inputs, blocked: true, conflict: false })
  expect(r?.version).toBe(4)
  expect(r?.guard.blocked).toBe(true)
  expect(restoreMeta({ version: 'x' } as never)).toBeNull()
})
