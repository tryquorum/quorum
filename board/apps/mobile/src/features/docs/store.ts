// 문서 탭 화면 기억(보기·그룹·열 축·표시할 속성·트리 펼침)과 즐겨찾기. 비밀이 아닌 설정이라 앱 문서 폴더 파일에 둬요(storage.ts 와 같은 방식).
// 웹은 localStorage(db:docs-view, db:document-favorites, db:doc-tree-open)에 둬요. 읽기 실패는 기본값, 쓰기 실패는 false 로 알려요.
import { File, Paths } from 'expo-file-system'
import { useCallback, useEffect, useState } from 'react'
import type { DocsGroup } from './groups'

export type DocsView = 'list' | 'icon' | 'gallery' | 'columns' | 'tree'
export type ColumnAxis = 'kind' | 'tag' | 'link' | 'folder'
export type DocsUi = { view: DocsView; group: DocsGroup; axis: ColumnAxis; columns: string[]; open: string[] }
const DEFAULT_UI: DocsUi = { view: 'list', group: 'none', axis: 'kind', columns: [], open: [] }

const file = (name: string) => new File(Paths.document, name)
async function readJson(name: string): Promise<unknown> {
  try {
    const f = file(name)
    return f.exists ? JSON.parse(await f.text()) : null
  } catch {
    return null
  }
}
async function writeJson(name: string, value: unknown): Promise<boolean> {
  try {
    const f = file(name)
    if (!f.exists) f.create()
    await f.write(JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const VIEWS: DocsView[] = ['list', 'icon', 'gallery', 'columns', 'tree']
const AXES: ColumnAxis[] = ['kind', 'tag', 'link', 'folder']
const GROUPS: DocsGroup[] = ['none', 'kind', 'area', 'status']
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
/** 저장된 값을 믿지 않고 하나씩 검사해요(깨진 값은 기본값) */
export function cleanUi(v: unknown): DocsUi {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    view: VIEWS.includes(o.view as DocsView) ? (o.view as DocsView) : DEFAULT_UI.view,
    group: GROUPS.includes(o.group as DocsGroup) ? (o.group as DocsGroup) : DEFAULT_UI.group,
    axis: AXES.includes(o.axis as ColumnAxis) ? (o.axis as ColumnAxis) : DEFAULT_UI.axis,
    columns: strings(o.columns),
    open: strings(o.open),
  }
}

// 앱 안에서 한 벌만 둬요(목록·트리·문서 페이지가 같은 값을 보게)
let ui: DocsUi = DEFAULT_UI
let favorites: string[] = []
let loaded: Promise<void> | null = null
const subs = new Set<() => void>()
let lastWriteFailed = false
const notify = () => subs.forEach((s) => s())
function load() {
  loaded ??= Promise.all([readJson('docs-ui.json'), readJson('doc-favorites.json')]).then(([u, f]) => {
    ui = cleanUi(u)
    favorites = strings(f)
    notify()
  })
  return loaded
}

export function useDocsUi(): { ui: DocsUi; setUi: (patch: Partial<DocsUi>) => void; saveFailed: boolean } {
  const [, tick] = useState(0)
  useEffect(() => {
    const s = () => tick((n) => n + 1)
    subs.add(s)
    void load()
    return () => {
      subs.delete(s)
    }
  }, [])
  const setUi = useCallback((patch: Partial<DocsUi>) => {
    ui = { ...ui, ...patch }
    notify()
    void writeJson('docs-ui.json', ui).then((ok) => {
      lastWriteFailed = !ok
      notify()
    })
  }, [])
  return { ui, setUi, saveFailed: lastWriteFailed }
}

export function useFavorites(): { favorites: string[]; toggle: (ref: string) => void; isFavorite: (ref: string) => boolean; saveFailed: boolean } {
  const [, tick] = useState(0)
  useEffect(() => {
    const s = () => tick((n) => n + 1)
    subs.add(s)
    void load()
    return () => {
      subs.delete(s)
    }
  }, [])
  const toggle = useCallback((ref: string) => {
    favorites = favorites.includes(ref) ? favorites.filter((x) => x !== ref) : [...favorites, ref]
    notify()
    void writeJson('doc-favorites.json', favorites).then((ok) => {
      lastWriteFailed = !ok
      notify()
    })
  }, [])
  return { favorites, toggle, isFavorite: (ref) => favorites.includes(ref), saveFailed: lastWriteFailed }
}
