import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, setHtmlToMarkdown, setStrictHtmlToMarkdown, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { docsApi } from './api.ts'
import { htmlToMarkdown, noteHtmlToMarkdown } from '../vault/index.ts'
import { mdToNoteHtml } from '../notes.ts'
import { parse } from '../vault/html-to-markdown.ts'

// GET /api/docs/:ref/note 의 markdownEditable: iOS 가 md 로 고쳐도 사람이 쓴 웹 서식을 잃지 않을 때만 true.
function setup(strict = true) {
  const db = legacyDb()
  initDocs(db)
  setHtmlToMarkdown(db, noteHtmlToMarkdown)
  if (strict) setStrictHtmlToMarkdown(db, htmlToMarkdown)
  const ops = createDocsOps(db, { act: () => ({ results: [] }) })
  const editable = async (ref: string) => {
    const url = new URL('http://local/api/docs/' + encodeURIComponent(ref) + '/note')
    const res = (await docsApi(new Request(url), url, { email: 'a', agent: false }, url.pathname.split('/').filter(Boolean), ops))!
    expect(res.status).toBe(200)
    return ((await res.json()) as { markdownEditable?: boolean }).markdownEditable
  }
  const withHtml = (html: string, md?: string) => {
    const { ref } = ops.create('a', { title: 'n' + Math.random(), md: 'x' }, 'person')
    ops.putNote('a', ref, { html, text: html.replace(/<[^>]+>/g, ''), ...(md === undefined ? {} : { md }) }, 'person')
    return ref
  }
  return { db, ops, editable, withHtml }
}

test('md 로 쓴 노트와 웹 편집기의 보통 서식은 편집할 수 있어요', async () => {
  const { db, ops, editable, withHtml } = setup()
  try {
    const { ref } = ops.create('a', { title: 'ai', md: '# 제목\n\n- [x] 끝\n- [ ] 남음\n\n**굵게** 와 [링크](https://a.com)' }, 'agent')
    expect(await editable(ref)).toBe(true)
    expect(await editable(withHtml('<p>a <strong>b</strong> c</p><ul><li><p>하나</p></li><li><p>둘 <em>기울임</em></p></li></ul>'))).toBe(true)
    // Tiptap 의 할 일 모양(label·input·span·div 감싸개)
    expect(await editable(withHtml('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox" checked="checked"><span></span></label><div><p>끝냄</p></div></li></ul>'))).toBe(true)
    expect(await editable(withHtml(''))).toBe(true)
  } finally { stopDocsRefresh(db); db.close() }
})

test('변환에서 서식을 잃는 노트는 편집을 막아요', async () => {
  const { db, editable, withHtml } = setup()
  try {
    expect(await editable(withHtml('<table><tr><td>표</td></tr></table>'))).toBe(false)
    expect(await editable(withHtml('<p><mark>형광</mark></p>'))).toBe(false)
    // 엄격 변환기가 조용히 버리는 것: 맞붙은 강조, 줄바꿈 걸친 강조, 글자 색
    expect(await editable(withHtml('<p><strong>x<br>y</strong></p>'))).toBe(false)
    expect(await editable(withHtml('<p><em>x</em><strong>y</strong></p>'))).toBe(false)
    expect(await editable(withHtml('<p><span style="color:red">빨강</span></p>'))).toBe(false)
    // html 과 뜻이 다른 md 를 함께 넣은 노트(웹 빠른 추가처럼)
    expect(await editable(withHtml('<p># 제목처럼 보이는 문단</p>', '# 제목처럼 보이는 문단'))).toBe(false)
  } finally { stopDocsRefresh(db); db.close() }
})

test('엄격 변환기가 꽂혀 있지 않으면 닫힌 쪽이에요', async () => {
  const { db, editable, withHtml } = setup(false)
  try {
    expect(await editable(withHtml('<p>plain</p>'))).toBe(false)
  } finally { stopDocsRefresh(db); db.close() }
})

test('편집할 수 있는 노트를 md 로 바꿔 써도 다시 편집할 수 있어요', async () => {
  const { db, ops, editable, withHtml } = setup()
  try {
    const ref = withHtml('<p>a <strong>b</strong></p><ul><li><p>하나</p></li></ul>')
    expect(await editable(ref)).toBe(true)
    const note = ops.note('a', ref)
    ops.write('a', { ref, mode: 'replace', md: note.md + '\n- 둘', expectedVersion: note.version }, 'person')
    expect(await editable(ref)).toBe(true)
    expect(ops.note('a', ref).md).toContain('둘')
  } finally { stopDocsRefresh(db); db.close() }
})

test('보존되지 않는 감싸개·링크 속성이 있으면 편집을 막아요', async () => {
  const { db, editable, withHtml } = setup()
  try {
    expect(await editable(withHtml('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label contenteditable="false" style="color:red"><input type="checkbox" checked="checked"><span></span></label><div><p>끝냄</p></div></li></ul>'))).toBe(false)
    expect(await editable(withHtml('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox" checked="checked"><span></span></label><div><p>체크 불일치</p></div></li></ul>'))).toBe(false)
    expect(await editable(withHtml('<p><a href="https://a.com" target="_self" rel="nofollow">링크</a></p>'))).toBe(false)
    expect(await editable(withHtml('<p><a href="https://a.com" target="_blank" rel="noopener noreferrer nofollow">Tiptap 링크</a></p>'))).toBe(true)
    expect(await editable(withHtml('<p><a href="https://a.com">링크</a></p>'))).toBe(true)
  } finally { stopDocsRefresh(db); db.close() }
})

