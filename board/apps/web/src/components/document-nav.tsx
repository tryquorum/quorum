import { useEffect, useState } from 'react'
import { FileText, Plus, Star } from 'lucide-react'
import { SidebarGroupAction, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { Section } from '@/components/app-sidebar'
import { useDocCreate, type DocCreateContext } from '@/components/doc-create'
import { DocTree } from '@/components/doc-tree-nav'
import { api } from '@/lib/api'
import { fetchDocMeta, searchDocs, type SearchResult } from '@/lib/docs-api'
import { kindLabel } from '@/lib/doc-labels'

export const FAVORITES_KEY = 'db:document-favorites'
export const FAVORITES_EVENT = 'docs:favorites'
export function readFavorites(): string[] {
  try { const v = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
}

/** 문서 페이지에서 앱 사이드바 아래에 붙는 노션식 문서 탐색: 즐겨찾기, 종류별 트리, 최근 문서.
 *  onOpen 은 사이드바의 navigate 를 거쳐 제목 포커스·모바일 시트 닫기를 다른 링크와 같게 한다 */
export function DocumentNav({ docRef, onOpen }: { docRef: string; onOpen: (ref: string) => void }) {
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [recent, setRecent] = useState<SearchResult['results']>([])
  const [error, setError] = useState(false)
  const [favorites, setFavorites] = useState(readFavorites)
  const { open: openCreate } = useDocCreate()
  const { isMobile, setOpenMobile } = useSidebar()
  // 좁은 화면의 사이드바는 시트라 먼저 닫고(포커스 가둠이 풀린 뒤) 새 문서 시트를 연다. 닫히면 사이드바 버튼으로 돌아간다
  const create = (from: HTMLElement, ctx: DocCreateContext = {}) => {
    if (!isMobile) return openCreate(ctx, from)
    setOpenMobile(false)
    window.setTimeout(() => openCreate(ctx, document.querySelector<HTMLElement>('[data-sidebar="trigger"]')), 260)
  }
  // 지금 문서의 조상(트리에서 펼쳐 둘 길)
  const [path, setPath] = useState<string[]>([])
  useEffect(() => { let live = true; fetchDocMeta(docRef).then((m) => { if (live) setPath((m.ancestors ?? []).map((a) => a.ref)) }).catch(() => {}); return () => { live = false } }, [docRef])
  useEffect(() => {
    let live = true, seq = 0
    const load = () => { const id = ++seq; searchDocs({ includeAi: true }).then((v) => { if (live && id === seq) { setRecent(v.results); setError(false) } }).catch(() => { if (live && id === seq) setError(true) }) }
    const fav = () => setFavorites(readFavorites())
    load(); window.addEventListener('docs:changed', load); window.addEventListener(FAVORITES_EVENT, fav); window.addEventListener('storage', fav)
    return () => { live = false; window.removeEventListener('docs:changed', load); window.removeEventListener(FAVORITES_EVENT, fav); window.removeEventListener('storage', fav) }
  }, [])
  // 최근 20개 밖의 즐겨찾기는 제목만 따로 읽어 온다
  useEffect(() => {
    let live = true
    for (const ref of favorites) if (!recent.some((x) => x.ref === ref)) api<{ title: string }>(`/api/docs/${encodeURIComponent(ref)}?view=markdown&maxChars=200`).then((d) => { if (live && d.title) setTitles((old) => ({ ...old, [ref]: d.title })) }).catch(() => {})
    return () => { live = false }
  }, [favorites, recent])
  const open = (ref: string) => onOpen(ref)
  const titleOf = (ref: string) => recent.find((x) => x.ref === ref)?.title || titles[ref] || ref
  const item = (ref: string, title: string, icon = <FileText />, hint?: string) => <SidebarMenuItem key={ref}><SidebarMenuButton size='sm' isActive={ref === docRef} onClick={() => open(ref)} title={hint ? `${title} · ${hint}` : title}>{icon}<span>{title}</span></SidebarMenuButton></SidebarMenuItem>
  return <>
    <Section id='doc-favorites' label='즐겨찾기' count={favorites.length}>
      {favorites.length ? <SidebarMenu>{favorites.map((ref) => item(ref, titleOf(ref), <Star />))}</SidebarMenu> : <p className='px-2 text-xs text-muted-foreground' title='이 브라우저에만 저장돼요'>☆ 로 추가해요</p>}
    </Section>
    <Section id='doc-tree' label='문서 트리' count={0} action={<SidebarGroupAction type='button' aria-label='새 문서' title='새 문서' onClick={(e) => create(e.currentTarget)}><Plus /></SidebarGroupAction>}>
      <DocTree current={docRef} path={path} onOpen={open} onCreate={(ctx, from) => create(from, ctx)} />
    </Section>
    <Section id='doc-recent' label='최근 문서' count={recent.length}>
      {error && <p role='alert' className='px-2 text-xs'>문서 목록을 불러오지 못했어요.</p>}
      <SidebarMenu>{recent.slice(0, 8).map((hit) => item(hit.ref, hit.title, <FileText />, kindLabel(hit.kind)))}</SidebarMenu>
    </Section>
  </>
}
