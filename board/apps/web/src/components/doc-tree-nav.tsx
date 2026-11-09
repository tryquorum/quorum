// 사이드바 "문서 트리": 맨 위 문서부터 펼쳐 보는 계층(독립 문서만). 펼칠 때 50개씩, 행마다 + (그 아래 새 문서)·⋯(하위 문서·이동·맨 위로),
// 끌어 옮기기(가운데 = 그 아래, 위·아래 4분의 1 = 앞·뒤). 설계: docs/internals/doc-hierarchy.md 13절
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ChevronRight, FileText, MoreHorizontal, Plus } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { DocCreateContext } from "@/components/doc-create"
import { useDocMove } from "@/components/doc-move"
import { ApiError } from "@/lib/api"
import { childDocs, moveDoc, type SearchResult } from "@/lib/docs-api"
import { appendPage, createGenerations, dropZone, moveError, moveFor, OPEN_KEY, readOpen, toggleOpen, type Zone } from "@/lib/doc-tree"
import { cn } from "@/lib/utils"

type Hit = SearchResult["results"][number]
type Branch = { items: Hit[]; next?: string; state: "loading" | "ok" | "error" }
const keyOf = (parent: string | null) => parent ?? "root"
const storage = () => { try { return localStorage } catch { return null } }
const DRAG = "text/x-direction-doc"

