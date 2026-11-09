import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { NoteSource } from '@direction-board/contracts'
import { parse as parse5 } from 'parse5'
import { scopedClient } from '../../api/client'
import { answerToNoteWith } from './work/answerWith'
import { insertDraftNote } from './work/insertDraft'


// PR #39 리뷰 11: 불변식 — 답·초안 넣기의 결과(서버까지 연결한 실제 저장)는
//   (가) 저장 md 가 기존 md 로 정확히 시작하고, 저장 HTML 이 기존 HTML 로 정확히 시작하며, 새 답이 기존의 열린 블록 안에 있지 않거나
//   (나) 쓰기 0건으로 멈춰요(md·HTML·버전 그대로).
// 앱의 실제 흐름(answerToNoteWith·insertDraftNote, 범위 고정 클라이언트)을 임시 DB·vault 의 격리 서버 프로세스에 붙여 돌려요. 3070·data/ 는 건드리지 않아요.
const SERVER = resolve(import.meta.dir, '../../../../server/server.ts')
let base = ''
let dir = ''
let proc: ReturnType<typeof Bun.spawn> | null = null

async function freePort() {
  for (;;) {
    const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
    const port = Number(probe.port)
    await probe.stop(true)
    if (![3070, 3071, 3090, 3091].includes(port)) return port
  }
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'note-invariant-'))
  const port = await freePort()
  let pub = await freePort()
  while (pub === port) pub = await freePort()
  const env = { PATH: '/usr/bin:/bin', HOME: dir, PORT: String(port), PUBLIC_PORT: String(pub), HOST: '127.0.0.1', DEV_LOCAL_USER: 'qa@lidgeai.test', ALLOWED_EMAILS: 'qa@lidgeai.test', ACCESS_TEAM: 'qa-team', ACCESS_AUD: 'qa-aud', AGENT_TOKEN: 'test-agent-token', DB_PATH: join(dir, 'board.db'), VAULT_DIR: join(dir, 'vault'), ASIDE_BIN: '/usr/bin/false', GOAT_BIN: '/usr/bin/false', ASIDE_ACCOUNT: 'test_' + crypto.randomUUID() }
  proc = Bun.spawn([process.execPath, '--no-env-file', SERVER], { cwd: dir, env, stdout: 'ignore', stderr: 'ignore' })
  base = 'http://127.0.0.1:' + port
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return } catch { /* 시작 중 */ }
    await Bun.sleep(50)
  }
  throw new Error('격리 서버가 뜨지 않았어요')
}, 30000)
afterAll(async () => {
  proc?.kill()
  await proc?.exited
  await rm(dir, { recursive: true, force: true })
})

const enc = encodeURIComponent
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status + ' ' + (await r.text()))
  return (await r.json()) as T
}
const note = (ref: string) => call<NoteSource>('GET', '/api/docs/' + enc(ref) + '/note')
let seq = 0
/** 새 문서에 기존 노트를 둬요. html 이 없으면 서버가 md 로 만든 HTML(md·HTML 같은 노트), 있으면 그 HTML(md≠HTML 노트) */
async function seed(md: string, html?: string) {
  const { ref } = await call<{ ref: string }>('POST', '/api/docs', { title: '불변식 ' + ++seq + ' ' + crypto.randomUUID().slice(0, 8), md: 'x' })
  const s = await note(ref)
  await call('POST', '/api/docs/' + enc(ref) + '/write', { mode: 'replace', md, expectedVersion: s.version })
  if (html !== undefined) {
    const t = await note(ref)
    await call('PUT', '/api/docs/' + enc(ref) + '/note', { html, text: md, md, expectedVersion: t.version })
  }
  return ref
}

