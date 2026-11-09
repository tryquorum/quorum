import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Brain, CircleAlert, Gavel, History, Play, RotateCcw, Square, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Brand } from "@/components/wordmark"
import { Hemicycle } from "@/components/hemicycle"
import { cn } from "@/lib/utils"
import type { Health, QuorumEvent } from "@/lib/contract"
import { applyEvent, emptyRun, FIXTURES, playFixture, startLive, type RunView, type StopFn } from "./stream"
import { EventLog, OutcomePanel, Panel, ProposalCard, RecallPanel, RecipePanel } from "./panels"
import { RunList } from "./run-list"

const EXAMPLES = [
  "Sort out what I need to do from today's event announcements",
  "What do I need to do from the event announcements?",
  "Check whether the Luma recipe still works and fix it if not",
  "Draft a 2-minute demo script from our README",
]

function useHealth() {
  const [health, setHealth] = useState<Health | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch("/api/health")
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
  const replayKey = params.get("replay")
  const [view, setView] = useState<RunView>(emptyRun)
  const [request, setRequest] = useState("")
  const [replay, setReplay] = useState<string | null>(replayKey && replayKey !== "0" ? replayKey : null)
  const [speed, setSpeed] = useState(1)
  const [palette, setPalette] = useState(false)
  const [runsKey, setRunsKey] = useState(0)
  const stopRef = useRef<StopFn | null>(null)

  const stop = useCallback(() => { stopRef.current?.(); stopRef.current = null }, [])
  const push = useCallback((e: QuorumEvent) => setView((v) => applyEvent(v, e)), [])
  const finish = useCallback(() => { setView((v) => (v.status === "running" || v.status === "connecting" ? { ...v, status: v.errors.length ? "error" : "done" } : v)); setRunsKey((k) => k + 1) }, [])
  const fail = useCallback((m: string) => setView((v) => ({ ...v, status: "error", failure: m })), [])

  const startReplay = useCallback(async (key: string, rate = speed) => {
    stop()
    const meta = FIXTURES[key] ?? FIXTURES["1"]
    setReplay(key in FIXTURES ? key : "1")
    const url = new URL(window.location.href)
    url.searchParams.set("replay", key in FIXTURES ? key : "1")
    window.history.replaceState(null, "", url)
    setView({ ...emptyRun(), status: "connecting", mode: "replay", request: meta.label })
    stopRef.current = await playFixture(key, rate, push, finish, fail)
  }, [fail, finish, push, speed, stop])

  const convene = useCallback(async (text: string) => {
    const req = text.trim()
    if (!req) return
    stop()
    setReplay(null)
    const url = new URL(window.location.href)
    url.searchParams.delete("replay")
    window.history.replaceState(null, "", url)
    setView({ ...emptyRun(), status: "connecting", mode: "live", request: req })
    stopRef.current = await startLive(req, (runId) => setView((v) => ({ ...v, runId })), push, finish, fail)
  }, [fail, finish, push, stop])

  useEffect(() => {
    if (replay) void startReplay(replay)
    return () => stop()
    // start once from the URL; later replays come from buttons
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((o) => !o) } }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const isReplay = view.mode === "replay" || !!replay
  const proposals = view.order.map((id) => view.proposals[id])
  const busy = view.status === "connecting" || view.status === "running"

  return (
    <div className="min-h-dvh">
      {isReplay && (
        <div role="status" className="sticky top-0 z-40 border-b border-escalate/30 bg-escalate/12 px-4 py-2 text-sm text-escalate backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="rounded border border-escalate/50 px-1.5 font-mono text-xs font-bold tracking-widest">REPLAY</span>
            <span className="min-w-0 flex-1">
              <span className="sm:hidden">Recorded earlier, not live</span>
              <span className="hidden sm:inline">Recorded run {view.runId ? <span className="font-mono">{view.runId}</span> : null}. Nothing is running now; these events were recorded earlier.</span>
            </span>
            <div className="flex items-center gap-1">
              {[1, 2, 4].map((s) => (
                <button key={s} type="button" onClick={() => { setSpeed(s); void startReplay(replay ?? "1", s) }} className={cn("rounded px-1.5 py-0.5 font-mono text-xs", speed === s ? "bg-escalate/25" : "hover:bg-escalate/15")}>{s}×</button>
              ))}
              <button type="button" onClick={() => void startReplay(replay ?? "1")} className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-escalate/15"><RotateCcw className="size-3" />Restart</button>
              {busy && <button type="button" onClick={() => { stop(); setView((v) => ({ ...v, status: "done" })) }} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-escalate/15"><Square className="size-3" />Stop</button>}
            </div>
          </div>
        </div>
      )}

      <header className="border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Brand />
          <span className="font-mono text-xs text-muted-foreground">console</span>
          <div className="ml-auto"><HealthChips /></div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <form
          className="rounded-2xl border bg-card/60 p-3 sm:p-4"
          onSubmit={(e) => { e.preventDefault(); void convene(request) }}
        >
          <label htmlFor="request" className="mb-2 block text-sm font-medium">What do you need?</label>
          <Textarea
            id="request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void convene(request) } }}
            placeholder="Sort out what I need to do from today's event announcements"
            className="min-h-20 resize-none border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!request.trim() || view.status === "connecting"} className="rounded-full px-4">
              <Gavel />Convene the council
            </Button>
            <Button type="button" variant="ghost" className="rounded-full" onClick={() => setPalette(true)}>
              Examples <kbd className="ml-1 rounded border px-1 font-mono text-2xs text-muted-foreground">⌘K</kbd>
            </Button>
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <Button type="button" variant="outline" className="rounded-full" onClick={() => void startReplay("1")}><Play />Watch recorded run</Button>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => void startReplay("reuse")}><Brain />Memory reuse</Button>
          </div>
        </form>

        {view.failure && (
          // Alert styling from board run-view.tsx RunError
          <div role="alert" className="mt-4 flex flex-col gap-1.5 rounded-lg bg-destructive/5 px-4 py-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-destructive"><CircleAlert className="size-4" />{view.mode === "replay" ? "The recorded run could not be played" : "The council did not start"}</p>
            <p className="leading-relaxed text-foreground/80">{view.failure}. Nothing ran.</p>
            {view.mode !== "replay" && (
              <div className="pt-1"><Button size="sm" variant="outline" className="rounded-full" onClick={() => void startReplay("1")}><Play />Watch a recorded run instead</Button></div>
            )}
          </div>
        )}

        {view.status !== "idle" && (
          <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
            <Badge className={cn("font-mono tracking-wider", view.mode === "replay" ? "bg-escalate/15 text-escalate" : "bg-live/15 text-live")}>{view.mode === "replay" ? "REPLAY" : "LIVE"}</Badge>
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
                  {busy ? "Proposals appear here as bots put them on the floor." : "Ask for something above. Proposals, the argument over each one and the verdict appear here as they happen."}
                </p>
              </div>
            ) : (
              proposals.map((p) => <ProposalCard key={p.id} p={p} />)
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
            <Panel title="Event stream" icon={Terminal} aside={<span className="num text-2xs text-muted-foreground">{view.events.length}</span>}>
              {view.events.length ? <EventLog events={view.events} /> : <p className="text-sm text-muted-foreground">Raw contract events, in order.</p>}
            </Panel>
          </aside>
        </div>

        <section className="mt-10" aria-label="Recent runs">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"><History className="size-4" />Recent runs</h2>
          <RunList refreshKey={runsKey} />
        </section>
      </main>

      <CommandDialog open={palette} onOpenChange={setPalette} title="Examples" description="Pick a request or a recorded run">
        <Command>
          <CommandInput placeholder="Search examples…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup heading="Ask the council">
              {EXAMPLES.map((ex) => (
                <CommandItem key={ex} value={ex} onSelect={() => { setRequest(ex); setPalette(false); document.getElementById("request")?.focus() }}>
                  <Gavel />{ex}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Recorded runs">
              {Object.entries(FIXTURES).map(([k, f]) => (
                <CommandItem key={k} value={f.label} onSelect={() => { setPalette(false); void startReplay(k) }}>
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
