// 새 문서: 문서 목록 머리의 한 줄(Enter = 제목만으로 바로 만들고 전체화면으로) + [+] 상세 시트.
// 문서 페이지·사이드바 문서 트리의 + 도 같은 시트를 그 자리 맥락(영역·연결)으로 연다. 빠른 추가(quick-add.tsx)와 같은 모양.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { CircleAlert, Circle, FileText, FolderTree, Hash, Link2, ListPlus, Plus, X } from "lucide-react"
import type { PropType } from "@direction-board/contracts"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useIsMobile } from "@/hooks/use-mobile"
import { createDoc, docsSchema, fetchDocMeta, patchDocumentProps, searchDocs } from "@/lib/docs-api"
import { createDocSteps, confirmKey, emptyDraft, findSameDoc, gate, titleKey, type DocCreateDeps, type DocCreateResult, type DocDraft, type DocResume, type SameCheck } from "@/lib/doc-create"
import type { DraftProp } from "@/lib/quick-add"
import { SAME_TITLE_MIN } from "@direction-board/contracts"
import { cn } from "@/lib/utils"
import { useShortcut } from "@/components/shortcut-dispatch"
import { composing, matches } from "@/lib/shortcuts"

/** 만들 자리의 맥락. links 는 만든 문서가 '관련' 으로 이어질 문서 */
/** parent: 그 문서 아래에 만들기(계층). linksOn=false 면 연결 칩은 꺼진 채로 보여요 */
export type DocCreateContext = { area?: string | null; links?: { ref: string; title: string }[]; title?: string; parent?: { ref: string; title: string }; linksOn?: boolean }
type BarPending = { draft: DocDraft; result: Exclude<DocCreateResult, { status: "done" }> } | null
type Api = { open: (ctx?: DocCreateContext, returnTo?: HTMLElement | null) => void; openDoc: (ref: string) => void; barPending: BarPending; setBarPending: (p: BarPending) => void }
const Ctx = createContext<Api | null>(null)
export function useDocCreate() {
  const c = useContext(Ctx)
  if (!c) throw new Error("DocCreateProvider 밖에서 썼어요")
  return c
}

const newId = () => crypto.randomUUID()
const deps: DocCreateDeps = {
  create: (input) => createDoc(input),
  setProps: (ref, body) => patchDocumentProps(ref, body),
  readMeta: async (ref) => { const m = await fetchDocMeta(ref); return { version: m.version, props: Array.isArray(m.frontmatter.props) ? m.frontmatter.props as never : [] } },
}