// 독립 오라클(서버 판정 코드를 다시 쓰지 않아요 — 리뷰 13·14):
// (i) 합성성: 저장 md 의 렌더가 "기존 md 렌더 + 덧붙인 꼬리의 렌더" 와 정확히 같아요(Bun.markdown.html 로 이 시험이 직접 계산).
// (ii) HTML5 표준 트리 빌더 parse5(시험 전용 devDependency)로 저장 HTML, 저장 md 의 바탕 렌더(Bun.markdown.html), 저장 md 의 실제 서버 렌더
//      (mdToNoteHtml — 할 일 목록 후처리 포함. 서버가 replace 때 만드는 HTML 을 임시 문서로 받아요)를 트리로 만들어 새 답 글자의 조상이
//      그 글자를 감싼 <p> 하나뿐인지(기존 요소 안이 아닌지) 봐요.
const render = (md: string) => Bun.markdown.html(md)
type P5Node = { nodeName: string; tagName?: string; value?: string; parentNode?: P5Node | null; childNodes?: P5Node[] }
/** parse5 트리에서 marker 를 담은 글자 마디의 조상 태그(html·body 빼고, 가까운 것부터). 못 찾으면 null */
function ancestors(html: string, marker: string): string[] | null {
  const find = (n: P5Node): P5Node | null => {
    if (n.nodeName === '#text' && (n.value ?? '').includes(marker)) return n
    for (const ch of n.childNodes ?? []) {
      const hit = find(ch)
      if (hit) return hit
    }
    return null
  }
  const hit = find(parse5(html) as unknown as P5Node)
  if (!hit) return null
  const out: string[] = []
  for (let p = hit.parentNode; p; p = p.parentNode) if (p.tagName && p.tagName !== 'html' && p.tagName !== 'body') out.push(p.tagName)
  return out
}
/** 서버의 실제 md 렌더(mdToNoteHtml): 임시 문서에 replace 로 저장하면 서버가 그 md 로 HTML 을 만들어요 */
async function serverRender(md: string): Promise<string> {
  const { ref } = await call<{ ref: string }>('POST', '/api/docs', { title: '렌더 ' + crypto.randomUUID().slice(0, 8), md: 'x' })
  await call('POST', '/api/docs/' + enc(ref) + '/write', { mode: 'replace', md, expectedVersion: (await note(ref)).version })
  return (await note(ref)).html
}
/** 붙은 결과 확인: 접두 그대로 + (i) 합성성 + (ii) 새 답이 기존 요소 밖(저장 HTML·바탕 렌더·서버 렌더 셋 다) */
async function expectOutside(name: string, before: NoteSource, after: NoteSource, marker: string) {
  expect([name, after.md.startsWith(before.md), after.html.startsWith(before.html)]).toEqual([name, true, true])
  expect([name, after.md.includes(marker)]).toEqual([name, true])
  expect([name, render(after.md) === render(before.md) + render(after.md.slice(before.md.length))]).toEqual([name, true])
  expect([name, ancestors(after.html, marker), ancestors(render(after.md), marker), ancestors(await serverRender(after.md), marker)]).toEqual([name, ['p'], ['p'], ['p']])
}

