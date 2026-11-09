import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ChevronRight, RotateCcw, Save } from "lucide-react"
import type { OpsSettings } from "@direction-board/contracts/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Segmented } from "@/components/settings/parts"
import { cn } from "@/lib/utils"
import { ago, ApiError } from "@/lib/api"
import { matches } from "@/lib/shortcuts"
import { checkLines, replaceBody, restoreEol, splitPrompt, toLF, type PromptPart } from "@direction-board/contracts/ops-prompt"
import { useStored } from "@/hooks/use-data"
import { putOps } from "@/hooks/use-ops"

/** 저장 안 한 고침: 화면을 옮겨도 이 탭에서는 이어 써요. rev 는 그 고침을 시작할 때의 서버 rev */
const DRAFT_KEY = "db:ops-draft"
type Stored = { text: string; rev: number }
const readDraft = (): Stored | null => {
  try {
    const v = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null")
    return v && typeof v.text === "string" && Number.isInteger(v.rev) ? v : null
  } catch { return null }
}

/** 순회 지시문 편집기: ##·### 영역 카드(접고 펴기) 또는 원문. 원본은 늘 글 하나라 카드에서 고쳐도 다른 부분은 그대로예요 */
export function PromptEditor({ ops, defaultText }: { ops: OpsSettings; defaultText?: string }) {
  const server = toLF(ops.text)
  const [stored] = useState(readDraft)
  const [draft, setDraft] = useState<string | null>(() => (stored && stored.text !== server ? stored.text : null))
  const [restored, setRestored] = useState(draft !== null)
  const [baseRev, setBaseRev] = useState(stored?.rev ?? ops.rev)
  const [conflict, setConflict] = useState<OpsSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useStored<"cards" | "raw">("db:ops-editor", "cards")
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const value = draft ?? server
  const dirty = draft !== null && draft !== server
  const parts = useMemo(() => splitPrompt(value), [value])
  const latest = useRef(value)
  latest.current = value

  useEffect(() => {
    if (dirty) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text: draft, rev: baseRev } satisfies Stored))
    else sessionStorage.removeItem(DRAFT_KEY)
  }, [dirty, draft, baseRev])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener("beforeunload", h)
    return () => removeEventListener("beforeunload", h)
  }, [dirty])

  const change = (next: string) => {
    if (draft === null) setBaseRev(ops.rev)
    setDraft(next)
  }
  const discard = () => { setDraft(null); setRestored(false); setConflict(null) }
  const save = async (rev = draft === null ? ops.rev : baseRev) => {
    if (saving) return
    setSaving(true)
    const sent = value
    try {
      const saved = await putOps({ text: restoreEol(sent, ops.text), base_rev: rev })
      // 저장하는 동안 더 쓴 글은 남기고, 새 rev 위의 고침으로 이어가요
      if (latest.current === sent) discard()
      else { setBaseRev(saved.rev); setConflict(null) }
      toast.success("지시문을 저장했어요. 다음 순회부터 반영돼요")
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const now = (e.body as { ops?: OpsSettings } | null)?.ops ?? null
        setConflict(now)
      } else toast.error("저장하지 못했어요")
    } finally {
      setSaving(false)
    }
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!matches(e, "ops.save")) return
    e.preventDefault()
    if (dirty) void save()
  }
  const key = (p: PromptPart, i: number) => `${p.level}:${p.title ?? ""}:${i}`
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <div onKeyDown={onKeyDown} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="지시문 보기" value={mode} onChange={setMode} options={[{ value: "cards", label: "영역별" }, { value: "raw", label: "원문" }]} />
        <span className="ml-auto text-xs text-muted-foreground" role="status">{dirty ? "저장 안 됨 · ⌘S" : <>저장됨 · {ago(ops.updated_at)}</>}</span>
        {dirty && <Button variant="ghost" size="sm" onClick={discard}><RotateCcw />되돌리기</Button>}
        <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}><Save />저장</Button>
      </div>

      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <span className="flex-1">다른 곳에서 먼저 저장했어요{conflict.updated_at ? ` (${ago(conflict.updated_at)})` : ""}. 내 고침은 아직 이 화면에만 있어요.</span>
          <Button size="sm" variant="outline" onClick={() => void save(conflict.rev)}>내 고침으로 덮기</Button>
          <Button size="sm" variant="ghost" onClick={discard}>서버 것 보기</Button>
        </div>
      )}
      {restored && dirty && !conflict && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="flex-1">저장하지 않은 고침을 이어서 보여줘요</span>
          <Button size="sm" variant="ghost" onClick={discard}>버리기</Button>
        </div>
      )}

      {mode === "raw" ? (
        <Textarea value={value} onChange={(e) => change(e.target.value)} spellCheck={false} aria-label="순회 지시문 원문" className="min-h-[50svh] resize-y text-sm leading-relaxed" />
      ) : (
        <div className="space-y-2">
          {parts.map((p, i) => {
            const k = key(p, i)
            if (p.level === 2 && !p.body.trim()) return <h3 key={k} className="px-1 pt-2 text-xs font-medium text-muted-foreground">{p.title}</h3>
            const isOpen = open.has(k)
            const title = p.level === 0 ? "머리글" : p.title
            const lines = p.level === 3 ? `확인할 곳 ${checkLines(p.body)}줄` : `${p.body.split("\n").filter((l) => l.trim()).length}줄`
            const preview = p.body.split("\n").find((l) => l.trim())?.replace(/^\s*[-*+]\s+/, "") ?? ""
            return (
              <section key={k} className="rounded-xl border bg-card">
                <button type="button" aria-expanded={isOpen} onClick={() => toggle(k)} className="flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
                  <ChevronRight aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium">{title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{lines}</span>
                    </span>
                    {!isOpen && preview && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{preview}</span>}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3">
                    <Textarea value={p.body} spellCheck={false} aria-label={`${title} 지시문`} className="min-h-24 resize-y text-sm leading-relaxed"
                      onChange={(e) => {
                        // 끝에 줄바꿈을 붙여도 커서는 쓰던 자리에
                        const el = e.target
                        const pos = el.selectionStart
                        change(replaceBody(value, i, el.value))
                        requestAnimationFrame(() => { if (document.activeElement === el) el.setSelectionRange(pos, pos) })
                      }} />
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
      {defaultText && (
        <div className="flex justify-end">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => change(toLF(defaultText))}>기본 지시문으로 바꾸기(저장 전까지 되돌릴 수 있어요)</button>
        </div>
      )}
    </div>
  )
}
