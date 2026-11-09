// 자연어 날짜(apps/server/public/when.js 의 TS 판). 웹은 아직 when.js 를 전역으로 읽고, iOS 는 이 모듈을 써요.
// 두 판이 같은 결과를 내는지는 when.test.ts 가 같은 입력으로 비교해요. 규칙을 바꾸면 두 파일을 함께 바꿔요.
//   parse("내일 3시 계약서") -> { at: 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM', title, spans } | null
//   short(v) 목록용 짧은 라벨, long(v) 확인용 라벨, quick() 빠른 선택 칩
export type WhenParsed = { at: string; title: string; spans: [number, number][] }
export type WhenQuick = { k: string; label: string; sub: string; at: string }

const WD = '일월화수목금토'
const P2 = (n: number) => String(n).padStart(2, '0')
const day0 = (d: Date | number) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const add = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const isoD = (d: Date) => `${d.getFullYear()}-${P2(d.getMonth() + 1)}-${P2(d.getDate())}`
const isoDT = (d: Date) => `${isoD(d)}T${P2(d.getHours())}:${P2(d.getMinutes())}`
const monIdx = (d: Date) => (d.getDay() + 6) % 7 // 월=0 … 일=6
const H = '[가-힣]'
const SUF = '(?:에|까지|쯤|부터|중에?|은|는)?'
const END = `(?!${H})`
const NB = `(?<!${H})`
const re = (s: string) => new RegExp(s)
const futureYear = (now: Date, m: number, d: number) => { let x = new Date(now.getFullYear(), m - 1, d); if (x < day0(now)) x = new Date(now.getFullYear() + 1, m - 1, d); return x }

type DateRule = [RegExp, (m: RegExpExecArray, n: Date) => Date | null]
const DATE_RULES: DateRule[] = [
  [re(`(?<![가-힣\\d])(\\d{1,3})\\s*(일|주|개월|달)\\s*(?:뒤|후)(?:에)?${END}`), (m, n) => {
    const k = +m[1]; if (m[2] === '일') return add(day0(n), k); if (m[2] === '주') return add(day0(n), 7 * k)
    const x = day0(n); x.setMonth(x.getMonth() + k); return x }],
  [re(`(?<!\\d)(\\d{4})[-.](\\d{1,2})[-.](\\d{1,2})(?!\\d)`), (m) => new Date(+m[1], +m[2] - 1, +m[3])],
  [re(`(?<!\\d)(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일${SUF}${END}`), (m, n) => futureYear(n, +m[1], +m[2])],
  [re(`(?<![\\d/])(\\d{1,2})/(\\d{1,2})(?![\\d/])${SUF}`), (m, n) => (+m[1] <= 12 && +m[2] <= 31 ? futureYear(n, +m[1], +m[2]) : null)],
  [re(`${NB}(오늘|내일|낼|모레|글피)${SUF}${END}`), (m, n) => add(day0(n), ({ 오늘: 0, 내일: 1, 낼: 1, 모레: 2, 글피: 3 } as Record<string, number>)[m[1]])],
  [re(`${NB}(이번|다음|담|다다음)\\s*주\\s*([월화수목금토일])(?:요일)?${SUF}${END}`), (m, n) => {
    const w = ({ 이번: 0, 다음: 7, 담: 7, 다다음: 14 } as Record<string, number>)[m[1]]; return add(day0(n), ((WD.indexOf(m[2]) + 6) % 7) - monIdx(n) + w) }],
  [re(`${NB}([월화수목금토일])요일${SUF}${END}`), (m, n) => {
    const t = (WD.indexOf(m[1]) + 6) % 7; return add(day0(n), ((t - monIdx(n) + 7) % 7) || 7) }],
  [re(`${NB}(?:(이번|다음|담)\\s*)?주말${SUF}${END}`), (m, n) => {
    const base = Math.max(0, 5 - monIdx(n)); return add(day0(n), base + (m[1] === '다음' || m[1] === '담' ? 7 : 0)) }],
  [re(`${NB}(다음|담)\\s*주${SUF}${END}`), (_m, n) => add(day0(n), 7 - monIdx(n))],
]
const MER = '(오전|오후|아침|낮|저녁|밤|새벽)'
const hour = (mer: string | undefined, h: number, korean: boolean) => {
  if (mer === '오후' || mer === '저녁' || mer === '밤' || mer === '낮') return h < 12 ? h + 12 : h
  if (mer === '오전' || mer === '아침' || mer === '새벽') return h === 12 ? 0 : h
  if (korean && h >= 1 && h <= 6) return h + 12 // "3시" = 오후 3시가 자연스러움
  return h
}
type TimeRule = [RegExp, (m: RegExpExecArray) => [number, number]]
const TIME_RULES: TimeRule[] = [
  [re(`(?<![가-힣\\d])(?:${MER}\\s*)?(\\d{1,2})\\s*시(?:\\s*(반|(\\d{1,2})\\s*분))?${SUF}${END}`), (m) => [hour(m[1], +m[2], true), m[3] === '반' ? 30 : +(m[4] || 0)]],
  [re(`(?<![\\d:])(?:${MER}\\s*)?(\\d{1,2}):(\\d{2})(?![\\d:])${SUF}`), (m) => [hour(m[1], +m[2], false), +m[3]]],
  [re(`${NB}(정오)${SUF}${END}`), () => [12, 0]],
  [re(`${NB}(아침|점심|저녁|밤)${SUF}${END}`), (m) => [({ 아침: 9, 점심: 12, 저녁: 19, 밤: 21 } as Record<string, number>)[m[1]], 0]],
]
const REL_TIME = re(`(?<![가-힣\\d])(\\d{1,3})\\s*(시간|분)\\s*(?:뒤|후)(?:에)?${END}`)