export function DocTree({ current, path, onOpen, onCreate }: { current: string; path: string[]; onOpen: (ref: string) => void; onCreate: (ctx: DocCreateContext, from: HTMLElement) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => readOpen(storage()))
  const [branches, setBranches] = useState<Record<string, Branch>>({})
  const [hint, setHint] = useState<{ ref: string; zone: Zone } | null>(null)
  const dragged = useRef<string | null>(null)
  const loaded = useRef(new Set<string>())
  const gens = useRef(createGenerations())
  const { openMove } = useDocMove()
  // 새로 읽기는 그 가지의 세대를 올려요. 늦게 온 옛 응답(이동 전 목록)은 버리고, 이어 읽기는 같은 세대일 때만 붙여요
  const load = useCallback((parent: string | null, more?: string) => {
    const key = keyOf(parent)
    loaded.current.add(key)
    const g = more ? gens.current.current(key) : gens.current.fresh(key)
    setBranches((b) => ({ ...b, [key]: { items: b[key]?.items ?? [], next: b[key]?.next, state: "loading" } }))
    childDocs(parent, more).then((r) => {
      if (!gens.current.isCurrent(key, g)) return
      setBranches((b) => ({ ...b, [key]: { items: more ? appendPage(b[key]?.items ?? [], r.results) : r.results, next: r.nextCursor, state: "ok" } }))
    }).catch(() => {
      if (!gens.current.isCurrent(key, g)) return
      setBranches((b) => ({ ...b, [key]: { items: b[key]?.items ?? [], next: b[key]?.next, state: "error" } }))
    })
  }, [])
  // 처음엔 맨 위, 지금 문서의 조상은 펼쳐 둬요
  useEffect(() => { load(null) }, [load])
  useEffect(() => { setOpen((o) => { const n = new Set(o); for (const r of path) n.add(r); return n }) }, [path])
  useEffect(() => { for (const r of open) if (!loaded.current.has(r)) load(r) }, [open, load])
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])) } catch { /* 기억 못 해도 지금은 펼쳐져요 */ } }, [open])
  // 문서가 바뀌면 읽어 둔 가지를 다시 읽어요
  useEffect(() => {
    const changed = () => { for (const key of loaded.current) load(key === "root" ? null : key) }
    window.addEventListener("docs:changed", changed)
    return () => window.removeEventListener("docs:changed", changed)
  }, [load])
  const drop = async (target: Hit, zone: Zone, chain: string[]) => {
    const ref = dragged.current
    dragged.current = null; setHint(null)
    if (!ref) return
    const input = moveFor(ref, { ref: target.ref, parent: target.parent ?? null }, zone, chain)
    if (!input) return toast("거기로는 옮길 수 없어요", { description: "자기 아래나 하위 문서 아래예요" })
    try { await moveDoc(input); if (zone === "inside") setOpen((o) => toggleOpen(o, target.ref, true)) }
    catch (e) { toast(e instanceof ApiError ? moveError(e.status, e.message) : "옮기지 못했어요") }
  }
  const toRoot = async (h: Hit) => { try { await moveDoc({ ref: h.ref, parent: null }) } catch (e) { toast(e instanceof ApiError ? moveError(e.status, e.message) : "옮기지 못했어요") } }
  const branch = (parent: string | null, level: number, chain: string[]): React.ReactNode => {
    const b = branches[keyOf(parent)]
    if (!b) return null
    return <>
      {b.items.map((h) => {
        // 이 가지를 새로 읽는 중이거나 읽지 못했으면 보이는 행은 옛 위치일 수 있어요. 끌기·놓기·옮기기를 막아요
        const stale = b.state !== "ok"
        const has = (h.children ?? 0) > 0, isOpen = has && open.has(h.ref)
        const zone = hint?.ref === h.ref ? hint.zone : null
        return <div key={h.ref} role="treeitem" aria-level={level} aria-expanded={has ? isOpen : undefined} aria-selected={h.ref === current}>
          <div draggable={!stale} aria-busy={stale || undefined} onDragStart={(e) => { if (stale) return e.preventDefault(); dragged.current = h.ref; e.dataTransfer.setData(DRAG, h.ref); e.dataTransfer.effectAllowed = "move" }}
            onDragEnd={() => { dragged.current = null; setHint(null) }}
            onDragOver={(e) => { if (stale || !dragged.current || dragged.current === h.ref) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setHint({ ref: h.ref, zone: dropZone(e.clientY - r.top, r.height) }) }}
            onDragLeave={() => setHint((x) => (x?.ref === h.ref ? null : x))}
            onDrop={(e) => { e.preventDefault(); if (stale) { dragged.current = null; setHint(null); return } void drop(h, zone ?? "inside", chain) }}
            className={cn("group/row relative flex h-7 items-center gap-1 rounded-md pr-1 text-sm hover:bg-sidebar-accent", stale && "opacity-60", h.ref === current && "bg-sidebar-accent font-medium", zone === "inside" && "ring-2 ring-running", zone === "before" && "before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:bg-running", zone === "after" && "after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-running")}
            style={{ paddingLeft: 4 + (level - 1) * 12 }}>
            <button type="button" aria-label={isOpen ? `${h.title} 접기` : `${h.title} 펼치기`} disabled={!has} onClick={() => setOpen((o) => toggleOpen(o, h.ref))}
              className={cn("grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground disabled:opacity-0")}><ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} /></button>
            <button type="button" onClick={() => onOpen(h.ref)} title={h.title} className="flex min-w-0 flex-1 items-center gap-1.5 text-left"><FileText className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{h.title || "제목 없음"}</span></button>
            <span className="flex shrink-0 items-center opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 max-md:opacity-100">
              <button type="button" aria-label={`${h.title} 아래에 새 문서`} title="아래에 새 문서" onClick={(e) => onCreate({ parent: { ref: h.ref, title: h.title }, area: h.area }, e.currentTarget)} className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"><Plus className="size-3.5" /></button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" aria-label={`${h.title} 메뉴`} className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuItem onSelect={() => onCreate({ parent: { ref: h.ref, title: h.title }, area: h.area }, document.body)}>하위 문서 만들기</DropdownMenuItem>
                  <DropdownMenuItem disabled={stale} onSelect={() => openMove({ ref: h.ref, title: h.title, parent: h.parent ?? null })}>이동…<DropdownMenuShortcut>M</DropdownMenuShortcut></DropdownMenuItem>
                  {h.parent && <DropdownMenuItem disabled={stale} onSelect={() => void toRoot(h)}>맨 위로</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
          {isOpen && <div role="group">{branch(h.ref, level + 1, [...chain, h.ref])}</div>}
        </div>
      })}
      {b.state === "loading" && !b.items.length && <p className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: 8 + (level - 1) * 12 }}>불러오는 중…</p>}
      {b.state === "error" && <p role="alert" className="px-2 py-1 text-xs" style={{ paddingLeft: 8 + (level - 1) * 12 }}>불러오지 못했어요 <button type="button" className="underline" onClick={() => load(parent)}>다시</button></p>}
      {b.state === "ok" && !b.items.length && level === 1 && <p className="px-2 py-1 text-xs text-muted-foreground">문서가 없어요</p>}
      {b.next && b.state !== "loading" && <button type="button" className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground" style={{ paddingLeft: 8 + (level - 1) * 12 }} onClick={() => load(parent, b.next)}>더 보기</button>}
    </>
  }
  return <div role="tree" aria-label="문서 트리" className="flex flex-col"
    onDragOver={(e) => { if (dragged.current && e.target === e.currentTarget) e.preventDefault() }}>{branch(null, 1, [])}</div>
}
