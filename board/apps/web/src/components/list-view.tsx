import { useMemo, useState } from "react"
import { ChevronRight, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Board, Item, Signal } from "@/lib/api"
import { useStored, type DataState } from "@/hooks/use-data"
import { DataStateNotice } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { compareTasks, toTasks, toggleMain, useMainKeys, useSetDone, type Task } from "@/lib/tasks"
import { TaskRow } from "@/components/task-row"
import { QuickAddBar } from "@/components/quick-add"
import { useSpaces } from "@/hooks/use-space"

type Kind = "all" | "main" | "todo" | "signal" | "goal"
const KINDS: [Kind, string][] = [["all", "전체"], ["main", "메인"], ["todo", "미리알림"], ["signal", "사건"], ["goal", "목표"]]
const GROUPS = ["지남", "오늘", "이번 주", "나중", "날짜 없음"] as const

/** 전체 목록: 미리알림·목표·사건·메인 일을 한 층에서. 시간으로 묶고, 종류·영역·검색으로 거른다 */
export function ListView({ items, boards, boardId, signals, boardState, signalState, save, patchSignal, onOpenWork }: {
  items: Item[]; boards: Board[]; boardId: string | undefined; signals: Signal[]
  boardState: DataState; signalState: DataState
  save: (it: Item) => void; patchSignal: (id: string, body: Record<string, unknown>) => Promise<void>; onOpenWork: (ref: string) => void
}) {
  const [mainKeys, setMainKeys] = useMainKeys()
  const { view: space } = useSpaces()
  const setDone = useSetDone(save, patchSignal)
  const [kind, setKind] = useStored<Kind>("db:listKind", "all")
  const [area, setArea] = useStored<string>("db:listArea", "all")
  const [q, setQ] = useState("")
  const [showDone, setShowDone] = useState(false)
  const board = boards.find((b) => b.id === boardId)

  const all = useMemo(() => toTasks({ items, signals, boards, boardId, mainKeys, withDone: true, space }), [items, signals, boards, boardId, mainKeys, space])
  const openKeys = useMemo(() => new Set(all.filter((t) => !t.done).map((t) => t.key)), [all])
  const star = (t: Task) => toggleMain(t, mainKeys, setMainKeys, openKeys)
  const count = (k: Kind) => all.filter((t) => !t.done && (k === "all" || (k === "main" ? t.main : t.kind === k))).length
  const sourcesReady = (k: Kind) => k === "signal" ? signalState.hasData : k === "todo" || k === "goal" ? boardState.hasData : boardState.hasData && signalState.hasData

  const shown = all.filter((t) => {
    if (kind === "main" ? !t.main : kind !== "all" && t.kind !== kind) return false
    if (area === "none" ? !!t.area : area !== "all" && t.area?.name !== area) return false
    return !q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase())
  })
  const groups = useMemo(() => {
    const t0 = new Date()
    t0.setHours(0, 0, 0, 0)
    const start = t0.getTime()
    const end = start + 864e5 - 1
    const week = end + 7 * 864e5
    const g: Record<(typeof GROUPS)[number], Task[]> = { 지남: [], 오늘: [], "이번 주": [], 나중: [], "날짜 없음": [] }
    for (const t of shown) {
      if (t.done) continue
      const k = t.at === null ? "날짜 없음" : t.at < start ? "지남" : t.at <= end ? "오늘" : t.at <= week ? "이번 주" : "나중"
      g[k].push(t)
    }
    for (const k of GROUPS) g[k].sort(compareTasks)
    return g
  }, [shown])
  const done = shown.filter((t) => t.done).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
  const openShown = shown.length - shown.filter((t) => t.done).length

  const chip = (on: boolean) => cn("inline-flex items-center justify-center rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition-colors max-md:min-h-11 max-md:px-3.5 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3.5", on ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 pt-5 pb-24">
      <PageHeader title="전체 목록" echoesHeader className="mb-4" />
      <DataStateNotice label="목록" sources={[{ name: "보드", state: boardState }, { name: "소식", state: signalState }]} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {boardState.hasData && boardId && <QuickAddBar className="min-w-0 w-full sm:flex-1" />}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-1.5 max-md:gap-2 [@media(pointer:coarse)]:gap-2">
        <div className="contents" role="group" aria-label="종류">
        {KINDS.map(([k, l]) => (
          <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)} aria-pressed={kind === k}>
            {l} {(count(k) > 0 || sourcesReady(k)) && <span className="ml-0.5 num">{count(k)}</span>}
          </button>
        ))}
        </div>
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="영역" className={cn(chip(area !== "all"), "h-[26px] max-md:h-11 [@media(pointer:coarse)]:h-11 cursor-pointer border-0 pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
          {[["all", "모든 영역"], ...(board?.areas || []).map((a) => [a.name, a.name]), ["none", "영역 없음"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="ml-auto flex h-[26px] max-md:h-11 [@media(pointer:coarse)]:h-11 w-full items-center gap-1.5 rounded-full bg-muted px-2.5 max-md:px-3.5 text-xs focus-within:ring-2 focus-within:ring-ring sm:w-44">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="찾기" aria-label="제목으로 찾기" className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
        </label>
      </div>

      {boardState.hasData && <>
      {openShown === 0 && sourcesReady(kind) && (
        <div className="flex items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
          {q || kind !== "all" || area !== "all" ? <>맞는 일이 없어요 <button type="button" className="font-medium text-foreground hover:underline" onClick={() => { setQ(""); setKind("all"); setArea("all") }}>필터 풀기</button></> : "할 일이 없어요"}
        </div>
      )}
      {GROUPS.map((k) => groups[k].length > 0 && (
        <section key={k} className="mb-5">
          <h2 className={cn("mb-1 flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground", k === "지남" && "text-destructive")}>
            {k} <span className="num">{groups[k].length}</span>
          </h2>
          <ul className="flex flex-col divide-y divide-border/60">
            {groups[k].map((t) => <TaskRow key={t.key} t={t} onOpen={onOpenWork} onDone={setDone} onStar={star} />)}
          </ul>
        </section>
      ))}
      {done.length > 0 && (
        <section className="mt-2">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="mb-1 flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={showDone}>
            <ChevronRight className={cn("size-3.5 transition-transform", showDone && "rotate-90")} />끝낸 것 <span className="num">{done.length}</span>
          </button>
          {showDone && <ul className="flex flex-col divide-y divide-border/60">{done.map((t) => <TaskRow key={t.key} t={t} onOpen={onOpenWork} onDone={setDone} onStar={star} />)}</ul>}
        </section>
      )}
      </>}
    </div>
  )
}
