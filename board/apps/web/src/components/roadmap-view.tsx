import { useEffect, useMemo, useRef, useState } from "react"
import { Bell, CalendarDays, Flag } from "lucide-react"
import { cn } from "@/lib/utils"
import { compareWorkOrder, dday, isoLocal, W, type Board, type Item, type Signal } from "@/lib/api"
import { useStored, type DataState } from "@/hooks/use-data"
import { DataStateNotice } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { agenda, agendaDayLabel, agendaTime, roadRows, type MarkKind, type RoadMark as Mark, type RoadRow as Row } from "@/lib/road-agenda"

type Timeline = "quarter" | "twoWeeks"
type Range = "list" | Timeline

const DAY = 864e5
const RANGES: Record<Timeline, { days: number; dayW: number }> = {
  quarter: { days: 18 * 7, dayW: 132 / 7 },
  twoWeeks: { days: 14, dayW: 72 },
}
const RANGE_LABEL: Record<Range, string> = { list: "목록", twoWeeks: "2주", quarter: "18주" }
const AGENDA_DAYS = 14
const KIND_LABEL: Record<MarkKind, string> = { goal: "목표", todo: "미리알림", deadline: "마감", event: "일정" }
const NO_AREA = "var(--no-area)"
const today0 = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function KindIcon({ kind, color, className }: { kind: MarkKind; color?: string; className?: string }) {
  if (kind === "goal") return <span className={cn("size-2 shrink-0 rotate-45 rounded-[1px]", className)} style={{ background: color || "currentColor" }} />
  if (kind === "todo") return <Bell className={cn("size-3 shrink-0", className)} />
  if (kind === "deadline") return <Flag className={cn("size-3 shrink-0", className)} />
  return <CalendarDays className={cn("size-3 shrink-0", className)} />
}

