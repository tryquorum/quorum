// 이슈 보내기(파일럿): 머리글 단추로 어디서나 열고, "내 이슈"에서 접수·진행·끝을 봐요. 서버: apps/server/server/issues.ts
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ImagePlus, MessageSquareWarning, X } from "lucide-react"
import type { Issue, IssueStatus, IssueUrgency, IssuesResponse } from "@direction-board/contracts"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/page-header"
import { useIsMobile } from "@/hooks/use-mobile"
import { useSpaces } from "@/hooks/use-space"
import { api, ApiError, postForm } from "@/lib/api"
import { cn } from "@/lib/utils"

const URGENCY: [IssueUrgency, string][] = [["low", "낮음"], ["normal", "보통"], ["high", "높음"], ["urgent", "긴급"]]
const STATUS: Record<IssueStatus, string> = { received: "접수", in_progress: "진행", done: "끝" }
const MAX_FILES = 3
const MAX_BYTES = 5 * 1024 * 1024
const chip = (on: boolean) => cn("inline-flex h-8 items-center rounded-md px-3 text-xs font-medium transition-colors", on ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")
const field = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

/** 보내기 창의 본문. 성공하면 onSent */
function IssueForm({ onSent, onCancel }: { onSent: (issue: Issue) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [urgency, setUrgency] = useState<IssueUrgency>("normal")
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const urls = useRef(new Map<File, string>())
  useEffect(() => () => { for (const u of urls.current.values()) URL.revokeObjectURL(u) }, [])
  const preview = (f: File) => { let u = urls.current.get(f); if (!u) { u = URL.createObjectURL(f); urls.current.set(f, u) } return u }
  const add = (list: FileList | null) => {
    const picked = [...(list ?? [])].filter((f) => f.type.startsWith("image/"))
    const tooBig = picked.find((f) => f.size > MAX_BYTES)
    if (tooBig) setError(`${tooBig.name}: 이미지 하나는 5MB 까지예요`)
    setFiles((v) => [...v, ...picked.filter((f) => f.size <= MAX_BYTES)].slice(0, MAX_FILES))
  }
  const ready = title.trim().length >= 2 && !busy
  const submit = async () => {
    if (!ready) return
    setBusy(true); setError(null)
    try {
      const form = new FormData()
      form.set("title", title.trim()); form.set("body", body.trim()); form.set("urgency", urgency)
      for (const f of files) form.append("files", f)
      onSent((await postForm<{ issue: Issue }>("/api/issues", form)).issue)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "보내지 못했어요. 연결을 확인하고 다시 시도해 주세요")
    } finally { setBusy(false) }
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <fieldset disabled={busy} className="contents">
        <label className="flex flex-col gap-1.5 text-sm font-medium">제목
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="무엇이 문제인가요" className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">내용
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={8000} placeholder="어디서, 무엇을 하다가, 어떻게 됐는지 적어 주세요" className="min-h-28 text-sm font-normal" />
        </label>
        <div role="group" aria-label="긴급도" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-sm font-medium">긴급도</span>
          {URGENCY.map(([u, l]) => <button key={u} type="button" aria-pressed={urgency === u} className={cn(chip(urgency === u), urgency === u && u === "urgent" && "bg-destructive text-white")} onClick={() => setUrgency(u)}>{l}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {files.map((f, i) => (
            <span key={i} className="relative">
              <img src={preview(f)} alt={f.name} className="size-16 rounded-md border object-cover" />
              <button type="button" aria-label={`${f.name} 빼기`} className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background" onClick={() => setFiles((v) => v.filter((x) => x !== f))}><X className="size-3" /></button>
            </span>
          ))}
          {files.length < MAX_FILES && (
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}><ImagePlus />이미지 {files.length ? "더 " : ""}붙이기</Button>
          )}
          <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = "" }} />
          <span className="text-xs text-muted-foreground">최대 3장, 한 장 5MB</span>
        </div>
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button type="button" variant="ghost" onClick={onCancel}>취소</Button>
        <Button type="submit" disabled={!ready}>{busy ? "보내는 중…" : "보내기"}</Button>
      </div>
    </form>
  )
}

