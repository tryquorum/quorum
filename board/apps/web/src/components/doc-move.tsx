// 문서 옮기기 대화상자(계층): 맨 위부터 폴더처럼 들어가 고르거나(→ 안으로, ← 위로), 검색어로 전체에서 찾아요. 키 m, 문서 페이지·사이드바 ⋯ 메뉴에서 열어요.
// 자기·자손·보관 문서는 후보에서 빼요(자손은 대화상자를 열 때 읽어 둬요). 목록은 50·30개씩, "더 보기"로 이어 읽어요.
// 서버가 순환·깊이를 409 로 거절하면 이유를 그대로 보여요.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { ChevronRight, CornerLeftUp, CornerDownRight, FileText, FolderTree } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ApiError } from "@/lib/api"
import { childDocs, moveDoc, searchDocs, type SearchResult } from "@/lib/docs-api"
import { appendPage, collectDescendants, moveCandidates, moveError } from "@/lib/doc-tree"

type Target = { ref: string; title: string; parent?: string | null }
type Api = { openMove: (doc: Target, returnTo?: HTMLElement | null) => void }
type Hit = SearchResult["results"][number]
type Page = { items: Hit[]; next?: string; state: "loading" | "ok" | "error" }
const Ctx = createContext<Api | null>(null)
/** 옮기기 대화상자 열기. 문서 화면이 아니면(Provider 밖) 아무것도 하지 않아요 */
export function useDocMove(): Api {
  return useContext(Ctx) ?? { openMove: () => {} }
}

