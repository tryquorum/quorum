import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contrast } from './contrast.ts'

// 보드는 옛 HTML(apps/server/public/index.html)을 iframe 으로 띄워 웹 테마를 받지 않아요.
// CSS 를 풀어 보지 않고, 글자 색 사례를 고정해요: 최종 규칙 문자열이 그대로 있는지와 실제 바탕 위 대비.
// 표에 없는 선언은 이 시험이 보장하지 않아요.
const html = readFileSync(resolve(import.meta.dirname, '../../../apps/server/public/index.html'), 'utf8')
const root = html.match(/:root\{([^}]*)\}/)![1]!
const dark = html.match(/html\.dark\{([^}]*)\}/)![1]!
const v = (name: string) => root.match(new RegExp(`--${name}:(#[0-9a-f]{6})`))![1]!
const dv = (name: string) => dark.match(new RegExp(`--${name}:(#[0-9a-f]{6})`))![1]!

const cases: { name: string; rule: string; fg: string; bgs: string[]; min: number }[] = [
  { name: '--fnt 보조 글자', rule: '#boards .sec{font-size:11px;color:var(--fnt)', fg: v('fnt'), bgs: ['#ffffff', '#f4f4f5', '#f7f7f8', '#f1f1f3'], min: 4.5 },
  { name: '--mut 글자', rule: '.qa-chip.ico{width:24px;padding:0;justify-content:center;background:transparent;color:var(--mut)}', fg: v('mut'), bgs: ['#ffffff', '#f4f4f5', '#f7f7f8'], min: 4.5 },
  { name: '빈 보드 제목(데스크톱 20px/600)', rule: '#empty .h{font-size:20px;font-weight:600;color:var(--mut)', fg: v('mut'), bgs: ['#ffffff'], min: 4.5 },
  { name: '빈 보드 제목(기본)', rule: '#empty .h{font-family:var(--pen);font-size:44px;line-height:1.1;color:var(--mut)}', fg: v('mut'), bgs: ['#ffffff'], min: 4.5 },
  { name: '빈 로드맵 제목', rule: '.rd-empty b{display:block;font-family:var(--pen);font-size:34px;font-weight:400;color:var(--mut)}', fg: v('mut'), bgs: ['#ffffff'], min: 4.5 },
  { name: '빈 보드 설명', rule: '#empty .s{font-size:13px;color:var(--fnt)', fg: v('fnt'), bgs: ['#ffffff'], min: 4.5 },
  { name: '검정 칩의 지우기 x', rule: '.qa-chip.set .x{width:18px;height:18px;display:grid;place-items:center;border-radius:50%;color:#a1a1aa', fg: '#a1a1aa', bgs: [v('ink')], min: 4.5 },
  { name: '다크 --ink 글자', rule: 'html.dark,html.dark body{background:var(--bg);color:var(--ink)}', fg: dv('ink'), bgs: [dv('bg'), dv('card'), dv('subtle')], min: 4.5 },
  { name: '다크 --ink2 글자', rule: '--ink2:#e4e4e7', fg: dv('ink2'), bgs: [dv('bg'), dv('card'), dv('subtle')], min: 4.5 },
  { name: '다크 --mut·--fnt 보조 글자', rule: '--mut:#a1a1a1;--fnt:#a1a1a1', fg: dv('mut'), bgs: [dv('bg'), dv('card'), dv('subtle')], min: 4.5 },
  { name: '다크 --red·--ok 상태 글자', rule: '--red:#ff6467;--red-wash:#2a1215;--ok:#34d399', fg: dv('red'), bgs: [dv('bg'), dv('card'), dv('subtle')], min: 4.5 },
  { name: '다크 채움 단추·칩 글자', rule: 'background:var(--ink);color:var(--on-ink)', fg: dv('on-ink'), bgs: [dv('ink')], min: 4.5 },
  { name: '다크 채움 칩의 지우기 x', rule: 'html.dark .qa-chip.set .x{color:#52525b}', fg: '#52525b', bgs: [dv('ink')], min: 4.5 },
  { name: '다크 흰 포스트잇 글자', rule: 'html.dark .c-white .tx{color:var(--ink)}', fg: dv('ink'), bgs: [dv('card')], min: 4.5 },
  { name: '다크 파스텔 포스트잇 칩 글자', rule: 'html.dark .sticky:not(.c-white) .s-meta .chip{background:rgba(255,255,255,.6);color:#3f3f46}', fg: '#3f3f46', bgs: ['#fff6c9', '#fde4ec', '#e2efff', '#e3f5e6'], min: 4.5 },
  { name: '포커스 링(라이트)', rule: ':focus-visible{outline:2px solid var(--ring);outline-offset:2px}', fg: v('ring'), bgs: ['#ffffff', '#f4f4f5', '#f7f7f8'], min: 3 },
  { name: '포커스 링(다크)', rule: '.pt:focus-visible{outline:2px solid var(--ring);outline-offset:2px;border-radius:6px}', fg: dv('ring'), bgs: [dv('bg'), dv('card'), dv('subtle')], min: 3 },
]

for (const c of cases) {
  test(c.name, () => {
    expect(html).toContain(c.rule)
    const low = c.bgs.map((bg) => [bg, Number(contrast(c.fg, bg).toFixed(2))] as const).filter(([, ratio]) => ratio < c.min)
    expect(low).toEqual([])
  })
}

test('회사 판 빈 목록 글자는 고정 색을 쓰지 않아요', () => {
  expect(html).not.toContain('style="color:#c4c4cc"')
})