/** 좁은 화면의 기본 보기: 오늘부터 14일을 날짜별 세로 목록으로. 지난 일은 맨 위, 그 뒤·날짜 없는 일은 개수만 */
function RoadAgenda({ rows, t0, onOpenWork }: { rows: Row[]; t0: number; onOpenWork: (ref: string) => void }) {
  const a = agenda(rows.flatMap((r) => r.marks), rows.reduce((n, r) => n + r.undated, 0), t0, AGENDA_DAYS)
  const section = (id: string, label: string, marks: Mark[], overdue = false) => (
    <section key={id} aria-labelledby={`ag-${id}`} className="flex flex-col">
      <h2 id={`ag-${id}`} className="sticky top-0 z-10 bg-background pt-4 pb-1.5 text-xs font-medium text-muted-foreground">{label}</h2>
      <ul className="flex flex-col">
        {marks.map((m) => (
          <li key={m.key}>
            <button type="button" onClick={() => onOpenWork(m.ref)} className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-muted">
              <KindIcon kind={m.kind} color={m.color} className={m.late ? "text-destructive" : "text-muted-foreground"} />
              <span className="sr-only">{KIND_LABEL[m.kind]}</span>
              <span className="min-w-0 flex-1 truncate">{m.title}</span>
              <span className="flex shrink-0 items-center" title={m.area}><span aria-hidden className="size-1.5 rounded-full" style={{ background: m.color }} /><span className="sr-only">{m.area}</span></span>
              <span className={cn("num w-12 shrink-0 text-right text-xs text-muted-foreground", m.late && "text-destructive")}>
                {m.kind === "goal" ? dday(isoLocal(m.at).slice(0, 10)).t : overdue ? W.short(isoLocal(m.at)) : agendaTime(m.at)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
  return (
    <div role="region" aria-label="로드맵 목록" className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(6rem+var(--tray-space,0px))]">
      {a.overdue.length > 0 && section("late", `지난 일 ${a.overdue.length}`, a.overdue, true)}
      {a.days.map((d) => section(String(d.day), agendaDayLabel(d.day, t0), d.marks))}
      {!a.overdue.length && !a.days.length && <p className="pt-6 text-sm text-muted-foreground">앞으로 {AGENDA_DAYS}일 안에 날짜 있는 일이 없어요</p>}
      {(a.later > 0 || a.undated > 0) && (
        // 14일 뒤의 일은 시간표 범위(18주)도 넘을 수 있어서, 모든 일을 날짜순으로 보여 주는 전체 목록으로 보내요
        <div className="mt-4 flex flex-col items-start gap-1 border-t pt-3 text-xs text-muted-foreground">
          <p className="pt-1">{[a.later > 0 && `${AGENDA_DAYS}일 뒤 ${a.later}개`, a.undated > 0 && `날짜 없는 일 ${a.undated}개`].filter(Boolean).join(" · ")}</p>
          <a href="#/list" className="flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline">전체 목록에서 보기</a>
        </div>
      )}
    </div>
  )
}

/** 로드맵: 영역 × 시간. 목표·미리알림·마감·일정을 같은 시간축에. 표시를 누르면 그 일 팝업 */
export function RoadmapView({ items, boards, boardId, signals, boardState, signalState, onOpenWork }: {
  items: Item[]; boards: Board[]; boardId: string | undefined; signals: Signal[]; onOpenWork: (ref: string) => void
  boardState: DataState; signalState: DataState
}) {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)")
    const update = () => setNarrow(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  const nameW = narrow ? 112 : 184
  // 넓은 화면은 지금처럼 18주, 좁은 화면은 목록이 기본. 고른 것은 화면 폭마다 따로 기억해요
  const [wideRange, setWideRange] = useStored<Range>("db:roadRange", "quarter")
  const [narrowRange, setNarrowRange] = useStored<Range>("db:roadRangeNarrow", "list")
  const stored = narrow ? narrowRange : wideRange
  const range: Range = stored in RANGE_LABEL ? stored : "quarter"
  const setRange = narrow ? setNarrowRange : setWideRange
  const timeline: Timeline = range === "list" ? "twoWeeks" : range
  const scroller = useRef<HTMLDivElement>(null)
  const board = boards.find((b) => b.id === boardId)
  const gridReady = boardState.hasData
  const sourcesReady = gridReady && (board?.kind !== "personal" || signalState.hasData)
  const { days, dayW } = RANGES[timeline]
  const t0 = today0()
  const start = useMemo(() => {
    if (timeline === "twoWeeks") return t0 - 2 * DAY
    const d = new Date(t0)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7) // 지난주 월요일 (옛 로드맵과 같음)
    return d.getTime()
  }, [timeline, t0])
  const end = start + days * DAY
  const width = Math.round(days * dayW)
  const xOf = (ts: number) => ((ts - start) / DAY) * dayW

  const { rows, counts, total } = useMemo(() => roadRows(items, signals, board, boardId, NO_AREA), [items, signals, board, boardId])

  // 처음 열 때, 범위를 바꿀 때 오늘이 보이게
  const toToday = () => scroller.current?.scrollTo({ left: Math.max(0, xOf(t0) - (timeline === "quarter" ? 132 * 1.5 : dayW * 2)) })
  useEffect(() => {
    toToday()
  }, [range, gridReady, narrow]) // eslint-disable-line react-hooks/exhaustive-deps

  // 머리 칸: 18주는 주, 2주는 날
  const cols = useMemo(() => {
    const out: { left: number; w: number; top: string; sub: string; weekend: boolean; today: boolean }[] = []
    if (timeline === "quarter") {
      let prevM = -1
      for (let w = 0; w < days / 7; w++) {
        const d = new Date(start + w * 7 * DAY)
        const m = d.getMonth()
        out.push({ left: w * 7 * dayW, w: 7 * dayW, top: m !== prevM ? `${m + 1}월` : "", sub: `${m + 1}/${d.getDate()}`, weekend: false, today: false })
        prevM = m
      }
    } else {
      for (let i = 0; i < days; i++) {
        const d = new Date(start + i * DAY)
        out.push({ left: i * dayW, w: dayW, top: d.getDate() === 1 || i === 0 ? `${d.getMonth() + 1}월` : "", sub: `${d.getDate()} ${"일월화수목금토"[d.getDay()]}`, weekend: d.getDay() === 0 || d.getDay() === 6, today: d.getTime() === t0 })
      }
    }
    return out
  }, [timeline, start, days, dayW, t0])

  const lineBg = { backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${(timeline === "quarter" ? 7 : 1) * dayW - 1}px, var(--border) ${(timeline === "quarter" ? 7 : 1) * dayW - 1}px, var(--border) ${(timeline === "quarter" ? 7 : 1) * dayW}px)` }

  return (
    <div className="flex h-[calc(100svh-3rem)] min-w-0 flex-col">
      <div className="shrink-0 px-4 pt-4">
        <PageHeader title="로드맵" echoesHeader className="mb-3" />
        <DataStateNotice label="로드맵" sources={[{ name: "보드", state: boardState }, ...(board?.kind === "personal" ? [{ name: "소식", state: signalState }] : [])]} />
      </div>
      {gridReady && <>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
        {(Object.keys(KIND_LABEL) as MarkKind[]).filter((k) => counts[k] > 0).map((k) => (
          <span key={k} className="flex items-center gap-1.5 whitespace-nowrap" title={KIND_LABEL[k]}><KindIcon kind={k} color="var(--muted-foreground)" /><span className="sr-only">{KIND_LABEL[k]}</span><span className="num">{counts[k]}</span></span>
        ))}
        <span className="flex-1" />
        <div className="flex rounded-md bg-muted p-0.5 max-md:p-0 [@media(pointer:coarse)]:p-0" role="group" aria-label="보기">
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r} className={cn("rounded px-2.5 py-1 font-medium max-md:min-h-11 max-md:min-w-11 [@media(pointer:coarse)]:min-h-11", range === r ? "bg-background text-foreground shadow-xs" : "hover:text-foreground")}>{RANGE_LABEL[r]}</button>
          ))}
        </div>
        {range !== "list" && <button type="button" onClick={toToday} className="rounded-md border px-2.5 py-1 font-medium text-foreground hover:bg-muted max-md:min-h-11 [@media(pointer:coarse)]:min-h-11">오늘</button>}
      </div>

      {range === "list" ? <RoadAgenda rows={rows} t0={t0} onOpenWork={onOpenWork} /> : (
      <div ref={scroller} role="region" aria-label="로드맵 일정표" tabIndex={0} className="relative min-h-0 flex-1 overflow-auto pb-(--tray-space)">
        <div className="relative" style={{ width: nameW + width }}>
          {/* 머리 */}
          <div className="sticky top-0 z-20 flex h-11 border-b bg-background">
            <div className="sticky left-0 z-30 flex shrink-0 items-end border-r bg-background px-4 pb-1.5 text-xs text-muted-foreground" style={{ width: nameW }}>영역</div>
            <div className="relative" style={{ width }}>
              {cols.map((c, i) => (
                <div key={i} className={cn("absolute top-0 bottom-0 flex flex-col justify-end border-l px-1.5 pb-1.5", c.weekend && "bg-muted/50")} style={{ left: c.left, width: c.w }}>
                  <b className="text-2xs font-semibold text-foreground">{c.top}</b>
                  <span className={cn("num text-2xs whitespace-nowrap text-muted-foreground", c.today && "font-semibold text-destructive")}>{c.sub}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 줄 */}
          {rows.map((r) => {
            const marks = [...r.marks].filter((m) => m.at >= start && m.at < end).sort((a, b) => compareWorkOrder(a, b, { doneLast: false }))
            const lanes: number[] = []
            const placed = marks.map((m) => {
              const x = xOf(m.at)
              const w = Math.min(260, 46 + [...m.title].length * 12.5)
              let ln = lanes.findIndex((e) => e < x - 6)
              if (ln < 0) {
                ln = lanes.length
                lanes.push(0)
              }
              lanes[ln] = x + w
              return { m, x, w, ln }
            })
            const h = Math.max(56, 14 + Math.max(1, lanes.length) * 34)
            const n = (k: MarkKind) => r.marks.filter((m) => m.kind === k).length
            const sub = r.event ? `일정 ${r.marks.length}` : [n("goal") && `목표 ${n("goal")}`, n("todo") && `미리알림 ${n("todo")}`, n("deadline") && `마감 ${n("deadline")}`, r.undated && `날짜 없음 ${r.undated}`].filter(Boolean).join(" · ")
            const total = r.marks.length + r.undated
            return (
              <div key={r.id} className={cn("flex border-b", r.event && "bg-muted/30")} style={{ height: h }}>
                <div className="sticky left-0 z-10 flex shrink-0 items-start gap-2 border-r bg-background px-4 pt-3" style={{ width: nameW }}>
                  {r.event ? <CalendarDays className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: r.color }} />}
                  <div className="flex min-w-0 flex-1 items-baseline gap-2" title={sub || undefined}>
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    {total > 0 && <span className="ml-auto shrink-0 num text-2xs text-muted-foreground">{total}</span>}
                    {sub && <span className="sr-only">{sub}</span>}
                  </div>
                </div>
                <div className="relative" style={{ width, ...lineBg }}>
                  {timeline === "twoWeeks" && cols.filter((c) => c.weekend).map((c, i) => <div key={i} className="absolute top-0 bottom-0 bg-muted/40" style={{ left: c.left, width: c.w }} />)}
                  {placed.map(({ m, x, w, ln }) => (
                    <button key={m.key} type="button" onClick={() => onOpenWork(m.ref)}
                      title={`${m.title} · ${W.short(isoLocal(m.at))} · ${KIND_LABEL[m.kind]}`}
                      className={cn("absolute flex h-7 items-center gap-1.5 rounded-md bg-card px-2 text-xs shadow-xs ring-1 ring-foreground/10 hover:z-10 hover:ring-foreground/30",
                        m.done && "opacity-50", m.late && "ring-destructive/40")}
                      style={{ left: Math.max(0, x - 7), top: 10 + ln * 34, maxWidth: w }}>
                      <KindIcon kind={m.kind} color={m.color} className={m.late ? "text-destructive" : "text-muted-foreground"} />
                      <span className={cn("truncate", m.done && "line-through")}>{m.title}</span>
                      <span className={cn("shrink-0 num text-2xs text-muted-foreground", m.late && "text-destructive")}>{m.kind === "goal" ? dday(isoLocal(m.at).slice(0, 10)).t : W.short(isoLocal(m.at))}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}

          {/* 오늘 선 */}
          <div className="pointer-events-none absolute top-0 bottom-0 z-[5] w-px bg-destructive" style={{ left: nameW + xOf(t0 + DAY / 2) }} />

          {total === 0 && sourcesReady && (
            <div className="pointer-events-none absolute inset-x-0 top-28 flex justify-center" style={{ paddingLeft: nameW }}>
              <div className="sticky left-1/2 max-w-sm rounded-xl border bg-background/95 px-5 py-4 text-center shadow-sm">
                <div className="text-sm font-medium">날짜 있는 일이 없어요</div>
                <p className="mt-1 text-xs text-muted-foreground">할 일에 날짜를 넣으면 여기 나타나요</p>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
      </>}
    </div>
  )
}