/** 제목이 멈추면(250ms) 서버에 같은 제목을 묻는다. ensure 는 만들기 직전에 지금 제목의 결과를 기다린다 */
function useSameTitle(title: string) {
  const [check, setCheck] = useState<SameCheck | null>(null)
  const inflight = useRef(new Map<string, Promise<SameCheck>>())
  // fresh: 만들기 직전에는 캐시를 쓰지 않고 다시 물어요(다른 탭·기기에서 그 사이 만든 문서도 보게)
  const ask = useCallback((t: string, fresh = false): Promise<SameCheck> => {
    const key = titleKey(t)
    const old = inflight.current.get(key)
    if (old && !fresh) return old
    const p = searchDocs({ sameTitle: t, kinds: ["doc"], includeAi: true, limit: 5 })
      .then((r): SameCheck => ({ key, state: "ok", hits: r.results.map((h) => ({ ref: h.ref, title: h.title, status: h.status })) }))
      .catch((): SameCheck => { inflight.current.delete(key); return { key, state: "error" } })
    inflight.current.set(key, p)
    return p
  }, [])
  useEffect(() => {
    const key = titleKey(title)
    if (key.length < SAME_TITLE_MIN) { setCheck(null); return }
    let live = true
    setCheck((c) => (c?.key === key ? c : { key, state: "loading" }))
    const t = setTimeout(() => { void ask(title).then((c) => { if (live) setCheck(c) }) }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [title, ask])
  const ensure = useCallback(async (t: string) => { const c = await ask(t, true); setCheck(c); return c }, [ask])
  // 문서가 새로 생기면 지난 확인은 낡았다
  useEffect(() => { const clear = () => inflight.current.clear(); window.addEventListener("docs:changed", clear); return () => window.removeEventListener("docs:changed", clear) }, [])
  return { check, ensure }
}

/** 같은 제목 경고 한 줄. armed 면 한 번 더 누르면 만든다 */
function SameDocWarning({ check, title, armed, onOpen }: { check: SameCheck | null; title: string; armed: boolean; onOpen: (ref: string) => void }) {
  if (!check || check.key !== titleKey(title) || check.state === "loading") return null
  const hit = check.state === "ok" ? findSameDoc(check.hits, title) : null
  if (check.state === "ok" && !hit) return null
  return (
    <p role="status" className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <CircleAlert className="size-3.5" />
      {hit ? <><span>같은 제목의 문서가 있어요</span><button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => onOpen(hit.ref)}>열기</button></> : <span>같은 제목인지 확인하지 못했어요</span>}
      {armed && <span>· 한 번 더 누르면 만들어요</span>}
    </p>
  )
}

/** 실패 안내 한 줄 */
function Failure({ result, onOpen }: { result: Exclude<DocCreateResult, { status: "done" }>; onOpen: (ref: string) => void }) {
  const ref = result.status === "failed" && result.step === "doc" ? null : result.ref
  const text = result.status === "conflict" ? "문서는 만들었고, 속성은 그 사이 다른 곳에서 바뀌어 넣지 않았어요"
    : result.step === "doc" ? (result.retry ? "만들었는지 확인하지 못했어요 · 다시 시도해도 두 번 생기지 않아요" : `만들지 못했어요: ${result.message}`)
    : result.retry ? "문서는 만들었고 속성을 저장했는지 확인하지 못했어요 · 다시 시도" : `문서는 만들었고 속성을 저장하지 못했어요: ${result.message}`
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
      <CircleAlert className="mt-px size-3.5 shrink-0" /><span className="min-w-0">{text}</span>
      {ref && <button type="button" className="font-medium text-foreground hover:underline" onClick={() => onOpen(ref)}>열기</button>}
    </p>
  )
}
const canRetry = (r: DocCreateResult | null) => !!r && r.status === "failed" && r.retry
const resumeOf = (r: DocCreateResult | null): DocResume | undefined => r?.status === "failed" ? (r.step === "doc" ? { step: "doc" } : { step: "props", ref: r.ref, version: r.version }) : undefined