test('Tiptap 웹 편집기 서식과 AI 마크다운 패턴 시험 표가 손실 없이 왕복돼요', async () => {
  const { db, ops, editable, withHtml } = setup()
  try {
    const mdCases: [string, string][] = [
      ['강조+조사', '**굵게**을 처리하고 *기울임*을 적용'],
      ['구두점·이모지 강조+공백', '**요약:** 핵심 **100%** 달성 **🚀 출시** 일정'],
      ['구두점·문장부호 인접 강조', '**첫째**, **둘째**. (**참고**) "**중요**"'],
      ['코드·링크·위키+조사', '`noteModel`을 검사하고 [문서](https://a.com)를 확인하며 [[회의록]]을 참고'],
      ['할 일 아래 하위 할 일', '- [ ] 부모 할 일\n  - [x] 자식 할 일'],
      ['할 일 아래 하위 글머리·번호', '- [ ] 부모 할 일\n  - 자식 글머리\n- [x] 둘째 부모\n  1. 자식 번호'],
      ['빈 줄 낀 할 일과 다중 문단 할 일', '- [ ] 첫 할 일\n\n- [x] 둘째 할 일\n\n  둘째의 이어지는 문단'],
      ['일반 글머리와 할 일 혼합 목록', '- 일반 글머리\n- [ ] 할 일 항목\n- [x] 끝낸 항목\n- 다시 일반'],
      ['할 일 빈 문단 뒤 하위 목록', '- [ ] &nbsp;\n  - 하위 글머리'],
    ]
    for (const [, md] of mdCases) {
      const { ref } = ops.create('a', { title: 'md-' + Math.random(), md }, 'agent')
      expect(await editable(ref)).toBe(true)
    }
    const htmlCases: [string, string, string][] = [
      ['굵게 뒤 조사', '<p><strong>굵게</strong>을</p>', '**굵게**을'],
      ['낱말 안 굵게', '<p>foo<strong>bar</strong>baz</p>', 'foo**bar**baz'],
      ['취소선 뒤 조사', '<p><s>취소선</s>을</p>', '~~취소선~~&#51012;'],
      ['괄호·퍼센트·이모지 끝 강조 뒤 조사', '<p><strong>방향판(v1)</strong>을 <strong>100%</strong>를 <strong>출시 🚀</strong>를</p>', '**방향판(v1)**&#51012; **100%**&#47484; **출시 🚀**&#47484;'],
      ['코드·링크 감싼 강조 뒤 조사', '<p><strong><code>check</code></strong>를 <strong><a href="https://a.com">문서</a></strong>를</p>', '**`check`**&#47484; **[문서](https://a.com)**&#47484;'],
      ['중첩 강조·취소선 뒤 조사', '<p><strong><em>복합</em></strong>을 <strong><s>취소</s></strong>을</p>', '***복합***을 **~~취소~~**&#51012;'],
      ['이스케이프 별표 끝 강조 뒤 조사', '<p><strong>a*</strong>을</p>', '**a\\***&#51012;'],
      ['두 강조 사이 한 글자 조사', '<p><strong>(a)</strong>을<strong>(b)</strong></p>', '**(a)**&#51012;**(b)**'],
      ['태그 안 공백 포함 인접 강조', '<p><strong>굵게 </strong><em>기울임</em></p>', '**굵게** *기울임*'],
      ['강조 바로 뒤 밑줄', '<p><strong>a</strong>_b_</p>', '**a**\\_b\\_'],
      ['문단 안 줄바꿈과 줄 끝 줄바꿈', '<p>첫 줄<br>둘째 줄</p><p>끝 줄<br></p>', '첫 줄\\\n둘째 줄\n\n끝 줄\\\n&nbsp;'],
      ['빈 목록 항목과 빈 문단 뒤 하위 목록', '<ul><li><p></p></li></ul><ol><li><p></p><ul><li>자식</li></ul></li></ol>', '- &nbsp;\n\n1. &nbsp;\n   - 자식'],
      ['서로 다른 목록 연속(ul+ol, ul+taskList)', '<ul><li><p>일반</p></li></ul><ol><li><p>번호</p></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p>할 일</p></div></li></ul>', '- 일반\n\n1. 번호\n\n- [ ] 할 일'],
      ['Tiptap 중첩 할 일', '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p>부모</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox" checked="checked"><span></span></label><div><p>자식</p></div></li></ul></div></li></ul>', '- [ ] 부모\n  - [x] 자식'],
    ]
    for (const [, html, expectedMd] of htmlCases) {
      const ref = withHtml(html)
      expect(ops.note('a', ref).md).toBe(expectedMd)
      expect(await editable(ref)).toBe(true)
    }
    // 섞인 목록(- a / - [ ] b)과 중첩 할 일은 Tiptap 이 받아들이는 모양(일반 ul 과 taskList ul 분리, p+하위 목록 형제)이어야 해요
    const mixedTree = parse(mdToNoteHtml('- a\n- [ ] b\n- c\n- [x] d')).filter((n) => n.type === 'element')
    expect(mixedTree.map((n) => (n.type === 'element' ? n.tag + ':' + (n.attrs['data-type'] ?? '') : ''))).toEqual(['ul:', 'ul:taskList', 'ul:', 'ul:taskList'])
    // 허용 밖 태그(table)가 할 일과 섞여 있으면 catch 폴백을 거쳐 편집 불가(false)로 남아요
    expect(await editable(withHtml(mdToNoteHtml('- [ ] <table><tr><td>표</td></tr></table>')))).toBe(false)
  } finally { stopDocsRefresh(db); db.close() }
})
