import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, setHtmlToMarkdown, setStrictHtmlToMarkdown, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { htmlToMarkdown, noteHtmlToMarkdown } from '../vault/index.ts'

// docs write append 는 HTML 에 <hr> 를 더해요. iOS(onceKey 를 보내는 append)는 md 에도 같은 가로줄(---)을 둬서 두 표현이 같은 구조라
// 고칠 수 있던 노트(markdownEditable)가 덧붙인 뒤에도 고칠 수 있어요(레인 1 PR #39 리뷰).
// onceKey 가 없는 기존 호출(REST·MCP·운영 순회·같은 제목 문서)은 저장 마크다운이 예전 그대로(A\n\nB, 앞 글의 공백 보존)예요(리뷰 8).
function setup() {
  const db = legacyDb()
  initDocs(db)
  setHtmlToMarkdown(db, noteHtmlToMarkdown)
  setStrictHtmlToMarkdown(db, htmlToMarkdown)
  return { db, ops: createDocsOps(db, { act: () => ({ results: [] }) }) }
}

test('append 뒤에도 md 와 HTML 이 같은 구조라 iOS 편집 가능이 유지돼요', () => {
  const { db, ops } = setup()
  try {
    const { ref } = ops.create('a', { title: 'n' + Math.random(), md: 'x' }, 'person')
    ops.putNote('a', ref, { html: '<p>foo<strong>bar</strong>baz</p>', text: 'foobarbaz' }, 'person')
    expect(ops.note('a', ref).markdownEditable).toBe(true)
    const r = ops.write('a', { ref, mode: 'append', md: '### 질문\n\n답', onceKey: 'run:q1' }, 'person')
    expect(r.applied).toBe(1)
    const after = ops.note('a', ref)
    expect(after.html).toContain('<hr>')
    expect(after.md).toBe('foo**bar**baz\n\n---\n\n### 질문\n\n답')
    expect(after.markdownEditable).toBe(true)
    // 같은 키는 다시 붙이지 않아요(duplicate)
    expect(ops.write('a', { ref, mode: 'append', md: '### 질문\n\n답', onceKey: 'run:q1' }, 'person').duplicate).toBe(true)
  } finally { stopDocsRefresh(db); db.close() }
})

test('(리뷰 8) onceKey 없는 기존 append 는 저장 마크다운이 예전 그대로(A\\n\\nB, 앞 글 끝 공백 보존)', () => {
  const { db, ops } = setup()
  try {
    const { ref } = ops.create('a', { title: 'n' + Math.random(), md: 'x' }, 'person')
    ops.putNote('a', ref, { html: '<p>A</p>', text: 'A', md: 'A\n' }, 'person')
    ops.write('a', { ref, mode: 'append', md: 'B' }, 'person')
    expect(ops.note('a', ref).md).toBe('A\n\n\nB')
    ops.write('a', { ref, mode: 'append', md: 'C' }, 'person')
    expect(ops.note('a', ref).md).toBe('A\n\n\nB\n\nC')
    // 같은 글은 다시 붙이지 않아요(키가 없을 때의 본문 판정)
    expect(ops.write('a', { ref, mode: 'append', md: 'C' }, 'person').warnings).toEqual(['duplicate'])
  } finally { stopDocsRefresh(db); db.close() }
})

test('빈 노트에 append 하면 가로줄 없이 그 글만', () => {
  const { db, ops } = setup()
  try {
    const { ref } = ops.create('a', { title: 'n' + Math.random(), md: 'x' }, 'person')
    ops.putNote('a', ref, { html: '', text: '', md: '' }, 'person')
    ops.write('a', { ref, mode: 'append', md: '첫 글' }, 'person')
    const after = ops.note('a', ref)
    expect(after.md).toBe('첫 글')
    expect(after.html).not.toContain('<hr>')
    expect(after.markdownEditable).toBe(true)
  } finally { stopDocsRefresh(db); db.close() }
})

test('append 에 읽은 버전(expectedVersion)을 주면 그사이 바뀐 노트는 409', () => {
  const { db, ops } = setup()
  try {
    const { ref } = ops.create('a', { title: 'n' + Math.random(), md: '처음' }, 'person')
    const v = ops.note('a', ref).version
    ops.write('a', { ref, mode: 'append', md: '다른 곳에서' }, 'person')
    expect(() => ops.write('a', { ref, mode: 'append', md: '옛 버전으로', expectedVersion: v }, 'person')).toThrow()
  } finally { stopDocsRefresh(db); db.close() }
})