/** 문서 목록 머리: 한 줄 + [+]. Enter 는 제목만으로 바로 만들고 그 문서를 연다 */
export function DocCreateBar({ context, className }: { context?: DocCreateContext; className?: string }) {
  const { open, openDoc, barPending: pending, setBarPending: setPending } = useDocCreate()
  // 실패한 제출은 Provider 에 있어 화면을 옮겨 갔다 와도 남아요(같은 초안·같은 id 로만 다시 보냄)
  const [text, setText] = useState(() => pending?.draft.title ?? "")
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)
  const { check, ensure } = useSameTitle(text)
  // 결과를 모르는 요청은 판정될 때까지 붙들어요: 글을 잠그고 Enter 는 같은 요청 다시 보내기(같은 id 라 두 번 생기지 않음)
  const unresolved = !!pending && canRetry(pending.result)
  const retrying = unresolved
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = text.trim()
    if (!title || busy) return
    setBusy(true)
    try {
      if (!retrying) {
        setPending(null) // 고쳐야 하는 오류(4xx)였으면 아무것도 만들어지지 않았으니 새 요청으로
        const verdict = gate(title, await ensure(title), armed)
        if (verdict !== "go") { if (verdict !== "wait") setArmed(confirmKey(verdict, title)); return }
      }
      const draft = retrying && pending ? pending.draft : emptyDraft(newId, { title, area: context?.area ?? null })
      const r = await createDocSteps(draft, deps, retrying && pending ? resumeOf(pending.result) : undefined)
      if (r.status !== "done") return setPending({ draft, result: r })
      setText(""); setArmed(null); setPending(null)
      openDoc(r.ref)
    } finally {
      setBusy(false)
    }
  }
  const shownFailure = pending && (unresolved || pending.draft.title === text.trim()) ? pending.result : null
  return (
    <form onSubmit={submit} className={cn("flex w-full min-w-0 flex-col gap-1 sm:w-72", className)}>
      <div className="flex items-center gap-1.5">
        <input value={text} readOnly={busy || unresolved} aria-busy={busy} onChange={(e) => { setText(e.target.value); setArmed(null) }} placeholder="새 문서" aria-label="새 문서 제목" aria-describedby="doc-create-hint"
          className="h-8 max-md:h-11 [@media(pointer:coarse)]:h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
        <span id="doc-create-hint" className="sr-only">Enter 로 제목만 쓴 문서를 바로 만들고 열어요. 더하기 버튼은 영역, 태그, 속성, 본문을 함께 쓰는 창을 열어요</span>
        <Button type="button" variant="outline" size="icon-sm" aria-label="자세히 만들기" aria-keyshortcuts="n" title="자세히 만들기 (N)" disabled={busy || !!shownFailure} onClick={(e) => open({ ...context, title: text }, e.currentTarget)}><Plus /></Button>
      </div>
      {shownFailure ? <div className="flex flex-wrap items-center gap-x-2"><Failure result={shownFailure} onOpen={openDoc} />{unresolved && <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { if (window.confirm("보낸 요청이 이미 문서를 만들었을 수 있어요. 그만두면 다시 시도하지 않아요. 목록에서 확인해 주세요.")) setPending(null) }}>그만두기</button>}</div> : <SameDocWarning check={check} title={text} armed={!!armed && armed.endsWith(":" + titleKey(text))} onOpen={openDoc} />}
    </form>
  )
}

/** 아이콘 + (문서 페이지 머리·사이드바 섹션 머리) */
export function DocCreateButton({ context, label = "새 문서", className, size = "icon-sm", keyHint = false }: { context?: DocCreateContext; label?: string; className?: string; size?: "icon-sm" | "icon-xs"; keyHint?: boolean }) {
  const { open } = useDocCreate()
  // keyHint: 이 화면에서 n 이 이 버튼과 같은 일을 할 때(문서 페이지 머리)
  useShortcut("docs.create", () => open(context), keyHint)
  return <Button type="button" variant="ghost" size={size} className={className} aria-label={label} aria-keyshortcuts={keyHint ? "n" : undefined} title={keyHint ? `${label} (N)` : label} onClick={(e) => { e.stopPropagation(); open(context, e.currentTarget) }}><Plus /></Button>
}

const PROP_TYPES: [PropType, string][] = [["text", "글"], ["number", "숫자"], ["date", "날짜"], ["checkbox", "체크"], ["url", "링크"], ["select", "선택"], ["list", "목록"]]
const field = "h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-h-8 items-start gap-3">
      <span className="flex h-8 w-4 shrink-0 items-center text-muted-foreground" title={label}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