type Case = { name: string; md: string; html?: string; expect: 'ok' | 'stop' }
const F3 = '\u0060\u0060\u0060'
const BS = '\\'
const CASES: Case[] = [
  ...[0, 1, 2, 3].map((n) => ({ name: '목록 끝 개행 ' + n, md: '- item' + '\n'.repeat(n), expect: 'ok' as const })),
  ...[0, 1, 2, 3].map((n) => ({ name: '문단 끝 개행 ' + n, md: '사람 글' + '\n'.repeat(n), expect: 'ok' as const })),
  { name: '끝 공백 두 칸', md: '첫 줄  ', expect: 'ok' },
  { name: '인용', md: '> 인용한 글', expect: 'ok' },
  { name: '번호 목록', md: '1. 하나\n2. 둘', expect: 'ok' },
  { name: '이모지', md: '이모지 😀👍🏽 글 🇰🇷', expect: 'ok' },
  { name: '할 일 목록', md: '- [ ] 할 일\n- [x] 끝낸 일', expect: 'ok' },
  // 표는 서버 엄격 노트 모델 밖이라 서버가 멈춰요(오탐 멈춤 — 리뷰 13 에서 P2 로 받아들임)
  { name: '표(모델 밖 — 서버가 멈춤)', md: '| a | b |\n|---|---|\n| 1 | 2 |', expect: 'stop' },
  { name: 'md≠HTML(목록 문단 — 모델 안)', md: '- 하나', html: '<ul><li><p>하나</p></li></ul>', expect: 'ok' },
  { name: 'CRLF', md: '첫 줄\r\n둘째 줄\r\n', expect: 'ok' },
  { name: '빈 노트', md: '', expect: 'ok' },
  { name: '공백뿐인 노트(공백 네 칸 — 새 글이 코드 블록이 될 수 있음)', md: '    ', html: '', expect: 'stop' },
  { name: '개행뿐인 노트', md: '\n', html: '', expect: 'ok' },
  { name: '닫힌 백틱 펜스', md: F3 + 'js\nconst a = 1\n' + F3, expect: 'ok' },
  { name: '닫힌 물결 펜스', md: '~~~\n코드\n~~~\n', expect: 'ok' },
  { name: '펜스 안의 <pre> 글자', md: F3 + '\n<pre>\n' + F3, expect: 'ok' },
  { name: '인라인 코드 안의 태그 글자', md: '글 \u0060<div>\u0060 글', expect: 'ok' },
  { name: '열린 백틱 펜스', md: '설명\n\n' + F3 + 'js\nconst a = 1', expect: 'stop' },
  { name: '열린 물결 펜스', md: '~~~\n코드\n', expect: 'stop' },
  { name: '짧은 줄로 못 닫은 펜스', md: '\u0060\u0060\u0060\u0060\n코드\n' + F3, expect: 'stop' },
  ...['pre', 'script', 'style', 'textarea'].flatMap((tag) => [
    { name: '열린 ' + tag, md: '<' + tag + '>\n원본', expect: 'stop' as const },
    { name: '닫힌 ' + tag, md: '<' + tag + '>\n원본\n</' + tag + '>', expect: 'stop' as const },
  ]),
  { name: '태그 불일치(script 를 pre 로 닫음)', md: '<script>\n원본\n</pre>', expect: 'stop' },
  { name: '열린 HTML 주석', md: '<!-- 메모\n아직', expect: 'stop' },
  { name: '닫힌 HTML 주석', md: '<!-- 메모 -->\n\n글', expect: 'stop' },
  ...['div', 'span', 'details', 'table', 'my-box'].map((tag) => ({ name: 'md 의 열린 ' + tag, md: '<' + tag + '>\n사람 글', html: '<p>사람 글</p>', expect: 'stop' as const })),
  ...[0, 1, 2, 3].flatMap((n) => ['pre', 'div'].map((tag) => ({ name: '백슬래시 ' + n + '개 + <' + tag + '>', md: BS.repeat(n) + '<' + tag + '>\n사람 글', html: '<p>사람 글</p>', expect: 'stop' as const }))),
  { name: '자동 링크(< 가 있으면 앱이 멈춤)', md: '<https://example.com> 참고', expect: 'stop' },
  ...['textarea', 'div', 'script', 'title', 'my-box'].map((tag) => ({ name: 'HTML 의 ' + tag + ' 자기 닫힘', md: '사람 글', html: '<p>사람 글</p><' + tag + '/>', expect: 'stop' as const })),
  { name: 'md≠HTML(모델 밖 밑줄 — 서버가 멈춤)', md: '사람 글', html: '<p><u>사람 글</u></p>', expect: 'stop' },
  { name: 'md≠HTML(HTML 쪽 열린 pre)', md: '사람 글', html: '<p>사람 글</p><pre>코드', expect: 'stop' },
  { name: 'md≠HTML(HTML 쪽 열린 script)', md: '사람 글', html: '<p>a</p><script>x', expect: 'stop' },
  { name: 'md≠HTML(HTML 쪽 열린 주석)', md: '사람 글', html: '<p>a</p><!-- 메모', expect: 'stop' },
  { name: 'md≠HTML(HTML 쪽 닫히지 않은 div)', md: '사람 글', html: '<div><p>a</p>', expect: 'stop' },
]