function MoveDialog({ doc, onBusy, onDone }: { doc: Target; onBusy: (busy: boolean) => void; onDone: () => void }) {
  const [q, setQ] = useState("")
  const [trail, setTrail] = useState<{ ref: string; title: string }[]>([])
  const [page, setPage] = useState<Page>({ items: [], state: "loading" })
  const [descendants, setDescendants] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [highlight, setHighlight] = useState("")
  const req = useRef(0)
  const here = trail[trail.length - 1] ?? null
  const searching = !!q.trim()
  const fetchPage = useCallback((cursor?: string) => searching
    ? searchDocs({ q, kinds: ["doc"], includeAi: true, limit: 30, ...(cursor ? { cursor } : {}) })
    : childDocs(here?.ref ?? null, cursor), [searching, q, here])
  // 검색어·들어간 위치가 바뀌면 처음부터 다시 읽어요. 옛 요청의 늦은 응답은 버려요
  useEffect(() => {
    const id = ++req.current
    setError(""); setPage({ items: [], state: "loading" })
    const t = setTimeout(() => {
      fetchPage().then((r) => { if (req.current === id) setPage({ items: r.results, next: r.nextCursor, state: "ok" }) })
        .catch(() => { if (req.current === id) { setPage({ items: [], state: "error" }); setError("옮길 곳을 불러오지 못했어요") } })
    }, searching ? 200 : 0)
    return () => clearTimeout(t)
  }, [fetchPage, searching])
  // 검색 결과에서 자기 하위 문서를 빼려고 자손을 한 번 읽어 둬요(못 읽어도 서버가 순환을 거절해요)
  useEffect(() => {
    let live = true
    collectDescendants(doc.ref, (p, c) => childDocs(p, c)).then((d) => { if (live) setDescendants(d.refs) }, () => {})
    return () => { live = false }
  }, [doc.ref])
  const more = () => {
    const cursor = page.next, id = req.current
    if (!cursor || page.state === "loading") return
    setPage((p) => ({ ...p, state: "loading" }))
    fetchPage(cursor).then((r) => { if (req.current === id) setPage((p) => ({ items: appendPage(p.items, r.results), next: r.nextCursor, state: "ok" })) })
      .catch(() => { if (req.current === id) { setPage((p) => ({ ...p, state: "ok" })); setError("더 불러오지 못했어요") } })
  }
  const candidates = useMemo(() => moveCandidates(page.items, doc.ref, descendants), [page.items, doc.ref, descendants])
  const enter = (h: { ref: string; title: string }) => { setTrail((t) => [...t, { ref: h.ref, title: h.title || "제목 없음" }]); setQ("") }
  const up = (depth: number) => setTrail((t) => t.slice(0, depth))
  const go = async (parent: string | null, title: string) => {
    if (busy) return
    setBusy(true); onBusy(true); setError("")
    try {
      await moveDoc({ ref: doc.ref, parent })
      toast("옮겼어요", { description: `${doc.title} → ${title}` })
      onBusy(false); onDone()
    } catch (e) {
      setError(e instanceof ApiError ? moveError(e.status, e.message) : "옮기지 못했어요. 다시 시도해 주세요")
      onBusy(false)
    } finally { setBusy(false) }
  }
  // → 하위 문서가 있는 후보 안으로, ← (검색어 없을 때) 한 단계 위로
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || busy) return
    if (e.key === "ArrowRight" && !searching) {
      const h = candidates.find((x) => x.ref === highlight)
      if (h && (h.children ?? 0) > 0) { e.preventDefault(); enter(h) }
    } else if ((e.key === "ArrowLeft" || e.key === "Backspace") && !q && trail.length) {
      e.preventDefault(); up(trail.length - 1)
    }
  }
  const loading = page.state === "loading" && !page.items.length
  return (
    <Command shouldFilter={false} loop value={highlight} onValueChange={setHighlight} onKeyDown={onKeyDown} className="rounded-none">
      <CommandInput value={q} onValueChange={setQ} placeholder={here ? `"${here.title}" 안에서… (쓰면 전체 검색)` : "옮길 곳 찾기"} aria-label="옮길 곳 찾기" />
      {!searching && trail.length > 0 && (
        <nav aria-label="옮길 곳 경로" className="flex min-w-0 flex-wrap items-center gap-1 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <button type="button" className="hover:text-foreground" onClick={() => up(0)}>맨 위</button>
          {trail.map((t, i) => <span key={t.ref} className="flex min-w-0 items-center gap-1"><ChevronRight aria-hidden className="size-3" />
            {i === trail.length - 1 ? <span className="max-w-[12rem] truncate text-foreground" aria-current="location">{t.title}</span> : <button type="button" className="max-w-[10rem] truncate hover:text-foreground" onClick={() => up(i + 1)}>{t.title}</button>}</span>)}
        </nav>
      )}
      <CommandList className="max-h-[min(360px,55vh)]">
        {error && <p role="alert" className="px-4 py-2 text-xs text-destructive">{error}</p>}
        {loading && <p role="status" className="px-4 py-2 text-xs text-muted-foreground">찾는 중…</p>}
        {page.state === "ok" && !candidates.length && <CommandEmpty>{searching ? "맞는 문서가 없어요" : "하위 문서가 없어요"}</CommandEmpty>}
        {(candidates.length > 0 || !!page.next || (!searching && (!!here || doc.parent !== null))) && <CommandGroup heading={searching ? "찾은 문서" : here ? `"${here.title}" 아래` : "맨 위 문서"}>
          {!searching && !here && doc.parent !== null && <CommandItem value="root" disabled={busy} onSelect={() => void go(null, "맨 위")}><CornerLeftUp />맨 위로</CommandItem>}
          {!searching && here && <CommandItem value="here" disabled={busy || here.ref === doc.parent} onSelect={() => void go(here.ref, here.title)}><CornerDownRight /><span className="min-w-0 flex-1 truncate">"{here.title}" 아래로 옮기기</span>{here.ref === doc.parent && <span className="text-xs text-muted-foreground">지금 위치</span>}</CommandItem>}
          {candidates.map((h) => {
            const folder = (h.children ?? 0) > 0
            return (
              // 지금 부모 행은 그리로 옮길 수 없지만, 그 안의 다른 곳으로 가려면 들어갈 수 있어야 해요(고르면 안으로)
              <CommandItem key={h.ref} value={h.ref} disabled={busy} onSelect={() => { if (h.ref !== doc.parent) void go(h.ref, h.title); else if (folder && !searching) enter(h) }}>
                {folder ? <FolderTree /> : <FileText />}
                <span className="min-w-0 flex-1 truncate">{h.title || "제목 없음"}</span>
                {h.ref === doc.parent && <span className="text-xs text-muted-foreground">지금 위치</span>}
                {folder && !searching && (
                  <button type="button" tabIndex={-1} aria-hidden title="안으로 (→)"
                    onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); enter(h) }}
                    className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronRight className="size-3.5" /></button>
                )}
              </CommandItem>
            )
          })}
          {page.next && <CommandItem value="more" disabled={page.state === "loading"} onSelect={more} className="text-muted-foreground">{page.state === "loading" ? "불러오는 중…" : "더 보기"}</CommandItem>}
        </CommandGroup>}
      </CommandList>
    </Command>
  )
}

export function DocMoveProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<Target | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  // 옮기는 요청이 진행 중이면 닫지 않아요(닫고 다른 문서 창을 연 뒤 옛 요청 완료가 새 창을 닫지 않게)
  const busy = useRef(false)
  const openMove = useCallback<Api["openMove"]>((d, from) => {
    if (!d.ref.startsWith("doc:") || busy.current) return
    returnTo.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setDoc(d)
  }, [])
  const value = useMemo(() => ({ openMove }), [openMove])
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={!!doc} onOpenChange={(o) => { if (!o && !busy.current) setDoc(null) }}>
        <DialogContent className="top-[14vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg" onCloseAutoFocus={(e) => { e.preventDefault(); if (returnTo.current?.isConnected) returnTo.current.focus() }}>
          <DialogTitle className="px-4 pt-4 text-base">{doc ? `"${doc.title || "제목 없음"}" 옮기기` : "옮기기"}</DialogTitle>
          <DialogDescription className="px-4 pb-2 text-xs">고른 문서 아래로 옮겨요. → 로 안에 들어가고 ← 로 나와요. 자기 아래나 하위 문서 아래로는 옮길 수 없어요</DialogDescription>
          {doc && <MoveDialog key={doc.ref} doc={doc} onBusy={(b) => { busy.current = b }} onDone={() => setDoc(null)} />}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  )
}