/** 머리글의 "이슈 보내기". 파일럿 서버(me.issues)에서만 보여요 */
export function IssueButton() {
  const { me } = useSpaces()
  const mobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  if (!me?.issues) return null
  const sent = (issue: Issue) => {
    setOpen(false)
    toast.success(issue.merged ? "같은 이슈에 더해 보냈어요" : "이슈를 보냈어요", { description: issue.title, action: { label: "내 이슈", onClick: () => { location.hash = "/issues" } } })
    window.dispatchEvent(new Event("issues:changed"))
  }
  const form = <IssueForm key={key} onSent={sent} onCancel={() => setOpen(false)} />
  const trigger = <Button variant="outline" size="sm" onClick={() => { setKey((k) => k + 1); setOpen(true) }} aria-label="이슈 보내기"><MessageSquareWarning /><span className="max-sm:sr-only">이슈 보내기</span></Button>
  return (
    <>
      {trigger}
      {mobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[92svh] overflow-y-auto rounded-t-xl px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SheetTitle>이슈 보내기</SheetTitle>
            <SheetDescription>회사 공간에 올라가고 관리자에게 바로 알림이 가요</SheetDescription>
            {form}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogTitle>이슈 보내기</DialogTitle>
            <DialogDescription>회사 공간에 올라가고 관리자에게 바로 알림이 가요</DialogDescription>
            {form}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

const statusTone: Record<IssueStatus, string> = { received: "bg-muted text-foreground", in_progress: "bg-running/15 text-running", done: "bg-done/15 text-done" }

/** 내 이슈(관리자는 전체도) */
export function IssuesView({ onOpenWork }: { onOpenWork: (ref: string) => void }) {
  const { me } = useSpaces()
  const admin = me?.role === "admin"
  // 관리자는 처음에 전체를 봐요(내 정보가 늦게 와도). 고른 뒤에는 고른 것
  const [picked, setScope] = useState<"mine" | "all" | null>(null)
  const scope = picked ?? (admin ? "all" : "mine")
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setIssues((await api<IssuesResponse>(`/api/issues${scope === "all" ? "?scope=all" : ""}`)).issues); setError(null) }
    catch (e) { setError(e instanceof ApiError ? e.message : "불러오지 못했어요") }
  }, [scope])
  useEffect(() => {
    void load()
    const t = window.setInterval(() => { if (!document.hidden) void load() }, 30000)
    const on = () => void load()
    window.addEventListener("issues:changed", on); window.addEventListener("focus", on)
    return () => { window.clearInterval(t); window.removeEventListener("issues:changed", on); window.removeEventListener("focus", on) }
  }, [load])
  const setStatus = async (i: Issue, status: IssueStatus) => {
    try { await api(`/api/issues/${i.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); void load() }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "바꾸지 못했어요") }
  }
  return (
    <div className="mx-auto w-full max-w-[880px] px-6 pt-5 pb-24">
      <PageHeader title={scope === "all" ? "이슈" : "내 이슈"} echoesHeader className="mb-4" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {admin && (["all", "mine"] as const).map((s) => <button key={s} type="button" aria-pressed={scope === s} className={chip(scope === s)} onClick={() => setScope(s)}>{s === "all" ? "전체" : "내가 보낸 것"}</button>)}
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error} <button type="button" className="underline" onClick={() => void load()}>다시 시도</button></p>}
      {issues === null ? <p className="text-sm text-muted-foreground">불러오는 중…</p> : issues.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">아직 보낸 이슈가 없어요. 문제가 생기면 머리글의 "이슈 보내기"로 알려 주세요.</div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {issues.map((i) => (
            <li key={i.id} className="flex flex-col gap-1.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded px-1.5 text-2xs leading-5 font-medium", statusTone[i.status])}>{STATUS[i.status]}</span>
                {(i.urgency === "high" || i.urgency === "urgent") && <span className="rounded bg-destructive/10 px-1.5 text-2xs leading-5 font-medium text-destructive">{i.urgency === "urgent" ? "긴급" : "높음"}</span>}
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" onClick={() => onOpenWork(i.itemRef)}>{i.title}</button>
                <span className="num text-2xs text-muted-foreground">{new Date(i.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              {i.body && <p className="line-clamp-2 text-sm whitespace-pre-wrap text-muted-foreground">{i.body}</p>}
              <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                {scope === "all" && <span>{i.reporter}</span>}
                {i.merged && <span>같은 제목의 열린 이슈에 합쳐졌어요</span>}
                {i.files.map((f) => <a key={f.name} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={`첨부 ${f.name}`} className="size-10 rounded border object-cover" /></a>)}
                {admin && (
                  <select aria-label="상태" value={i.status} onChange={(e) => void setStatus(i, e.target.value as IssueStatus)} className="ml-auto h-7 rounded-md border border-input bg-background px-1.5 text-xs">
                    {(Object.keys(STATUS) as IssueStatus[]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
                  </select>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
