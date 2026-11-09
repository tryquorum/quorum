import { expect, test } from 'bun:test'
import { parseMarkdown } from '../../../notes/markdown'
import { answerToNote, noteBlocks, quoteOf, workFromQuote } from './noteQuote'

test('대화 답을 노트에 넣을 글: 질문 첫 줄을 제목으로', () => {
  const run = { prompt: '이거 어떻게 해?\n\n노트에서 고른 부분:\n> 가', output: '  답이에요\n' }
  expect(answerToNote(run)).toEqual({ md: '### 이거 어떻게 해?\n\n답이에요' })
  expect(answerToNote({ ...run, prompt: '' })).toEqual({ md: '답이에요' })
  expect(answerToNote({ ...run, prompt: '# 제목 ##' })?.md.startsWith('### 제목\n')).toBe(true)
  expect(answerToNote({ ...run, output: '   ' })).toBeNull()
})

test('노트 블록을 고를 수 있는 글로: 서식은 빼고 목록·인용·코드는 줄을 지켜요', () => {
  const md = '## 상황\n\n**굵게** 와 [링크](https://a.b) 와 [[문서]]\n\n---\n\n- [ ] 할 일\n- 그냥\n  - 안쪽\n\n> 인용\n\n```\ncode\n```\n\n![사진](/files/a.png)'
  const blocks = noteBlocks(parseMarkdown(md))
  expect(blocks).toEqual(['상황', '굵게 와 링크 와 문서', '- [ ] 할 일\n- 그냥\n  - 안쪽', '인용', 'code', '사진'])
  expect(quoteOf(blocks, new Set([3, 0]))).toBe('상황\n인용')
  expect(quoteOf(blocks, new Set())).toBe('')
})

test('고른 부분으로 새 일: 첫 줄이 제목, 더 길면 본문, 부모 제목은 60자', () => {
  const w = workFromQuote('첫 줄   이에요\n둘째 줄', 'ㄱ'.repeat(70))
  expect(w.title).toBe('첫 줄 이에요')
  expect(w.body).toBe('첫 줄   이에요\n둘째 줄')
  expect(w.reason).toBe(`「${'ㄱ'.repeat(60)}」 노트에서 만든 일`)
  expect(workFromQuote('한 줄', '부모').body).toBeNull()
})
