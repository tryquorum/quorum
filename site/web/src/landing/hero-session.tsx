import { useEffect, useState } from "react"
import { Hemicycle, type Tally } from "@/components/hemicycle"
import { cn } from "@/lib/utils"
import type { Decision, Role, Stance } from "@/lib/contract"

type Scene = {
  proposer: string
  title: string
  executor: "aside" | "codex" | "board"
  critiques: [Role, Stance, string][]
  tally: Tally
  verdict: Decision
  result: string
  recall?: string
}

// A scripted session in the contract's own vocabulary (proposal, critique, verdict, execute.result).
const SCENES: Scene[] = [
  { proposer: "bot:scout", title: "Read today's Luma announcements", executor: "aside",
    critiques: [["ceo", "keep", "you asked for exactly this"], ["qa", "keep", "recipe luma-blasts covers it"], ["cso", "keep", "read-only"]],
    tally: { keep: 8, escalate: 1, cut: 1 }, verdict: "pass", result: "aside · read 7 announcements" },
  { proposer: "bot:ops", title: "Email every organizer to confirm details", executor: "aside",
    critiques: [["ceo", "cut", "nobody asked to contact anyone"], ["cso", "escalate", "sends mail in your name"], ["reviewer", "cut", "details are already in the posts"]],
    tally: { keep: 1, escalate: 3, cut: 6 }, verdict: "reject", result: "nothing ran" },
  { proposer: "bot:planner", title: "Draft a submission checklist", executor: "codex",
    critiques: [["reviewer", "keep", "no open task covers it"], ["qa", "keep", "checkable output: checklist.md"]],
    tally: { keep: 7, escalate: 2, cut: 1 }, verdict: "pass", result: "codex · checklist.md, 4 items" },
  { proposer: "bot:planner", title: "Post the checklist to the team channel", executor: "board",
    critiques: [["cso", "escalate", "posts where others can see"], ["ceo", "keep", "team needs it by 14:00"]],
    tally: { keep: 4, escalate: 5, cut: 1 }, verdict: "hold", result: "board · waiting for your approval" },
  { proposer: "you", title: "What do I need to do from the announcements?", executor: "aside",
    critiques: [], recall: "gb:v-0412 · score 0.93",
    tally: { keep: 1, escalate: 0, cut: 0 }, verdict: "pass", result: "verdict reused · no debate needed" },
]

const SCENE_MS = 6200
const STAMP: Record<Decision, string> = { pass: "PASS", hold: "HOLD", reject: "REJECT" }
const STAMP_TONE: Record<Decision, string> = { pass: "border-keep text-keep", hold: "border-escalate text-escalate", reject: "border-cut text-cut" }
const TYPE_TONE: Record<string, string> = {
  proposal: "text-foreground", critique: "text-muted-foreground", verdict: "text-signal",
  recall: "text-memory", "execute.result": "text-live",
}
const STANCE_TONE: Record<Stance, string> = { keep: "text-keep", cut: "text-cut", escalate: "text-escalate" }

type Line = { id: number; type: string; actor: string; text: string; stance?: Stance }

function linesFor(scene: Scene, t: number, base: number): Line[] {
  const out: Line[] = []
  let id = base
  if (scene.recall) {
    out.push({ id: id++, type: "recall", actor: "gbrain", text: scene.recall })
    if (t > 1200) out.push({ id: id++, type: "verdict", actor: "council", text: `${STAMP[scene.verdict].toLowerCase()} · reused from gb:v-0412` })
    if (t > 2600) out.push({ id: id++, type: "execute.result", actor: scene.executor, text: scene.result })
    return out
  }
  out.push({ id: id++, type: "proposal", actor: scene.proposer, text: scene.title })
  scene.critiques.forEach(([role, stance, why], i) => {
    if (t > 700 + i * 650) out.push({ id: id++, type: "critique", actor: `bot:${role}`, text: `${stance} · ${why}`, stance })
  })
  if (t > 3000) out.push({ id: id++, type: "verdict", actor: "council", text: STAMP[scene.verdict].toLowerCase() })
  if (t > 3900) out.push({ id: id++, type: "execute.result", actor: scene.verdict === "reject" ? "council" : scene.executor, text: scene.result })
  return out
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const q = matchMedia("(prefers-reduced-motion: reduce)")
    const on = () => setReduced(q.matches)
    q.addEventListener("change", on)
    return () => q.removeEventListener("change", on)
  }, [])
  return reduced
}