test('(리뷰 11) onceKey append 는 저장 md 가 원본 md 전체로 시작해요(끝 개행이 2개보다 적을 때만 모자란 만큼 더함)', () => {
  const { db, ops } = setup()
  try {
    const cases: [string, string][] = [
      ['- item\n\n\n', '- item\n\n\n---\n\n새 답'],
      ['- item\n\n', '- item\n\n---\n\n새 답'],
      ['- item\n', '- item\n\n---\n\n새 답'],
      ['- item', '- item\n\n---\n\n새 답'],
      ['첫 줄  ', '첫 줄  \n\n---\n\n새 답'],
      ['첫 줄\r\n', '첫 줄\r\n\n---\n\n새 답'],
      ['첫 줄\r\n\r\n', '첫 줄\r\n\r\n---\n\n새 답'],
    ]
    for (const [before, want] of cases) {
      const { ref } = ops.create('a', { title: 'n' + Math.random(), md: 'x' }, 'person')
      ops.write('a', { ref, mode: 'replace', md: before, expectedVersion: ops.note('a', ref).version }, 'person')
      const html = ops.note('a', ref).html
      ops.write('a', { ref, mode: 'append', md: '새 답', onceKey: 'run:' + Math.random() }, 'person')
      const after = ops.note('a', ref)
      expect([before, after.md]).toEqual([before, want])
      expect(after.html.startsWith(html + '<hr>')).toBe(true)
    }
  } finally { stopDocsRefresh(db); db.close() }
})

test('(리뷰 12) onceKey append 는 서버가 최종 판정: 새 가로줄이 md 렌더·저장 HTML 에서 맨 바깥이 아니면 422 unsafe-append·쓰기 0건, 키 없는 append 는 그대로', () => {
  const { db, ops } = setup()
  try {
    const seed = (md: string, html?: string) => {
      const { ref } = ops.create('a', { title: 'n' + Math.random(), md: 'x' }, 'person')
      ops.write('a', { ref, mode: 'replace', md, expectedVersion: ops.note('a', ref).version }, 'person')
      if (html !== undefined) ops.putNote('a', ref, { html, text: md, md, expectedVersion: ops.note('a', ref).version }, 'person')
      return ref
    }
    const unsafe: [string, string | undefined][] = [
      ['<div>\n사람 글', '<p>사람 글</p>'],
      ['<span>\n사람 글', undefined],
      ['<details>\n<summary>요약</summary>\n사람 글', undefined],
      ['<table>\n<tr><td>칸', undefined],
      ['<my-box>\n사람 글', undefined],
      ['사람 글', '<textarea/>'],
      ['사람 글', '<p>a</p><div/>'],
      ['사람 글', '<script/>'],
      ['사람 글', '<title/>'],
      ['사람 글', '<my-box/>'],
      ['사람 글', '<div><p>a</p>'],
    ]
    for (const [md, html] of unsafe) {
      const ref = seed(md, html)
      const before = ops.note('a', ref)
      let status = 0
      let message = ''
      try { ops.write('a', { ref, mode: 'append', md: '새 답', onceKey: 'run:' + Math.random() }, 'person') } catch (e) { status = (e as { status?: number }).status ?? -1; message = String((e as Error).message) }
      const after = ops.note('a', ref)
      expect([md, html, status, message.startsWith('unsafe-append')]).toEqual([md, html, 422, true])
      expect([after.md, after.html, after.version]).toEqual([before.md, before.html, before.version])
    }
    // 안전한 노트는 그대로 붙어요
    for (const md of ['- item\n\n\n', '<div>닫힘</div>\n\n글', '사람 글']) {
      const ref = seed(md)
      expect(ops.write('a', { ref, mode: 'append', md: '새 답', onceKey: 'run:' + Math.random() }, 'person').applied).toBe(1)
    }
    // 키 없는 append(REST·MCP·운영 순회)는 main 그대로 판정 없이
    const keyless = seed('<div>\n사람 글', '<p>사람 글</p>')
    expect(ops.write('a', { ref: keyless, mode: 'append', md: '새 답' }, 'person').applied).toBe(1)
    expect(ops.note('a', keyless).md).toBe('<div>\n사람 글\n\n새 답')
  } finally { stopDocsRefresh(db); db.close() }
})

