import { describe, expect, test } from 'bun:test'
import type { Board, Item, SearchResult, Signal } from '@direction-board/contracts'
import { searchGroups, type SearchInput } from './groups'

const board: Board = { id: 'b', name: '개인', kind: 'personal', mine: true, deleted: false, areas: [] }
const item = (id: string, text = id): Item => ({ id, boardId: 'b', type: 'todo', text, x: 0, y: 0, w: 0, h: 0 })
const signal = (id: string): Signal => ({ id, ref: null, source: 'github', kind: 'done', title: id, body: null, url: null, area: null, task: null, agent: null, lane: 'now', reason: null, needs_ai: false, status: 'open', private: false, sample: false, due: null, meta: null, created_at: 0, updated_at: 0, resolved_at: null })
const docs = (titles: string[]): SearchResult => ({ results: titles.map((t, i) => ({ ref: 'doc:' + i, kind: 'doc', title: t })) }) as unknown as SearchResult
const base: SearchInput = { query: '', items: [item('a'), item('b')], boards: [board], signals: [signal('s')], signalsStatus: 'ok', docs: null, routes: [], quickAdd: false, canSweep: true }
const titles = (input: Partial<SearchInput>) => searchGroups({ ...base, ...input }).groups.map((g) => g.title)

describe('검색 탭 묶음', () => {
  test('빈 검색: 탭 밖 화면, 안 끝난 일, 열린 사건, 빠른 실행(제스처·순회)', () => {
    const r = searchGroups(base)
    expect(r.groups.map((g) => g.title)).toEqual(['화면', '안 끝난 할 일 · 목표', '열린 사건', '빠른 실행'])
    expect(r.groups[3]?.rows.map((x) => x.label)).toEqual(['제스처', '지금 순회 돌리기', '운영 순회 설정'])
    // 탭 필에 있는 화면은 빈 검색에서 빼요
    expect(r.groups[0]?.rows.map((x) => x.label)).toEqual(['설정'])
  })
  test('앱에 없는 화면(목표·결정 칸·보드)은 라우트가 등록됐을 때만', () => {
    expect(searchGroups({ ...base, query: '보드' }).groups.find((g) => g.title === '화면')).toBeUndefined()
    expect(searchGroups({ ...base, query: '보드', routes: ['Board'] }).groups.find((g) => g.title === '화면')?.rows.map((r) => r.label)).toEqual(['보드'])
  })
  test('검색어가 순회 명령에 맞으면 명령 묶음, 맥 주인이 아니면 돌리기는 빠져요', () => {
    expect(titles({ query: '순회' })).toContain('명령')
    expect(searchGroups({ ...base, query: '순회', canSweep: false }).groups.find((g) => g.title === '명령')?.rows.map((r) => r.label)).toEqual(['운영 순회 설정'])
  })
  test('설정 검색은 앱 항목으로(단축키 → 제스처, 서버 주소)', () => {
    const settings = (q: string) => searchGroups({ ...base, query: q }).groups.find((g) => g.title === '설정')?.rows
    expect(settings('서버')?.[0]?.label).toBe('서버 주소')
    expect(settings('단축키')?.map((r) => r.hint)).toContain('설정 · 제스처')
    expect(settings('토큰')?.[0]?.target).toEqual({ type: 'settings', section: 'connections', item: 'mcp-tokens' })
  })
  test('이름이 화면·설정과 정확히 같으면 문서를 뒤로(GAP-10)', () => {
    expect(titles({ query: '설정', docs: docs(['설정 메모']) })[0]).toBe('화면')
    expect(titles({ query: '메모', docs: docs(['메모']) })[0]).toBe('문서')
  })
  test('검색어가 있으면 AI에게 묻기가 맨 앞, 빠른 추가 시트가 있으면 할 일로 추가', () => {
    const quick = (input: Partial<SearchInput>) => searchGroups({ ...base, ...input }).groups.find((g) => g.title === '빠른 실행')?.rows.map((r) => r.label)
    expect(quick({ query: '우유 사기' })).toEqual(['AI에게 묻기: 우유 사기'])
    expect(quick({ query: '우유 사기', quickAdd: true })).toEqual(['AI에게 묻기: 우유 사기', '할 일로 추가: 우유 사기'])
  })
  test('아무것도 없으면 nothing', () => {
    expect(searchGroups({ ...base, query: 'zzqq', docs: docs([]) }).nothing).toBe(true)
  })
})
