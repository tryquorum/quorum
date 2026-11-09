import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Brain, CircleAlert, Gavel, History, MonitorPlay, Play, RotateCcw, Square, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Brand } from "@/components/wordmark"
import { Hemicycle } from "@/components/hemicycle"
import { asset, STATIC } from "@/lib/base"
import { cn } from "@/lib/utils"
import type { Health, QuorumEvent, RunSummary } from "@/lib/contract"
import { applyEvent, emptyRun, FIXTURES, followRun, playFixture, runRecipe, startLive, type RunView, type StopFn } from "./stream"
import { EventLog, OutcomePanel, Panel, ProposalCard, RecallPanel, RecipePanel } from "./panels"
import { RunList } from "./run-list"
import { RecipesPanel } from "./recipes"
import { EN, SEOUL_RUN_ID } from "@/lib/seoul"

const EXAMPLES = [
  "오늘 c0mpiled-17 Seoul 행사 Luma 공지에서 내가 지금 해야 할 일만 정리해 줘",
  "Sort out what I need to do from today's event announcements",
  "Check whether the Luma recipe still works and fix it if not",
  "Draft a 2-minute demo script from our README",
]
const STATIC_NOTE = "Static demo — the live council runs locally (bun run dev)"

// Where the events on screen come from. Anything not "live" is labeled on screen.
type Source = "live" | "fixture" | "history" | "recipe"

function useHealth() {
  const [health, setHealth] = useState<Health | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    if (STATIC) return
    let alive = true
    const load = () =>
      fetch(asset("api/health"))
        .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as Health })
        .then((h) => { if (alive) { setHealth(h); setProblem(null) } })
        .catch((e: unknown) => { if (alive) { setHealth(null); setProblem(e instanceof Error ? e.message : String(e)) } })
    void load()
    const id = window.setInterval(load, 15000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])
  return { health, problem }
}

function HealthChips() {
  const { health, problem } = useHealth()
  if (STATIC) return <span className="inline-flex items-center gap-1.5 rounded-full border border-escalate/40 px-2.5 py-0.5 text-2xs text-escalate"><MonitorPlay className="size-3" />static demo · no server</span>
  const names = ["aside", "codex", "gbrain", "board"] as const
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Executor status">
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs", problem ? "text-cut" : "text-muted-foreground")} title={problem ?? health?.version}>
        <span className={cn("size-1.5 rounded-full", problem ? "bg-cut" : health?.ok ? "bg-keep" : "bg-foreground/30")} />
        server{health?.version ? ` ${health.version}` : ""}{problem ? " down" : ""}
      </span>
      {names.map((n) => {
        const state = health?.executors?.[n]
        return (
          <span key={n} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-2xs text-muted-foreground" title={state === undefined ? "not reported by /api/health" : state ? "available" : "unavailable"}>
            <span className={cn("size-1.5 rounded-full", state === undefined ? "bg-foreground/25" : state ? "bg-keep" : "bg-cut")} />
            {n}{state === undefined && <span className="text-muted-foreground/60">?</span>}
          </span>
        )
      })}
    </div>
  )
}

