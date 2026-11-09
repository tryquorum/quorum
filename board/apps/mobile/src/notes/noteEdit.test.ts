import { expect, test } from 'bun:test'
import { insertBlock, leaveChoice, noteBanner, prefixLine, statusLine, wrap } from './noteEdit'
import type { NoteState } from './noteSaver'

const st = (over: Partial<NoteState> = {}): NoteState => ({ status: 'clean', base: 'a', version: 2, draft: 'a', backups: [], editable: true, ...over })

test('띠: 평소엔 없고, 막힘·충돌·불명·합치기·오류마다 다른 단추', () => {
  expect(noteBanner(st())).toBeNull()
  expect(noteBanner(st({ status: 'dirty', draft: 'b' }))).toBeNull()
  expect(noteBanner(st({ editable: false }))?.actions).toEqual([])
  expect(noteBanner(st({ status: 'conflict' }))?.actions).toEqual(['export', 'reload'])
  expect(noteBanner(st({ status: 'unknown', reloaded: { version: 5, md: 'x', truncated: false, editable: true } }))?.actions).toEqual(['export', 'adopt'])
  expect(noteBanner(st({ status: 'merging' }))?.actions).toEqual(['saveMerged', 'export'])
  expect(noteBanner(st({ status: 'error', message: '표는 저장할 수 없어요' }))?.message).toBe('표는 저장할 수 없어요')
  expect(statusLine(st({ status: 'saving' }))).toBe('저장 중…')
})

test('떠날 때: 깨끗하면 그냥, 저장 전이면 저장, 멈췄으면 멈춤. 기기 보관을 모르면 kept=false', () => {
  expect(leaveChoice(st(), true)).toEqual({ kind: 'free' })
  expect(leaveChoice(st({ status: 'dirty' }), true)).toEqual({ kind: 'save', kept: true })
  expect(leaveChoice(st({ status: 'conflict' }), false)).toEqual({ kind: 'stopped', kept: false })
  expect(leaveChoice(st({ backups: ['old'] }), true)).toEqual({ kind: 'stopped', kept: true })
  expect(leaveChoice(null, false)).toEqual({ kind: 'free' })
})

test('도구 줄: 감싸기·줄 앞 표지·그림 문단', () => {
  expect(wrap('ab cd', { start: 3, end: 5 }, '**')).toEqual({ md: 'ab **cd**', sel: { start: 5, end: 7 } })
  expect(wrap('ab', { start: 2, end: 2 }, '[[', ']]')).toEqual({ md: 'ab[[]]', sel: { start: 4, end: 4 } })
  expect(prefixLine('one\ntwo', { start: 5, end: 5 }, '- [ ] ').md).toBe('one\n- [ ] two')
  expect(prefixLine('# a', { start: 2, end: 2 }, '# ').md).toBe('# a')
  expect(insertBlock('ab', { start: 1, end: 1 }, '![](/api/files/x.png)').md).toBe('a\n\n![](/api/files/x.png)\n\nb')
})
