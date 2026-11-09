// 빠른 기록 한 줄. 출처: board/apps/web/src/components/quick-add.tsx 의 규칙 —
// Enter 는 사람이 쓴 그대로 바로 저장(AI가 다듬지 않아요), 날짜 말("내일 3시")은 미리 보여 주고 마감으로, 같은 제출은 clientKey 로 한 번만,
// 이미 열린 같은 일이 있으면 새로 만들지 않고 알려 줘요. 저장에 실패하면 쓴 글을 지우지 않아요.
import { forwardRef, useState } from "react"
import { CalendarClock, CornerDownLeft, Feather } from "lucide-react"
import { cn } from "@/lib/utils"
import { newKey, ws, type Item } from "./api"
import { ALERT } from "./tone"
import { W } from "./when"

type Status = { tone: "ok" | "warn" | "error"; text: string } | null

export const CaptureBar = forwardRef<HTMLInputElement, { onSaved: (item: Item) => void }>(function CaptureBar({ onSaved }, ref) {
  const [text, setText] = useState("")
  const [key, setKey] = useState(newKey)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const when = text.trim() ? W.parse(text) : null

  const save = async () => {
    const t = text.trim()
    if (!t || saving) return
    setSaving(true)
    try {
      const r = await ws.capture(t, key)
      setText("")
      setKey(newKey())
      setStatus(r.existed === "open" ? { tone: "warn", text: "Already on your list: " + r.item.text } : { tone: "ok", text: r.item.due ? "Saved · due " + W.long(r.item.due) : "Saved to Inbox" })
      onSaved(r.item)
    } catch (e) {
      setStatus({ tone: "error", text: "Not saved: " + (e instanceof Error ? e.message : String(e)) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save() }} className="rounded-2xl border bg-card/70 shadow-sm backdrop-blur-xl focus-within:border-foreground/30">
      <div className="flex items-center gap-2 px-3 py-2">
        <Feather className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={ref}
          value={text}
          onChange={(e) => { setText(e.target.value); if (status?.tone !== "error") setStatus(null) }}
          onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLInputElement).blur() }}
          placeholder="Write it down — 내일 3시 계약서 검토"
          aria-label="Quick capture"
          enterKeyHint="done"
          autoComplete="off"
          className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 sm:text-sm"
        />
        {when && (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-2xs text-muted-foreground sm:inline-flex" title="Read as due date">
            <CalendarClock className="size-3" />{W.long(when.at)}
          </span>
        )}
        <button type="submit" disabled={!text.trim() || saving} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-40">
          Save <CornerDownLeft className="size-3" />
        </button>
      </div>
      {(status || when) && (
        <p role="status" className={cn("border-t px-3 py-1.5 text-2xs", status?.tone === "error" ? "rounded-b-2xl border-transparent " + ALERT : status?.tone === "warn" ? "text-foreground" : "text-muted-foreground")}>
          {status ? status.text : when ? <span className="sm:hidden">Due {W.long(when.at)} · </span> : null}
          {!status && when && <>Saves “{when.title || text.trim()}” as you wrote it</>}
        </p>
      )}
    </form>
  )
})