export function parse(text: string, now = new Date()): WhenParsed | null {
  if (!text) return null
  const spans: [number, number][] = []
  let day: Date | null = null
  let hm: [number, number] | null = null
  let abs: Date | null = null
  const r = REL_TIME.exec(text)
  if (r) { abs = new Date(now.getTime() + (+r[1]) * (r[2] === '시간' ? 36e5 : 6e4)); spans.push([r.index, r.index + r[0].length]) }
  if (!abs) {
    for (const [rx, fn] of DATE_RULES) { const m = rx.exec(text); if (!m) continue; const d = fn(m, now); if (!d || isNaN(d.getTime())) continue; day = d; spans.push([m.index, m.index + m[0].length]); break }
    for (const [rx, fn] of TIME_RULES) {
      const m = rx.exec(text); if (!m) continue
      if (spans.some(([s, e]) => m.index < e && s < m.index + m[0].length)) continue
      const [h, mi] = fn(m); if (h > 23 || mi > 59) continue; hm = [h, mi]; spans.push([m.index, m.index + m[0].length]); break
    }
  }
  if (!abs && !day && !hm) return null
  let at: string
  if (abs) at = isoDT(abs)
  else if (hm) { let d = new Date(day || day0(now)); d.setHours(hm[0], hm[1], 0, 0); if (!day && d < now) d = add(d, 1); at = isoDT(d) }
  else at = isoD(day as Date)
  let title = text
  ;[...spans].sort((a, b) => b[0] - a[0]).forEach(([s, e]) => { title = title.slice(0, s) + ' ' + title.slice(e) })
  title = title.replace(/\s+/g, ' ').trim()
  return { at, title: title || text.trim(), spans }
}

const toDate = (v: string) => new Date(v.length > 10 ? v : v + 'T00:00')
const daysFrom = (d: Date, now: Date) => Math.round((day0(d).getTime() - day0(now).getTime()) / 864e5)
const hm24 = (d: Date) => `${P2(d.getHours())}:${P2(d.getMinutes())}`
const hmKo = (d: Date) => { const h = d.getHours(); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${P2(d.getMinutes())}` }

export function short(v: string, now = new Date()): string {
  if (!v) return ''
  const d = toDate(v), n = daysFrom(d, now), t = v.length > 10 ? hm24(d) : ''
  const j = (a: string, b: string) => (b ? `${a} ${b}` : a)
  if (n < -1) return `${-n}일 지남`
  if (n === -1) return j('어제', t)
  if (n === 0) return t || '오늘'
  if (n === 1) return j('내일', t)
  if (n <= 6) return j(WD[d.getDay()], t)
  if (d.getFullYear() !== now.getFullYear()) return j(`${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}/${d.getDate()}`, t)
  return j(`${d.getMonth() + 1}/${d.getDate()}`, t)
}

export function long(v: string, now = new Date()): string {
  if (!v) return ''
  const d = toDate(v), n = daysFrom(d, now), wd = `(${WD[d.getDay()]})`
  const rel = ({ '-1': '어제', 0: '오늘', 1: '내일', 2: '모레' } as Record<string, string>)[n]
  const md = `${d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '년 ' : ''}${d.getMonth() + 1}월 ${d.getDate()}일`
  const head = rel ? `${rel} ${wd}` : `${md} ${wd}`
  return v.length > 10 ? `${head} ${hmKo(d)}` : head
}

export function quick(now = new Date()): WhenQuick[] {
  const t0 = day0(now), mi = monIdx(now)
  const at = (d: Date, h: number) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return isoDT(x) }
  const out: Omit<WhenQuick, 'sub'>[] = []
  if (now.getHours() < 18) out.push({ k: 'eve', label: '오늘 저녁', at: at(t0, 19) })
  out.push({ k: 'tmr', label: '내일', at: at(add(t0, 1), 9) })
  if (mi < 4) out.push({ k: 'wkd', label: '주말', at: at(add(t0, 5 - mi), 10) })
  out.push({ k: 'nwk', label: '다음 주', at: at(add(t0, 7 - mi), 9) })
  return out.map((o) => ({ ...o, sub: short(o.at, now) }))
}

export const W = { parse, short, long, quick }
