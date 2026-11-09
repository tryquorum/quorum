import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Bot, BellRing, Check, CircleAlert, Focus, Lock, Star, X } from "lucide-react"
import { AiMark } from "@/components/ai-mark"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/page-header"
import { QuickAddBar, useQuickAdd } from "@/components/quick-add"
import { cn } from "@/lib/utils"
import { ago, compareWorkOrder, computeGoalProgress, dday, isoLocal, srcName, W, whenOf, type Board, type Item, type Signal } from "@/lib/api"
import type { useSignals } from "@/hooks/use-data"
import { useStored } from "@/hooks/use-data"

type Sig = ReturnType<typeof useSignals>
type Props = { sig: Sig; items: Item[]; boards: Board[]; save: (it: Item) => Promise<boolean> | void; onOpenWork: (ref: string, pane?: string) => void; boardStatus: "loading" | "ok" | "error"; boardHasData: boolean; reloadBoard: () => Promise<void> }

const dayKey = () => new Date().toDateString()
const dueLabel = (ts: number | null) => (ts ? W.short(isoLocal(ts)) : "")

type MainRef = { key: string; title: string; meta: string; when?: string | number | null; z?: number; done: boolean; setDone: (v: boolean) => Promise<unknown> | void }

function LoadingContent({ error }: { error: boolean }) {
  if (error) return <p className="py-3 text-sm text-muted-foreground">데이터를 불러오면 보여요</p>
  return <div aria-busy="true" className="space-y-3 py-3"><span className="sr-only">불러오는 중</span><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
}

/** 홈 머리에 펼쳐 보이는 목표 수(마감 순). 나머지는 "더 보기" */
const GOALS_SHOWN = 3