function Tally({ view }: { view: RunView }) {
  const proposals = view.order.map((id) => view.proposals[id])
  const tally = { keep: 0, escalate: 0, cut: 0 }
  for (const p of proposals) for (const c of p.critiques) if (c.stance) tally[c.stance]++
  const verdicts = { pass: 0, hold: 0, reject: 0 }
  let reused = 0
  for (const p of proposals) if (p.verdict) { verdicts[p.verdict.decision]++; if (p.verdict.reusedFrom) reused++ }
  const votes = tally.keep + tally.escalate + tally.cut
  const memoryOnly = votes === 0 && reused > 0
  return (
    <div className="rounded-2xl border bg-card/60 p-4">
      <Hemicycle tally={memoryOnly ? { keep: 1, escalate: 0, cut: 0 } : tally} progress={votes || reused ? 1 : 0} memory={memoryOnly} className="mx-auto max-w-xs" />
      <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
        {([["pass", verdicts.pass, "text-keep"], ["hold", verdicts.hold, "text-escalate"], ["reject", verdicts.reject, "text-cut"], ["reused", reused, "text-memory"]] as const).map(([k, v, tone]) => (
          <div key={k}>
            <dt className="font-mono text-2xs text-muted-foreground uppercase">{k}</dt>
            <dd className={cn("num text-2xl font-semibold", v ? tone : "text-muted-foreground/50")}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-center font-mono text-2xs text-muted-foreground">
        {votes} critiques · <span className="text-keep">{tally.keep} keep</span> · <span className="text-escalate">{tally.escalate} escalate</span> · <span className="text-cut">{tally.cut} cut</span>
      </p>
    </div>
  )
}



export function Console() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const initialFixture = params.get("demo") === "seoul" ? "seoul" : params.get("replay") && params.get("replay") !== "0" ? params.get("replay")! : STATIC ? "seoul" : null
  const [view, setView] = useState<RunView>(emptyRun)
  const [source, setSource] = useState<Source | null>(null)
  const [fixture, setFixture] = useState<string | null>(initialFixture)
  const [demo, setDemo] = useState(params.get("demo") === "seoul" || STATIC)
  const [request, setRequest] = useState("")
  const [speed, setSpeed] = useState(1)
  const [palette, setPalette] = useState(false)
  const [runsKey, setRunsKey] = useState(0)
  const stopRef = useRef<StopFn | null>(null)

  const stop = useCallback(() => { stopRef.current?.(); stopRef.current = null }, [])
  const push = useCallback((e: QuorumEvent) => setView((v) => applyEvent(v, e)), [])
  const finish = useCallback(() => { setView((v) => (v.status === "running" || v.status === "connecting" ? { ...v, status: v.errors.length ? "error" : "done" } : v)); setRunsKey((k) => k + 1) }, [])
  const fail = useCallback((m: string) => setView((v) => ({ ...v, status: "error", failure: m })), [])
  const setUrl = useCallback((key: string | null, value?: string) => {
    const url = new URL(window.location.href)
    url.searchParams.delete("replay"); url.searchParams.delete("demo")
    if (key && value) url.searchParams.set(key, value)
    window.history.replaceState(null, "", url)
  }, [])

  const startReplay = useCallback(async (key: string, rate = speed, paced = demo) => {
    stop()
    const k = key in FIXTURES ? key : "seoul"
    setFixture(k); setSource("fixture"); setDemo(paced)
    setUrl(paced && k === "seoul" ? "demo" : "replay", paced && k === "seoul" ? "seoul" : k)
    setView({ ...emptyRun(), status: "connecting", mode: "replay", request: FIXTURES[k].label })
    stopRef.current = await playFixture(k, rate, push, finish, fail, { demo: paced })
  }, [demo, fail, finish, push, setUrl, speed, stop])

  const playHistory = useCallback((run: RunSummary) => {
    stop()
    setFixture(null); setSource("history"); setUrl(null)
    setView({ ...emptyRun(), status: "connecting", runId: run.runId, request: run.request })
    stopRef.current = followRun(run.runId, push, finish, fail)
  }, [fail, finish, push, setUrl, stop])

  const convene = useCallback(async (text: string) => {
    const req = text.trim()
    if (!req || STATIC) return
    stop()
    setFixture(null); setSource("live"); setUrl(null)
    setView({ ...emptyRun(), status: "connecting", mode: "live", request: req })
    stopRef.current = await startLive(req, (runId) => setView((v) => ({ ...v, runId })), push, finish, fail)
  }, [fail, finish, push, setUrl, stop])

  const startRecipe = useCallback(async (id: string) => {
    stop()
    setFixture(null); setSource("recipe"); setUrl(null)
    setView({ ...emptyRun(), status: "connecting", mode: "live", request: `recipe: ${id}` })
    stopRef.current = await runRecipe(id, (runId) => setView((v) => ({ ...v, runId })), push, finish, fail)
  }, [fail, finish, push, setUrl, stop])

  useEffect(() => {
    if (initialFixture) void startReplay(initialFixture, 1, params.get("demo") === "seoul" || (STATIC && !params.get("replay")))
    return () => stop()
    // start once from the URL; later runs come from buttons
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((o) => !o) } }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Workspace 사이드바의 Recipes 링크(/app#recipes)가 레시피 패널로 바로 오게 해요(패널은 첫 렌더 뒤에 생겨서 브라우저가 스스로 못 찾아요)
  useEffect(() => {
    if (location.hash === "#recipes") requestAnimationFrame(() => document.getElementById("recipes")?.scrollIntoView({ block: "start" }))
  }, [])

  const isReplay = source === "fixture"
  const proposals = view.order.map((id) => view.proposals[id])
  const busy = view.status === "connecting" || view.status === "running"
  const label = source === "fixture" ? "REPLAY" : source === "history" ? "PLAYBACK" : source === "recipe" ? "RECIPE" : "LIVE"

  return (
    <div className="min-h-dvh">
      {STATIC && (
        <div role="note" className="border-b border-escalate/30 bg-escalate/10 px-4 py-2 text-center text-sm text-escalate">
          {STATIC_NOTE}. <a className="underline underline-offset-2" href="https://github.com/tryquorum/quorum">Source and setup</a>
        </div>
      )}
      {isReplay && (
        <div role="status" className="sticky top-0 z-40 border-b border-escalate/30 bg-escalate/12 px-4 py-2 text-sm text-escalate backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="rounded border border-escalate/50 px-1.5 font-mono text-xs font-bold tracking-widest">REPLAY</span>
            <span className="min-w-0 flex-1">
              <span className="sm:hidden">Recorded earlier, not live</span>
              <span className="hidden sm:inline">{fixture === "seoul" ? "Recorded live at c0mpiled-17 Seoul, 11:31 KST today." : "Scripted sample run."} Nothing is running now{demo ? "; paced for viewing" : ""}.</span>
            </span>
            <div className="flex items-center gap-1">
              {[1, 2, 4].map((s) => (
                <button key={s} type="button" onClick={() => { setSpeed(s); void startReplay(fixture ?? "seoul", s) }} className={cn("rounded px-1.5 py-0.5 font-mono text-xs", speed === s ? "bg-escalate/25" : "hover:bg-escalate/15")}>{s}×</button>
              ))}
              <button type="button" onClick={() => void startReplay(fixture ?? "seoul")} className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-escalate/15"><RotateCcw className="size-3" />Restart</button>
              {busy && <button type="button" onClick={() => { stop(); setView((v) => ({ ...v, status: "done" })) }} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-escalate/15"><Square className="size-3" />Stop</button>}
            </div>
          </div>
        </div>
      )}

      <header className="border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Brand />
          <span className="font-mono text-xs text-muted-foreground">console</span>
          <a href={import.meta.env.BASE_URL + "w"} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">Workspace</a>
          <div className="ml-auto"><HealthChips /></div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <form className="rounded-2xl border bg-card/60 p-3 sm:p-4" onSubmit={(e) => { e.preventDefault(); void convene(request) }}>
          <label htmlFor="request" className="mb-2 block text-sm font-medium">What do you need?</label>
          <Textarea
            id="request"
            value={request}
            disabled={STATIC}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void convene(request) } }}
            placeholder={STATIC ? "The live council runs on your own machine. Here you can watch the recorded Seoul run." : "Sort out what I need to do from today's event announcements"}
            className="min-h-20 resize-none border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={STATIC || !request.trim() || view.status === "connecting"} className="rounded-full px-4"><Gavel />Convene the council</Button>
            <Button type="button" variant="ghost" className="rounded-full" onClick={() => setPalette(true)}>
              Examples <kbd className="ml-1 rounded border px-1 font-mono text-2xs text-muted-foreground">⌘K</kbd>
            </Button>
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <Button type="button" variant="outline" className="rounded-full" onClick={() => void startReplay("seoul", 1, true)}><Play />Replay the Seoul run</Button>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => void startReplay("reuse", 1, false)}><Brain />Memory reuse sample</Button>
          </div>
        </form>

        {view.failure && (
          // Alert styling from board run-view.tsx RunError
          <div role="alert" className="mt-4 flex flex-col gap-1.5 rounded-lg bg-destructive/5 px-4 py-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-destructive"><CircleAlert className="size-4" />{source === "fixture" ? "The recording could not be played" : source === "recipe" ? "The recipe did not run" : source === "history" ? "The run could not be played back" : "The council did not start"}</p>
            <p className="leading-relaxed text-foreground/80">{view.failure}. Nothing ran.</p>
            {source !== "fixture" && (
              <div className="pt-1"><Button size="sm" variant="outline" className="rounded-full" onClick={() => void startReplay("seoul", 1, true)}><Play />Watch the recorded Seoul run instead</Button></div>
            )}
          </div>
        )}

        {view.status !== "idle" && (
          <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
            <Badge className={cn("font-mono tracking-wider", source === "live" ? "bg-live/15 text-live" : source === "recipe" ? "bg-signal/15 text-signal" : "bg-escalate/15 text-escalate")}>{label}</Badge>
            <Badge variant={view.status === "error" ? "destructive" : "secondary"} className={cn(busy && "animate-pulse")}>{view.status}</Badge>
            {view.runId && <span className="font-mono text-xs text-muted-foreground">{view.runId}</span>}
            {view.request && <span className="line-clamp-2 min-w-0 basis-full text-base font-medium sm:basis-auto">“{view.request}”</span>}
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Council floor" className="flex min-w-0 flex-col gap-3">
            {proposals.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center">
                <Hemicycle tally={{ keep: 0, escalate: 0, cut: 0 }} progress={0} className="max-w-sm" />
                <p className="mt-2 text-lg font-semibold tracking-tight">{busy ? "The council is gathering…" : "The floor is empty"}</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {busy ? "Proposals appear here as bots put them on the floor." : "Ask for something above, or replay a recorded run. Proposals, the argument over each one and the verdict appear here as they happen."}
                </p>
              </div>
            ) : (
              proposals.map((p) => <ProposalCard key={p.id} p={p} captions={view.runId === SEOUL_RUN_ID ? EN : undefined} />)
            )}
            {view.errors.map((e) => (
              <div key={e.seq} role="alert" className="rounded-lg bg-destructive/5 px-4 py-3 text-sm">
                <p className="font-semibold text-destructive">{e.actor}: error</p>
                <p className="text-foreground/80">{e.text}</p>
              </div>
            ))}
            {view.end && (
              <p className="rounded-xl border bg-card/60 px-4 py-3 text-sm text-muted-foreground"><span className="font-mono text-signal">run.end</span> · {view.end.text}</p>
            )}
          </section>

          <aside className="flex min-w-0 flex-col gap-4">
            <Tally view={view} />
            <RecallPanel view={view} />
            <RecipePanel steps={view.recipe} />
            <OutcomePanel view={view} />
            <div id="recipes" className="scroll-mt-4"><RecipesPanel disabledReason={STATIC ? "Recipes run against your signed-in browser, so they only run locally." : undefined} busy={busy} onRun={(id) => void startRecipe(id)} /></div>
            <Panel title="Event stream" icon={Terminal} aside={<span className="num text-2xs text-muted-foreground">{view.events.length}</span>}>
              {view.events.length ? <EventLog events={view.events} /> : <p className="text-sm text-muted-foreground">Raw contract events, in order.</p>}
            </Panel>
          </aside>
        </div>

        <section className="mt-10" aria-label="Recent runs">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"><History className="size-4" />Recent runs on this server <span className="text-2xs">· click to play back</span></h2>
          {STATIC ? (
            <p className="rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground">{STATIC_NOTE}. Run history lives in your local server.</p>
          ) : (
            <RunList refreshKey={runsKey} current={source === "history" ? view.runId : undefined} onPlay={playHistory} />
          )}
        </section>
      </main>

      <CommandDialog open={palette} onOpenChange={setPalette} title="Examples" description="Pick a request or a recorded run">
        <Command>
          <CommandInput placeholder="Search examples…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {!STATIC && (
              <CommandGroup heading="Ask the council">
                {EXAMPLES.map((ex) => (
                  <CommandItem key={ex} value={ex} onSelect={() => { setRequest(ex); setPalette(false); document.getElementById("request")?.focus() }}>
                    <Gavel />{ex}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Recorded runs">
              {Object.entries(FIXTURES).map(([k, f]) => (
                <CommandItem key={k} value={f.label} onSelect={() => { setPalette(false); void startReplay(k, 1, k === "seoul") }}>
                  <Play />{f.label}<CommandShortcut>replay</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  )
}