function DocCreateSheet({ open, context, onOpenChange, onDone, onOpenDoc, onCloseFocus, onPending, onDiscard }: { open: boolean; context: DocCreateContext; onOpenChange: (o: boolean) => void; onDone: (ref: string) => void; onOpenDoc: (ref: string) => void; onCloseFocus: () => void; onPending: (pending: boolean) => void; onDiscard: () => void }) {
  const mobile = useIsMobile()
  const [draft, setDraft] = useState<DocDraft>(() => emptyDraft(newId, { title: context.title ?? "", area: context.area ?? null, links: context.linksOn === false ? [] : (context.links ?? []).map((l) => l.ref), parent: context.parent?.ref ?? null }))
  const [tagText, setTagText] = useState("")
  const [areas, setAreas] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)
  const [failure, setFailure] = useState<Exclude<DocCreateResult, { status: "done" }> | null>(null)
  const { check, ensure } = useSameTitle(draft.title)
  useEffect(() => { let live = true; docsSchema().then((s) => { if (live) setAreas(s.areas) }).catch(() => {}); return () => { live = false } }, [])
  // 문서가 만들어졌거나 결과를 모르면 본문 쪽 초안은 고정(같은 요청만 다시 보냄). 속성은 고쳐야 하는 오류(400 등)면 고칠 수 있어요
  const madeRef = failure && !(failure.status === "failed" && failure.step === "doc") ? failure.ref : null
  const locked = busy || (!!failure && (canRetry(failure) || !!madeRef))
  const propsLocked = busy || (!!failure && (canRetry(failure) || failure.status === "conflict"))
  // 결과를 모르는 동안 시트를 닫아도 상태를 남겨 두고(다시 열면 이어서), 보내는 중에는 닫지 않아요
  // 문서는 만들었는데 속성이 남았으면(결과 불명·고쳐야 함·충돌) 사람이 "버리기" 하기 전까지 붙들어요
  const pending = busy || canRetry(failure) || !!madeRef
  useEffect(() => { onPending(pending) }, [pending, onPending])
  const set = (patch: Partial<DocDraft>) => { setDraft((d) => ({ ...d, ...patch })); if ("title" in patch) setArmed(null) }
  const addTag = () => {
    const t = tagText.replace(/^#/, "").trim()
    if (t && !draft.tags.some((x) => x.toLowerCase() === t.toLowerCase())) set({ tags: [...draft.tags, t] })
    setTagText("")
  }
  const submit = async () => {
    const title = draft.title.trim()
    if (!title || busy || failure?.status === "conflict") return
    // 고쳐야 하는 만들기 오류(4xx)는 아무것도 만들어지지 않았으니 처음부터
    const prior = failure && !(failure.status === "failed" && failure.step === "doc" && !failure.retry) ? failure : null
    if (!prior) setFailure(null)
    setBusy(true)
    try {
      if (!prior) {
        const verdict = gate(title, await ensure(title), armed)
        if (verdict !== "go") { if (verdict !== "wait") setArmed(confirmKey(verdict, title)); return }
      }
      const typed = tagText.replace(/^#/, "").trim()
      const now = !prior && typed && !draft.tags.some((x) => x.toLowerCase() === typed.toLowerCase()) ? { ...draft, tags: [...draft.tags, typed] } : draft
      const r = await createDocSteps(now, deps, resumeOf(prior))
      setDraft(now)
      if (r.status !== "done") return setFailure(r)
      onDone(r.ref)
    } finally {
      setBusy(false)
    }
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (matches(e, "sheet.submit") && !composing(e.nativeEvent)) { e.preventDefault(); void submit() }
  }
  const filled = draft.props.filter((p) => p.key.trim() && p.value.trim())
  const body = (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
      <fieldset disabled={locked} aria-busy={busy} className="contents">
        <input autoFocus value={draft.title} onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => { if (matches(e, "sheet.submitTitle") && !composing(e.nativeEvent)) { e.preventDefault(); void submit() } }}
          placeholder="제목 없는 문서" aria-label="문서 제목" className="h-10 w-full bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground" />
        <Textarea value={draft.md} onChange={(e) => set({ md: e.target.value })} placeholder="첫 본문 (마크다운)" aria-label="첫 본문" rows={5} className="min-h-28 resize-y text-sm" />
      </fieldset>
        <div className="flex flex-col gap-2 border-t pt-3">
          <fieldset disabled={locked} className="contents">
          {context.parent && (
            <Row icon={<FolderTree className="size-4" />} label="위치">
              <button type="button" aria-pressed={!!draft.parent} onClick={() => set({ parent: draft.parent ? null : context.parent?.ref ?? null })}
                className={cn("inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2.5 text-xs", draft.parent ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}>
                <span className="truncate">{draft.parent ? context.parent.title : "맨 위"}</span><span className="shrink-0 opacity-70">{draft.parent ? "아래에" : "(누르면 그 문서 아래)"}</span></button>
            </Row>
          )}
          {(context.links ?? []).length > 0 && (
            <Row icon={<Link2 className="size-4" />} label="연결">
              {(context.links ?? []).map((l) => {
                const on = draft.links.includes(l.ref)
                return <button key={l.ref} type="button" aria-pressed={on} onClick={() => set({ links: on ? draft.links.filter((x) => x !== l.ref) : [...draft.links, l.ref] })}
                  className={cn("inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2.5 text-xs", on ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}>
                  <FileText className="size-3 shrink-0" /><span className="truncate">{l.title}</span><span className="shrink-0 opacity-70">와 연결</span></button>
              })}
            </Row>
          )}
          <Row icon={<Circle className="size-4" />} label="영역">
            <select aria-label="영역" value={draft.area ?? ""} onChange={(e) => set({ area: e.target.value || null })} className={field}>
              <option value="">영역 없음</option>
              {draft.area && !areas.includes(draft.area) && <option value={draft.area}>{draft.area}</option>}
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Row>
          <Row icon={<Hash className="size-4" />} label="태그">
            {draft.tags.map((t) => (
              <span key={t} className="inline-flex h-7 items-center gap-1 rounded-md bg-muted pl-2.5 pr-1 text-xs">
                {t}<button type="button" aria-label={`${t} 태그 빼기`} className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => set({ tags: draft.tags.filter((x) => x !== t) })}><X className="size-3" /></button>
              </span>
            ))}
            <input value={tagText} onChange={(e) => setTagText(e.target.value)} onBlur={addTag} onKeyDown={(e) => { if (matches(e, "sheet.tag") && !composing(e.nativeEvent)) { e.preventDefault(); addTag() } }} placeholder="태그" aria-label="태그 추가" className={cn(field, "w-28")} />
          </Row>
          </fieldset>
          <fieldset disabled={propsLocked} className="contents">
          <Row icon={<ListPlus className="size-4" />} label="속성">
            <div className="flex w-full flex-col gap-1.5">
              {draft.props.map((p, i) => {
                const put = (patch: Partial<DraftProp>) => set({ props: draft.props.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
                return (
                  <div key={i} className="flex flex-wrap items-center gap-1.5">
                    <input value={p.key} onChange={(e) => put({ key: e.target.value })} placeholder="이름" aria-label="속성 이름" className={cn(field, "w-28")} />
                    <select value={p.type} onChange={(e) => put({ type: e.target.value as PropType, value: "" })} aria-label="속성 종류" className={field}>{PROP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    {p.type === "checkbox"
                      ? <input type="checkbox" aria-label="속성 값" checked={p.value === "true"} onChange={(e) => put({ value: String(e.target.checked) })} className="size-4" />
                      : <input value={p.value} onChange={(e) => put({ value: e.target.value })} type={p.type === "number" ? "number" : p.type === "date" ? "date" : p.type === "url" ? "url" : "text"} placeholder={p.type === "list" ? "쉼표로 나눠요" : "값"} aria-label="속성 값" className={cn(field, "min-w-0 flex-1")} />}
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="속성 빼기" onClick={() => set({ props: draft.props.filter((_, j) => j !== i) })}><X /></Button>
                  </div>
                )
              })}
              <button type="button" className="self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => set({ props: [...draft.props, { key: "", type: "text", value: "" }] })}>속성 추가</button>
            </div>
          </Row>
          </fieldset>
        </div>
      {failure?.status === "conflict" && filled.length > 0 && (
        <textarea readOnly aria-label="저장하지 못한 속성" className="h-20 w-full rounded-md border bg-muted/30 p-2 font-mono text-xs" value={filled.map((p) => `${p.key.trim()}: ${p.value}`).join("\n")} />
      )}
      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">{failure ? <Failure result={failure} onOpen={onOpenDoc} /> : <SameDocWarning check={check} title={draft.title} armed={!!armed} onOpen={onOpenDoc} />}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => changeOpen(false)}>{madeRef || canRetry(failure) ? "닫기" : "취소"}</Button>
          {madeRef && <Button type="button" variant="ghost" disabled={busy} onClick={() => { if (window.confirm("저장하지 못한 속성을 버릴까요? 먼저 필요한 값을 복사해 주세요.")) onDiscard() }}>버리기</Button>}
          {madeRef && <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenDoc(madeRef)}>문서 열기</Button>}
          {failure?.status !== "conflict" && (
            <Button type="button" disabled={!draft.title.trim() || busy} onClick={() => void submit()} aria-keyshortcuts="Meta+Enter Control+Enter">
              {busy ? "만드는 중…" : failure && canRetry(failure) ? "다시 시도" : madeRef ? "속성 다시 저장" : armed ? "그래도 만들기" : "만들기"}
              {!busy && !failure && <kbd className="num ml-1 hidden text-2xs opacity-60 sm:inline">⌘↵</kbd>}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
  const close = (e: Event) => { e.preventDefault(); onCloseFocus() }
  // 보내는 중에는 닫지 않아요(결과를 받아야 다음에 이어서 할 수 있어요)
  const changeOpen = (o: boolean) => { if (o || !busy) onOpenChange(o) }
  const desc = "제목을 쓰고 Enter 로 만들어요. 본문, 영역, 태그, 속성은 아래에서 더해요"
  if (mobile) return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent side="bottom" showCloseButton={false} onCloseAutoFocus={close} className="max-h-[92svh] overflow-y-auto rounded-t-xl px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SheetTitle className="sr-only">새 문서</SheetTitle><SheetDescription className="sr-only">{desc}</SheetDescription>{body}
      </SheetContent>
    </Sheet>
  )
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={close} className="top-[12vh] translate-y-0 gap-0 p-5 sm:max-w-xl">
        <DialogTitle className="sr-only">새 문서</DialogTitle><DialogDescription className="sr-only">{desc}</DialogDescription>{body}
      </DialogContent>
    </Dialog>
  )
}

/** 시트 하나와 여는 함수. onOpenDoc 은 만든 문서를 전체화면으로 여는 길(App 의 goDocument) */
export function DocCreateProvider({ children, onOpenDoc }: { children: ReactNode; onOpenDoc: (ref: string) => void }) {
  const [sheet, setSheet] = useState<{ open: boolean; key: number; context: DocCreateContext }>({ open: false, key: 0, context: {} })
  const returnTo = useRef<HTMLElement | null>(null)
  const after = useRef<string | null>(null)
  // 결과를 모르는 만들기가 남은 시트는 닫혀도 지우지 않고, 다시 열면 그 시트를 그대로 보여 줘요(새 id 로 두 번 만들지 않게)
  const pending = useRef(false)
  const onPending = useCallback((p: boolean) => { pending.current = p }, [])
  const [barPending, setBarPending] = useState<BarPending>(null)
  const open = useCallback<Api["open"]>((context = {}, from) => {
    returnTo.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    after.current = null
    setSheet((s) => (pending.current && s.key > 0 ? { ...s, open: true } : { open: true, key: s.key + 1, context }))
  }, [])
  const value = useMemo(() => ({ open, openDoc: onOpenDoc, barPending, setBarPending }), [open, onOpenDoc, barPending])
  // 문서 화면의 n: 더 안쪽 화면(목록·문서 페이지)이 맥락을 담아 다시 붙여요. 여기 것은 맥락 없는 기본
  useShortcut("docs.create", () => open({}, null))
  return (
    <Ctx.Provider value={value}>
      {children}
      {sheet.key > 0 && (
        <DocCreateSheet key={sheet.key} open={sheet.open} context={sheet.context}
          onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))}
          onPending={onPending}
          onDone={(ref) => { pending.current = false; after.current = ref; setSheet((s) => ({ ...s, open: false })) }}
          onDiscard={() => { pending.current = false; setSheet((s) => ({ ...s, open: false })) }}
          onOpenDoc={(ref) => { after.current = ref; setSheet((s) => ({ ...s, open: false })) }}
          onCloseFocus={() => { const ref = after.current; after.current = null; if (ref) onOpenDoc(ref); else if (returnTo.current?.isConnected) returnTo.current.focus() }} />
      )}
    </Ctx.Provider>
  )
}