type Flow = { name: string; run: (ref: string, n: number) => Promise<unknown>; marker: (n: number) => string }
const FLOWS: Flow[] = [
  { name: '대화 답', run: (ref, n) => answerToNoteWith(scopedClient(base), ref, { id: 'inv-a-' + n, prompt: '질문 ' + n, output: '새 답 ' + n, target: ref }), marker: (n) => '새 답 ' + n },
  { name: '초안', run: (ref, n) => insertDraftNote(scopedClient(base), ref, { id: 'inv-d-' + n, output: '## 상황\n새 초안 ' + n }), marker: (n) => '새 초안 ' + n },
]

describe('(리뷰 11~14) 답·초안 넣기 불변식: 기존 md·HTML 그대로 접두 + 합성성 + 새 답은 기존 요소 밖(parse5), 아니면 쓰기 0건 멈춤', () => {
  let n = 0
  for (const flow of FLOWS)
    for (const c of CASES)
      test(flow.name + ' · ' + c.name, async () => {
        const ref = await seed(c.md, c.html)
        const before = await note(ref)
        const k = ++n
        let stopped: unknown = null
        try {
          await flow.run(ref, k)
        } catch (e) {
          stopped = e
        }
        const after = await note(ref)
        if (stopped) {
          expect([after.md, after.html, after.version]).toEqual([before.md, before.html, before.version])
          expect([c.name, c.expect]).toEqual([c.name, 'stop'])
          return
        }
        expect([c.name, c.expect]).toEqual([c.name, 'ok'])
        await expectOutside(c.name, before, after, flow.marker(k))
      })
})

describe('(리뷰 12·13) 앱 판정을 우회한 서버 직접 onceKey append: 위험하면 422·쓰기 0건, 붙였으면 같은 불변식', () => {
  const tail = '꼬리 답 '
  const BYPASS: { name: string; md: string; html?: string; add?: string; expect: 'ok' | 'stop' }[] = [
    ...CASES.map((c) => ({ name: c.name, md: c.md, ...(c.html !== undefined ? { html: c.html } : {}), expect: c.expect })),
    { name: '열린 펜스 + 새 글이 펜스를 닫고 자체 ---', md: '설명\n\n' + F3 + 'js\nconst a = 1', add: F3 + '\n\n---\n\n' + tail, expect: 'stop' },
    { name: '열린 물결 펜스 + 새 글이 닫고 ---', md: '~~~\n코드', add: '~~~\n\n---\n\n' + tail, expect: 'stop' },
    { name: '열린 <script> + 새 글이 닫고 ---', md: '<script>\nx', add: '</script>\n\n---\n\n' + tail, expect: 'stop' },
  ]
  let n = 0
  for (const c of BYPASS)
    test(c.name, async () => {
      const ref = await seed(c.md, c.html)
      const before = await note(ref)
      const marker = tail + ++n
      const add = c.add ? c.add.replace(tail, marker) : marker
      const r = await fetch(base + '/api/docs/' + enc(ref) + '/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'append', md: add, onceKey: 'run:bypass-' + crypto.randomUUID(), expectedVersion: before.version }) })
      const body = (await r.json()) as { error?: string; applied?: number }
      const after = await note(ref)
      if (r.status === 422) {
        expect([c.name, String(body.error).startsWith('unsafe-append')]).toEqual([c.name, true])
        expect([after.md, after.html, after.version]).toEqual([before.md, before.html, before.version])
        // 앱이 붙이는 노트(ok)를 서버가 막으면 안 돼요
        expect([c.name, c.expect === 'ok' ? '서버가 막으면 안 되는 경우' : 'ok']).toEqual([c.name, 'ok'])
        return
      }
      expect([c.name, r.status, body.applied]).toEqual([c.name, 200, 1])
      // 서버가 붙였다면 앱이 막은 노트여도 불변식은 지켜야 해요
      await expectOutside(c.name, before, after, marker)
    })
})