export function Home({ sig, items, boards, save, onOpenWork, boardStatus, boardHasData, reloadBoard }: Props) {
  const [mainSt, setMainSt] = useStored<{ day: string; keys: string[] }>("db:main", { day: dayKey(), keys: [] })
  const [focus, setFocus] = useStored("db:focus", true)
  const [peek, setPeek] = useState(false)
  const [retryingBoard, setRetryingBoard] = useState(false)
  const [retryingSig, setRetryingSig] = useState(false)
  const setOpenId = (id: string) => {
    const s = sig.signals.find((x) => x.id === id)
    const work = (s?.meta as { work?: string } | null)?.work
    // AI 대화 결과(run:<대화 id>)면 그 대화를 바로 연다. 첫 화면에서 맡긴 거면 오른쪽 아래 결과 창을 연다
    if (s?.ref?.startsWith("run:")) {
      const thread = s.ref.slice(4)
      if (work) return onOpenWork(work, `c:${thread}`)
      window.dispatchEvent(new CustomEvent("dock:open", { detail: { thread } }))
      if (s.lane === "review" && s.status === "open") confirm([s], true)
      return
    }
    onOpenWork(work || `signal:${id}`)
  }
  const mainKeys = mainSt.day === dayKey() ? mainSt.keys : []
  const setMain = (keys: string[]) => setMainSt({ day: dayKey(), keys: [...new Set(keys)] }) // 끝낸 것도 남겨서 오늘 끝낸 개수를 센다. 3개 제한은 안 끝난 것 기준

  const { hidden } = useQuickAdd()
  const [moreDecide, setMoreDecide] = useState(false)
  const [moreAgents, setMoreAgents] = useState(false)
  const [allAuto, setAllAuto] = useState(false)
  const open = (l: string) => sig.signals.filter((s) => s.lane === l && s.status === "open" && !hidden.has(s.id))
  const now = open("now")
  const decide = open("decide")
  const review = open("review")
  const running = useMemo(() => {
    const seen = new Set<string>()
    return sig.signals.filter((s) => s.lane === "running" && s.status === "open").filter((s) => {
      const k = s.task || s.id
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [sig.signals])
  const autoDone = sig.signals.filter((s) => s.lane === "auto" && Date.now() - s.updated_at < 864e5)
  // 끝났지만 내가 아직 확인 안 한 AI 결과: 확인할 때까지 "에이전트가 하는 중"에 남긴다
  const awaiting = [...review].sort((a, b) => b.updated_at - a.updated_at)

  // 메인 일: 고른 것 + 후보
  const resolve = (key: string): MainRef | null => {
    if (key.startsWith("s:")) {
      const s = sig.signals.find((x) => x.id === key.slice(2))
      if (!s) return null
      return { key, title: s.title, meta: [srcName(s.source), s.due ? dueLabel(s.due) : ""].filter(Boolean).join(" · "), when: s.due, z: s.created_at, done: s.status === "resolved", setDone: (v) => sig.patch(s.id, { status: v ? "resolved" : "open" }) }
    }
    const it = items.find((i) => `i:${i.boardId}:${i.id}` === key)
    if (!it) return null
    return {
      key,
      title: (it.text || "(제목 없음)").split("\n")[0],
      meta: it.type === "goal" ? dday(it.due).t : it.remindAt ? W.short(it.remindAt) : "",
      when: it.type === "goal" ? (it.due ?? null) : (it.remindAt ?? it.due ?? null),
      z: typeof it.z === "number" ? it.z : undefined,
      done: !!it.done,
      setDone: (v) => save({ ...it, done: v }),
    }
  }
  // 끝낸 메인 일은 목록에서 빠지고 자리도 비운다 (오늘 끝낸 개수만 남김)
  const allMains = mainKeys.map(resolve).filter(Boolean) as MainRef[]
  const mains = allMains.filter((m) => !m.done).sort((a, b) => compareWorkOrder(a, b))
  const doneToday = allMains.length - mains.length
  const mainLeft = mains.length
  const finish = async (m: MainRef) => {
    const r = await m.setDone(true)
    if (r === false) return
    toast("끝냈어요", { description: m.title, action: { label: "되돌리기", onClick: () => { void m.setDone(false) } } })
  }
  const candidates = useMemo(() => {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    const endMs = end.getTime()
    const in2 = Date.now() + 2 * 864e5
    const fromSig = sig.signals.filter((s) => s.lane === "main" && s.status === "open").map((s) => ({ key: `s:${s.id}`, title: s.title, meta: [srcName(s.source), s.due ? dueLabel(s.due) : ""].filter(Boolean).join(" · "), when: s.due, z: s.created_at }))
    const fromBoard = items
      .filter((i) => {
        if (i.done) return false
        const at = whenOf(i)
        return (i.type === "todo" && at !== null && at <= endMs) || (i.type === "goal" && at !== null && at <= in2)
      })
      .map((i) => ({ key: `i:${i.boardId}:${i.id}`, title: (i.text || "(제목 없음)").split("\n")[0], meta: i.type === "goal" ? dday(i.due).t : W.short(String(i.remindAt)), when: i.type === "goal" ? (i.due ?? null) : (i.remindAt ?? null), z: typeof i.z === "number" ? i.z : undefined }))
    return [...fromSig, ...fromBoard].filter((c) => !mainKeys.includes(c.key)).sort((a, b) => compareWorkOrder(a, b))
  }, [sig.signals, items, mainKeys])

  const goals = items.filter((i) => i.type === "goal" && !i.done).sort((a, b) => compareWorkOrder(a, b))
  const [showAllGoals, setShowAllGoals] = useState(false)
  const areaOf = (it: Item) => boards.find((b) => b.id === it.boardId)?.areas.find((a) => a.id === it.area)
  const gate = focus && mainLeft > 0 && !peek
  const hasSample = sig.signals.some((s) => s.sample) || sig.collectors.some((c) => c.sample)
  const d = new Date()
  const bothReady = boardHasData && sig.hasData
  const missingError = (!boardHasData && boardStatus === "error") || (!sig.hasData && sig.status === "error")

  const resolveSig = (s: Signal, label = "처리했어요") => {
    sig.patch(s.id, { status: "resolved" })
    toast(label, { action: { label: "되돌리기", onClick: () => sig.patch(s.id, { status: "open" }) } })
  }
  const aiDone = (s: Signal) => {
    sig.patch(s.id, { status: "resolved", lane: "auto", reason: "AI가 처리함" })
    toast("AI가 처리한 걸로 닫았어요", { action: { label: "되돌리기", onClick: () => sig.patch(s.id, { status: "open", lane: s.lane, reason: s.reason }) } })
  }
  // 확인함: "AI가 알아서 처리한 것"으로 옮긴다
  const confirm = (list: Signal[], quiet = false) => {
    for (const s of list) sig.patch(s.id, { status: "resolved", lane: "auto", reason: "확인함" })
    if (quiet) return
    toast(list.length > 1 ? `${list.length}개를 확인했어요` : "확인했어요", {
      description: "AI가 처리한 것으로 옮겼어요",
      action: { label: "되돌리기", onClick: () => list.forEach((s) => sig.patch(s.id, { status: "open", lane: "review", reason: s.reason })) },
    })
  }
  const mute = (s: Signal) => {
    sig.patch(s.id, { feedback: "mute" })
    toast("규칙을 만들었어요", { description: `${srcName(s.source)}의 이런 소식은 앞으로 안 보내요` })
  }
  const urgent_ = (s: Signal) => {
    sig.patch(s.id, { feedback: "urgent" })
    toast("규칙을 만들었어요", { description: `${srcName(s.source)}의 이런 소식은 바로 알려줘요` })
  }

  const urgent = sig.hasData && now.length + decide.length > 0
  const openRef = (key: string) => onOpenWork(key.startsWith("s:") ? `signal:${key.slice(2)}` : `item:${key.slice(2)}`)
  const retryBar = (label: string, stale: boolean, busy: boolean, retry: () => void) => (
    <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><span>{label}{stale && " · 마지막으로 불러온 내용이에요"}</span><Button className="ml-auto" variant="outline" size="sm" disabled={busy} onClick={retry}>{busy ? "다시 불러오는 중…" : "다시 시도"}</Button></div>
  )

  // 결정: 사람만 할 수 있는 것. 있으면 맨 앞. 3행까지 보이고 나머지는 펼쳐요
  const limit = moreDecide ? Infinity : 3
  const nowShown = now.slice(0, limit)
  const decideShown = decide.slice(0, Math.max(0, limit - nowShown.length))
  const decideRest = now.length + (gate ? 0 : decide.length) - nowShown.length - (gate ? 0 : decideShown.length)
  const agentLimit = moreAgents ? Infinity : 8
  const awaitingShown = awaiting.slice(0, agentLimit)
  const runningShown = running.slice(0, Math.max(0, agentLimit - awaitingShown.length))
  const agentRest = awaiting.length + running.length - awaitingShown.length - runningShown.length
  const decideCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">결정 {now.length + decide.length > 0 && <span className="num text-sm font-normal text-destructive">{now.length + decide.length}</span>}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!sig.hasData ? <LoadingContent error={sig.status === "error"} /> : <>
        {nowShown.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 pb-1 text-xs font-medium text-destructive"><CircleAlert className="size-3.5" /> 지금</div>
            {nowShown.map((s) => (
              <SignalRow key={s.id} s={s} onOpen={setOpenId} detail actions={<><Button size="sm" onClick={() => resolveSig(s)}>처리함</Button><Button size="sm" variant="outline" onClick={() => aiDone(s)}>AI가 처리함</Button><Button size="sm" variant="ghost" onClick={() => mute(s)}>안 와도 돼</Button></>} alwaysShow />
            ))}
          </div>
        )}
        {gate && decide.length > 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-3">
            <span className="text-sm">결정 <b className="num">{decide.length}</b> · 메인 일 끝나면 펼쳐요</span>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setPeek(true)}>보기</Button>
          </div>
        ) : decideShown.length > 0 && (
          <div>
            {decideShown.map((s) => (
              <SignalRow key={s.id} s={s} onOpen={setOpenId} detail actions={<><Button size="sm" variant="outline" onClick={() => resolveSig(s)}>처리함</Button><Button size="sm" variant="ghost" onClick={() => aiDone(s)}>AI가 처리함</Button><Button size="sm" variant="ghost" onClick={() => mute(s)}>안 와도 돼</Button></>} />
            ))}
          </div>
        )}
        {(decideRest > 0 || moreDecide) && <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setMoreDecide((v) => !v)}>{moreDecide ? "접기" : `결정 ${decideRest}개 더`}</Button>}
        {now.length + decide.length === 0 && <p className="py-1 text-sm text-muted-foreground">기다리는 결정 없음</p>}
        </>}
      </CardContent>
    </Card>
  )

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pt-5 pb-32 sm:px-6">
      <PageHeader title={`${d.getMonth() + 1}월 ${d.getDate()}일 ${"일월화수목금토"[d.getDay()]}요일`} className="mb-4"
        meta={hasSample ? "샘플 데이터" : undefined}
        actions={hasSample && <Button variant="ghost" size="sm" onClick={() => sig.clearSamples().then(() => toast("샘플을 지웠어요"))}>샘플 지우기</Button>} />

      <QuickAddBar className="mb-5" />

      {(boardStatus === "error" || retryingBoard) && retryBar("보드를 불러오지 못했어요", boardHasData, retryingBoard, async () => { setRetryingBoard(true); try { await reloadBoard() } finally { setRetryingBoard(false) } })}
      {(sig.status === "error" || retryingSig) && retryBar("소식을 불러오지 못했어요", sig.hasData, retryingSig, async () => { setRetryingSig(true); try { await sig.load() } finally { setRetryingSig(false) } })}

      {!boardHasData && boardStatus === "loading" && <div aria-busy="true" className="mb-4 flex gap-2 overflow-x-auto pb-1"><span className="sr-only">불러오는 중</span>{[0, 1, 2].map((n) => <div key={n} className="flex w-[200px] shrink-0 flex-col gap-2 rounded-xl bg-card px-3.5 py-2.5 ring-1 ring-foreground/10"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/3" /></div>)}</div>}

      {boardHasData && goals.length > 0 && (
        <section aria-label="목표" className="mb-4">
          {/* 목표가 여럿이면 가로로 밀어 숨기지 않고 마감 순으로 3개까지 펼쳐 보이고, 나머지는 "더 보기"로. 칸에 고리(ring)가 잘리지 않게 스크롤 상자를 쓰지 않아요 */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(showAllGoals ? goals : goals.slice(0, GOALS_SHOWN)).map((g) => {
              const a = areaOf(g)
              const dd = dday(g.due)
              const p = computeGoalProgress(g, items)
              const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
              return (
                <button key={g.id} type="button" onClick={() => onOpenWork(`item:${g.boardId}:${g.id}`)} className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-card px-3.5 py-2.5 text-left ring-1 ring-foreground/10 hover:ring-foreground/25">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: a?.color || "var(--muted-foreground)" }} />
                    <span className="sr-only">{a?.name || "영역 없음"}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={(g.text || "목표").split("\n")[0]}>{(g.text || "목표").split("\n")[0]}</span>
                    <span className={cn("shrink-0 num text-xs text-muted-foreground", dd.late && "text-destructive")}>{g.due ? dd.t : "—"}</span>
                  </span>
                  <span className="flex items-center gap-2" aria-label={p.total ? `할 일 ${p.total}개 중 ${p.done}개 끝냄` : "붙인 할 일 없음"}>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground/60" style={{ width: `${pct}%` }} /></span>
                    <span className="num shrink-0 text-xs text-muted-foreground">{p.total ? `${p.done}/${p.total}` : "—"}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {goals.length > GOALS_SHOWN && (
            <button type="button" onClick={() => setShowAllGoals((v) => !v)} aria-expanded={showAllGoals} className="mt-1.5 text-xs text-muted-foreground hover:text-foreground">
              {showAllGoals ? "접기" : `목표 ${goals.length - GOALS_SHOWN}개 더 보기`}
            </button>
          )}
        </section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          {urgent && decideCard}
          {/* 오늘 메인 일: 결정이 없으면 이 칸이 먼저, 첫 일은 크게 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">오늘 메인 {mainLeft > 0 && <span className="num text-sm font-normal text-muted-foreground">{mainLeft}/3</span>}</CardTitle>
              <CardAction>
                <label className="flex items-center gap-1.5 text-muted-foreground" title="집중 모드: 메인 일을 끝낼 때까지 결정을 접어 둬요">
                  <Focus className="size-3.5" aria-hidden />
                  <span className="text-xs">집중</span>
                  <Switch aria-label="집중 모드" checked={focus} onCheckedChange={(v) => { setFocus(v); setPeek(false) }} />
                </label>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col">
              {!bothReady ? <LoadingContent error={missingError} /> : <>
              {mains.length === 0 && <p className="py-2 text-sm text-muted-foreground">{doneToday ? <>오늘 <span className="num">{doneToday}</span>개 끝냄</> : "끝낼 일을 3개까지 골라요"}</p>}
              {mains.map((m, i) => (
                <div key={m.key} className={cn("group/mn flex items-center gap-3 border-b last:border-b-0", i === 0 ? "py-3" : "py-2")}>
                  <Checkbox className="size-5 rounded-full" checked={false} onCheckedChange={() => finish(m)} aria-label={`${m.title} 끝냄`} />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => openRef(m.key)} className={cn("block max-w-full truncate text-left hover:underline", i === 0 ? "text-base font-semibold" : "text-sm font-medium")}>{m.title}</button>
                    {m.meta && <div className="num text-xs text-muted-foreground">{m.meta}</div>}
                  </div>
                  <Button variant="ghost" size="icon-xs" className="text-muted-foreground opacity-0 group-hover/mn:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" aria-label="메인에서 빼기" title="메인에서 빼기" onClick={() => setMain(mainKeys.filter((k) => k !== m.key))}><X /></Button>
                </div>
              ))}
              {mains.length > 0 && doneToday > 0 && <p className="pt-2 text-xs text-muted-foreground">오늘 <span className="num">{doneToday}</span>개 끝냄</p>}
              {mains.length < 3 && candidates.length > 0 && (
                <div className="mt-3 rounded-lg bg-muted/50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">후보 <span className="num">{candidates.length}</span></div>
                  {candidates.slice(0, 5).map((c) => (
                    <div key={c.key} className="flex items-center gap-2 py-1 max-md:min-h-11 max-md:py-0 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:py-0">
                      <button type="button" onClick={() => openRef(c.key)} className="min-w-0 flex-1 self-stretch truncate text-left text-sm hover:underline">{c.title}</button>
                      <span className="shrink-0 num text-xs text-muted-foreground">{c.meta}</span>
                      <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-warn" aria-label={`${c.title} 오늘 메인으로`} title="오늘 메인으로" onClick={() => setMain([...mainKeys, c.key])}><Star /></Button>
                    </div>
                  ))}
                </div>
              )}
              </>}
            </CardContent>
          </Card>
          {!urgent && decideCard}

          {/* 에이전트: 하는 중 + 끝나고 내 확인을 기다리는 것 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bot className="size-4 text-muted-foreground" aria-hidden />에이전트 {running.length + awaiting.length > 0 && <span className="num text-sm font-normal text-muted-foreground">{running.length + awaiting.length}</span>}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!sig.hasData ? <LoadingContent error={sig.status === "error"} /> : <>
              {awaiting.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 pb-1 text-xs font-medium text-warn-foreground">
                    확인 <span className="num">{awaiting.length}</span>
                    <span className="flex-1" />
                    {awaiting.length >= 3 && <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => confirm(awaiting)}>모두 확인함</Button>}
                  </div>
                  {awaitingShown.map((s) => <ReviewRow key={s.id} s={s} onOpen={setOpenId} onConfirm={() => confirm([s])} />)}
                </div>
              )}
              {runningShown.length > 0 && <div>{runningShown.map((s) => <SignalRow key={s.id} s={s} onOpen={setOpenId} live />)}</div>}
              {agentRest > 0 && <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setMoreAgents(true)}>{`${agentRest}개 더 보기`}</Button>}
              {running.length + awaiting.length === 0 && <p className="py-2 text-sm text-muted-foreground">하는 일 없음</p>}
              </>}
            </CardContent>
          </Card>
        </div>

        {/* 지나간 처리와 상태: 카드 없이 옅은 절 */}
        <aside className="flex min-w-0 flex-col gap-5 lg:col-span-4" aria-label="지나간 처리와 상태">
          <Side title="AI가 처리함" icon={<AiMark className="text-ai" />} count={autoDone.length}>
            {!sig.hasData ? <LoadingContent error={sig.status === "error"} /> : <>
            {(allAuto ? autoDone : autoDone.slice(0, 5)).map((s) => (
              <SignalRow key={s.id} s={s} onOpen={setOpenId} done actions={<Button size="icon-xs" variant="ghost" aria-label="이런 소식은 바로 알려줘" title="이런 소식은 바로 알려줘" onClick={() => urgent_(s)}><BellRing /></Button>} />
            ))}
            {autoDone.length > 5 && <Button variant="ghost" size="sm" className="mt-1 text-muted-foreground" onClick={() => setAllAuto((v) => !v)}>{allAuto ? "접기" : `모두 보기 ${autoDone.length}`}</Button>}
            {autoDone.length === 0 && <p className="py-1 text-sm text-muted-foreground">24시간 동안 없음</p>}
            </>}
          </Side>
          <Side title="마감">
            {!bothReady ? <LoadingContent error={missingError} /> : <Upcoming sig={sig} items={items} />}
          </Side>
          <Side title="수집기">
            {!sig.hasData ? <LoadingContent error={sig.status === "error"} /> : <>
            {sig.collectors.length === 0 && <p className="text-sm text-muted-foreground">연결된 수집기 없음</p>}
            {sig.collectors.map((c) => {
              const stale = !!c.every_min && Date.now() - c.last_seen > c.every_min * 3 * 6e4
              const bad = !c.ok || stale
              return (
                <div key={c.name} className="flex items-center gap-2 py-1.5 text-sm" title={c.note || undefined}>
                  <span className={cn("size-1.5 shrink-0 rounded-full", bad ? "bg-destructive" : "bg-done")} aria-hidden />
                  <span className="w-20 shrink-0 truncate font-medium">{srcName(c.name)}</span>
                  <span className={cn("min-w-0 flex-1 truncate text-xs", bad ? "text-destructive" : "sr-only")}>{bad ? (stale && c.ok ? "소식 없음" : c.note || "문제 있음") : "정상"}</span>
                  <span className="ml-auto shrink-0 num text-xs text-muted-foreground">{ago(c.last_seen)}</span>
                </div>
              )
            })}
            </>}
          </Side>
          <Side title="끼어들기">
            {!sig.hasData ? <LoadingContent error={sig.status === "error"} /> : <>
            <div className="flex items-baseline gap-1" aria-label={`오늘 끼어든 횟수 ${sig.stats.interrupts_today}번, 목표 3번 이하`}>
              <span className={cn("text-2xl font-semibold tracking-tight num", sig.stats.interrupts_today > 3 && "text-destructive")}>{sig.stats.interrupts_today}</span>
              <span className="num text-sm text-muted-foreground">/3</span>
            </div>
            {sig.rules.length > 0 && <>
              <Separator className="my-3" />
              <div className="text-xs text-muted-foreground">규칙 <span className="num">{sig.rules.length}</span></div>
              {sig.rules.map((r) => (
                <div key={r.id} className="flex items-center gap-2 py-1 text-xs">
                  <span className="flex-1 truncate">{r.note}</span>
                  <Button variant="ghost" size="icon-xs" onClick={() => sig.deleteRule(r.id)} aria-label="규칙 지우기"><X /></Button>
                </div>
              ))}
            </>}
            </>}
          </Side>
        </aside>
      </div>

    </div>
  )
}

/** 사건 한 줄. detail(결정 칸)만 이유와 본문 한 줄을 보이고, 나머지는 제목과 시각만 */
function SignalRow({ s, actions, onOpen, alwaysShow, live, done, detail }: { s: Signal; actions?: React.ReactNode; onOpen: (id: string) => void; alwaysShow?: boolean; live?: boolean; done?: boolean; detail?: boolean }) {
  return (
    <div className="group/sg flex flex-wrap items-start gap-x-3 gap-y-2 border-b px-1 py-2.5 last:border-b-0">
      <span className="w-12 shrink-0 truncate pt-0.5 text-2xs font-medium text-muted-foreground">{srcName(s.source)}</span>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onOpen(s.id)} title={detail ? s.title : undefined} className={cn("text-left text-sm leading-snug font-medium hover:underline", detail && "line-clamp-2")}>{s.title.replace(/^답이 왔어요:\s*/, "")}</button>
        {detail && s.body && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{s.body}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {live && <span className="relative flex size-1.5" aria-label="하는 중"><span className="absolute inline-flex size-full animate-ping rounded-full bg-running opacity-75" /><span className="relative inline-flex size-1.5 rounded-full bg-running" /></span>}
          {done && <Check className="size-3 text-done-foreground" aria-label="끝남" />}
          {detail && s.reason && <span>{s.reason} ·</span>}
          <span className="num">{ago(s.updated_at)}</span>
          {s.ref?.startsWith("ops:") && <span title="운영 순회가 올린 사건이에요" className="rounded border px-1 text-2xs leading-4">순회</span>}
          {s.private && <Lock className="size-3" role="img" aria-label="개인" />}
          {s.needs_ai && <AiMark className="size-3 text-ai" role="img" aria-hidden={false} aria-label="AI 판단 대기" />}
        </div>
      </div>
      {actions && <div className={cn("flex shrink-0 items-center gap-1 transition-opacity max-md:basis-full max-md:pl-15 max-md:[&_button]:h-11 [@media(pointer:coarse)]:[&_button]:h-11", !alwaysShow && "opacity-0 group-hover/sg:opacity-100 focus-within:opacity-100 max-md:opacity-100 [@media(hover:none)]:opacity-100")}>{actions}</div>}
    </div>
  )
}

/** 오른쪽 열의 옅은 절: 카드 없이 제목과 목록 */
function Side({ title, icon, count, children }: { title: string; icon?: React.ReactNode; count?: number; children: React.ReactNode }) {
  return (
    <section className="border-t pt-4 first:border-t-0 first:pt-0">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">{icon}{title}{count ? <span className="num">{count}</span> : null}</h2>
      {children}
    </section>
  )
}

/** 끝났지만 아직 확인 안 한 AI 결과 한 줄 */
function ReviewRow({ s, onOpen, onConfirm }: { s: Signal; onOpen: (id: string) => void; onConfirm: () => void }) {
  const title = s.title.replace(/^답이 왔어요:\s*/, "")
  return (
    <div className="flex items-center gap-3 border-b px-1 py-2 last:border-b-0">
      <span className="size-2 shrink-0 rounded-full bg-warn" aria-label="확인 안 함" />
      <button type="button" onClick={() => onOpen(s.id)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline">{title}</button>
      <span className="shrink-0 num text-xs text-muted-foreground">{ago(s.updated_at)}</span>
      <Button size="sm" variant="outline" onClick={onConfirm}><Check />확인함</Button>
    </div>
  )
}

function Upcoming({ sig, items }: { sig: Sig; items: Item[] }) {
  const list = [
    ...sig.signals.filter((s) => s.kind === "deadline" && s.status === "open" && s.lane === "info" && s.due).map((s) => ({ t: s.title, d: s.due!, when: s.due, z: s.created_at, src: srcName(s.source) })),
    ...items.filter((i) => i.type === "goal" && !i.done && i.due).map((i) => ({ t: (i.text || "목표").split("\n")[0], d: whenOf(i) ?? new Date(i.due + "T23:59:59").getTime(), when: i.due, z: typeof i.z === "number" ? i.z : undefined, src: "목표" })),
  ]
    .filter((x) => x.d > Date.now() - 864e5)
    .sort((a, b) => compareWorkOrder(a, b, { doneLast: false }))
    .slice(0, 6)
  if (!list.length) return <p className="text-sm text-muted-foreground">다가오는 마감 없음</p>
  return (
    <>
      {list.map((x, i) => (
        <div key={i} className="flex items-baseline gap-3 py-1.5 text-sm">
          <span className="w-16 shrink-0 num text-xs text-muted-foreground">{dueLabel(x.d)}</span>
          <span className="min-w-0 flex-1 truncate">{x.t}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{x.src}</span>
        </div>
      ))}
    </>
  )
}