export function HeroSession() {
  const reduced = useReducedMotion()
  const [clock, setClock] = useState(0)
  useEffect(() => {
    if (reduced) return
    const start = performance.now()
    const id = window.setInterval(() => setClock(performance.now() - start), 90)
    return () => window.clearInterval(id)
  }, [reduced])
  const total = reduced ? SCENE_MS * 3 - 1 : clock
  const index = Math.floor(total / SCENE_MS) % SCENES.length
  const t = reduced ? SCENE_MS - 1 : total % SCENE_MS
  const scene = SCENES[index]
  const progress = scene.recall ? (t > 1200 ? 1 : 0) : Math.min(1, Math.max(0, (t - 700) / 2200))
  const stamped = scene.recall ? t > 1200 : t > 3000

  // keep a rolling log across scenes so it reads like one live stream
  const history: Line[] = []
  for (let back = 2; back >= 1; back--) {
    const prevIndex = Math.floor(total / SCENE_MS) - back
    if (prevIndex >= 0) history.push(...linesFor(SCENES[prevIndex % SCENES.length], SCENE_MS, prevIndex * 100))
  }
  const lines = [...history, ...linesFor(scene, t, Math.floor(total / SCENE_MS) * 100)].slice(-9)

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card/60 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground">
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="ml-2 truncate font-mono">quorum · council session</span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-2xs whitespace-nowrap uppercase tracking-wider">
          <span className="size-1.5 animate-pulse rounded-full bg-signal" /> scripted demo
        </span>
      </div>
      <div className="grid gap-0 md:grid-cols-[1.15fr_1fr]">
        <div className="relative px-4 pt-6 pb-4 sm:px-8">
          <Hemicycle tally={scene.tally} progress={progress} memory={!!scene.recall} />
          <div className="mt-3 flex flex-col items-center gap-2 px-2 text-center md:absolute md:inset-x-0 md:bottom-5 md:mt-0 md:px-6">
            <p className="max-w-[22ch] text-sm font-medium text-balance text-foreground sm:text-base">{scene.title}</p>
            <div className="flex h-8 items-center gap-2">
              {stamped ? (
                <span key={index} className={cn("stamp rounded-md border-2 px-2.5 py-0.5 font-mono text-sm font-bold tracking-widest", scene.recall ? "border-memory text-memory" : STAMP_TONE[scene.verdict])}>
                  {scene.recall ? "REUSED" : STAMP[scene.verdict]}
                </span>
              ) : (
                <span className="font-mono text-2xs tracking-wider text-muted-foreground uppercase">{scene.recall ? "recalling…" : "arguing…"}</span>
              )}
            </div>
          </div>
        </div>
        <ol className="min-h-[14rem] border-t bg-background/60 p-4 font-mono text-[12px] leading-relaxed md:min-h-[19rem] md:border-t-0 md:border-l" aria-label="Council event stream">
          {lines.map((l) => (
            <li key={l.id} className="row-in grid grid-cols-[7rem_1fr] gap-2 truncate sm:grid-cols-[7.25rem_5.75rem_1fr]">
              <span className={cn(TYPE_TONE[l.type] ?? "text-muted-foreground")}>{l.type}</span>
              <span className="hidden truncate text-muted-foreground sm:block">{l.actor}</span>
              <span className={cn("truncate", l.stance ? STANCE_TONE[l.stance] : "text-foreground/85")}>{l.text}</span>
            </li>
          ))}
          <li className="caret text-muted-foreground" aria-hidden />
        </ol>
      </div>
    </div>
  )
}