test('(리뷰 13) 합성성 판정: 기존 md 문맥이 경계에서 닫혀 있고(렌더가 나뉘어 합쳐짐) 기존 HTML·md 렌더가 엄격 노트 모델 안일 때만, 아니면 422·쓰기 0건', () => {
  const { db, ops } = setup()
  try {
    const F = '\u0060\u0060\u0060'
    const seed = (md: string, html?: string) => {
      const { ref } = ops.create('a', { title: 'n' + Math.random(), md: 'x' }, 'person')
      ops.write('a', { ref, mode: 'replace', md, expectedVersion: ops.note('a', ref).version }, 'person')
      if (html !== undefined) ops.putNote('a', ref, { html, text: md, md, expectedVersion: ops.note('a', ref).version }, 'person')
      return ref
    }
    const unsafe: [string, string | undefined, string][] = [
      ['설명\n\n' + F + 'js\nconst a = 1', undefined, F + '\n\n---\n\n자체 답'],
      ['~~~\n코드', undefined, '~~~\n\n---\n\n자체 답'],
      ['<script>\nx', undefined, '</script>\n\n---\n\n자체 답'],
      ['\\\\<pre>\n사람 글', '<p>사람 글</p>', '새 답'],
      ['\\\\\\\\<div>\n사람 글', '<p>사람 글</p>', '새 답'],
      ['<pre>\n사람 글', '<p>사람 글</p>', '새 답'],
      ['사람 글', '<p style="color:red">사람 글</p>', '새 답'],
      ['사람 글', '<p>사람 글</p><textarea/>', '새 답'],
    ]
    for (const [md, html, add] of unsafe) {
      const ref = seed(md, html)
      const before = ops.note('a', ref)
      let status = 0
      let message = ''
      try { ops.write('a', { ref, mode: 'append', md: add, onceKey: 'run:' + Math.random() }, 'person') } catch (e) { status = (e as { status?: number }).status ?? -1; message = String((e as Error).message) }
      const after = ops.note('a', ref)
      expect([md, html, status, message.startsWith('unsafe-append')]).toEqual([md, html, 422, true])
      expect([after.md, after.html, after.version]).toEqual([before.md, before.html, before.version])
    }
    for (const md of ['- [ ] 할 일\n- [x] 끝낸 일', '사람 글', '- item\n\n\n', '\\<pre> 글', '\\\\\\<pre> 글', '> 인용', F + '\n코드\n' + F]) {
      const ref = seed(md)
      expect([md, ops.write('a', { ref, mode: 'append', md: '새 답', onceKey: 'run:' + Math.random() }, 'person').applied]).toEqual([md, 1])
    }
  } finally { stopDocsRefresh(db); db.close() }
})

test('(리뷰 14 P2) 공백뿐인 md(HTML 빈 노트)도 합성성 검사를 거쳐요 — 공백 네 칸 + 새 글이 코드 블록이 되면 422·쓰기 0건', () => {
  const { db, ops } = setup()
  try {
    const { ref } = ops.create('a', { title: 'n' + Math.random(), md: 'x' }, 'person')
    ops.putNote('a', ref, { html: '', text: '    ', md: '    ', expectedVersion: ops.note('a', ref).version }, 'person')
    const before = ops.note('a', ref)
    let status = 0
    try { ops.write('a', { ref, mode: 'append', md: 'MARKER', onceKey: 'run:' + Math.random() }, 'person') } catch (e) { status = (e as { status?: number }).status ?? -1 }
    const after = ops.note('a', ref)
    expect([before.md, status]).toEqual(['    ', 422])
    expect([after.md, after.html, after.version]).toEqual([before.md, before.html, before.version])
    // 개행만 있는 빈 노트는 그대로 붙어요(렌더가 나뉘어 합쳐짐)
    const { ref: r2 } = ops.create('a', { title: 'n' + Math.random(), md: 'x' }, 'person')
    ops.putNote('a', r2, { html: '', text: '\n', md: '\n', expectedVersion: ops.note('a', r2).version }, 'person')
    expect(ops.write('a', { ref: r2, mode: 'append', md: 'MARKER', onceKey: 'run:' + Math.random() }, 'person').applied).toBe(1)
  } finally { stopDocsRefresh(db); db.close() }
})
