import { Brain, CircleAlert, Globe, LayoutDashboard, Terminal, Wrench } from "lucide-react"
import { Steps } from "@/components/steps"
import { cn } from "@/lib/utils"
import type { Decision, Executor, QuorumEvent, Role, Stance } from "@/lib/contract"
import type { Proposal, RecipeStep, RunView } from "./stream"
import { ALERT, CHIP, DECIDE, LATE } from "@/workspace/tone"

// One tone, as in the workspace (site/web/src/workspace/tone.ts): neutral chips; what needs a decision (hold, escalate)
// is an inverted neutral chip; red only for real failures, as text and border, never a tinted fill.

export const ROLE_LABEL: Record<Role, string> = { ceo: "CEO", reviewer: "Reviewer", qa: "QA", cso: "CSO" }
export const STANCE_TONE: Record<Stance, string> = {
  keep: "border border-border text-foreground",
  cut: "border border-border text-muted-foreground",
  escalate: "border border-transparent " + DECIDE,
}
export const DECISION_TONE: Record<Decision, string> = {
  pass: "border-border text-foreground",
  hold: "border-transparent " + DECIDE,
  reject: "border-border text-muted-foreground",
}
const EXEC_ICON: Record<Executor, typeof Globe> = { aside: Globe, codex: Terminal, board: LayoutDashboard, none: CircleAlert }

export function Panel({ title, icon: Icon, children, className, aside }: { title: string; icon: typeof Globe; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border bg-card/60", className)}>
      <header className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {title}
        <span className="ml-auto">{aside}</span>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function ProposalCard({ p, captions }: { p: Proposal; captions?: Record<number, string> }) {
  const reused = !!p.verdict?.reusedFrom
  const Icon = p.executor ? EXEC_ICON[p.executor] : CircleAlert
  return (
    <article key={p.verdict ? "decided" : "open"} className={cn("row-in rounded-2xl border bg-card/40 p-4 sm:p-5 transition-opacity duration-500", p.verdict?.decision === "reject" && "opacity-75")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-2xs text-muted-foreground">
            <span>{p.id}</span><span>·</span><span>{p.actor}</span>
            {p.executor && <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px"><Icon className="size-3" />{p.executor}</span>}
          </p>
          <h3 className="text-base leading-snug font-semibold tracking-tight text-balance">{p.title}</h3>
          {captions?.[p.seq] && <p className="mt-0.5 text-sm text-muted-foreground italic">{captions[p.seq]}</p>}
          {p.why && <p className="mt-1 text-sm text-muted-foreground">{p.why}</p>}
        </div>
        {p.verdict ? (
          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 font-mono text-xs font-semibold tracking-wider uppercase", DECISION_TONE[p.verdict.decision])}>{p.verdict.decision}</span>
        ) : (
          <span className="shrink-0 animate-pulse font-mono text-2xs tracking-wider text-muted-foreground uppercase">arguing</span>
        )}
      </div>

      {p.critiques.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 border-l-2 border-border pl-3" aria-label="Critiques">
          {p.critiques.map((c) => (
            <li key={c.seq} className="row-in flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="w-16 shrink-0 font-mono text-2xs text-muted-foreground uppercase">{c.role ? ROLE_LABEL[c.role] : c.actor}</span>
              {c.stance && <span className={cn("rounded-full px-1.5 py-px font-mono text-2xs font-medium", STANCE_TONE[c.stance])}>{c.stance}</span>}
              <span className="min-w-0 flex-1 text-foreground/85">
                {c.reason}
                {captions?.[c.seq] && <span className="mt-0.5 block text-[13px] text-muted-foreground italic">{captions[c.seq]}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {p.verdict && (
        <div className="mt-4 rounded-xl bg-background/60 px-3 py-2 text-sm">
          {reused && (
            <p className="mb-1 text-xs font-medium text-foreground">
              <Brain className="mr-1 inline size-3.5 align-[-2px]" />Reused gbrain verdict <span className="font-mono">{p.verdict.reusedFrom}</span>, no debate needed
            </p>
          )}
          <p className="text-foreground/85">{p.verdict.reason}</p>
          {captions?.[p.verdict.seq] && <p className="text-[13px] text-muted-foreground italic">{captions[p.verdict.seq]}</p>}
        </div>
      )}

      {p.exec.length > 0 && <div className="mt-3"><Steps steps={p.exec} /></div>}
    </article>
  )
}

export function RecallPanel({ view }: { view: RunView }) {
  const hits = view.recall?.hits ?? []
  const strong = hits.some((h) => (h.score ?? 0) >= 0.85)
  return (
    <Panel title="gbrain recall" icon={Brain} aside={strong ? <span className={"rounded-full px-1.5 py-px font-mono text-2xs " + DECIDE}>reuse</span> : null}>
      {!view.recall ? (
        <p className="text-sm text-muted-foreground">Past verdicts on similar requests show up here.</p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-muted-foreground">No similar verdicts. The council decides from scratch.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {hits.map((h) => (
            <li key={h.id} className="text-sm">
              <div className="mb-1 flex items-baseline gap-2 font-mono text-2xs text-muted-foreground">
                <span className={cn("min-w-0 truncate", (h.score ?? 0) >= 0.85 && "text-foreground")} title={h.id}>{h.id}</span>
                {h.score !== undefined && <span className="ml-auto shrink-0 num">{h.score.toFixed(2)}</span>}
              </div>
              {h.decision && <p className="mb-1 text-2xs text-muted-foreground">{h.decision}</p>}
              {h.score !== undefined && (
                <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", h.score >= 0.85 ? "bg-foreground" : "bg-foreground/30")} style={{ width: `${Math.round(h.score * 100)}%` }} />
                </div>
              )}
              <p className="text-foreground/85">{h.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

const RECIPE_TONE: Record<RecipeStep["type"], string> = { "recipe.run": "text-muted-foreground", "recipe.broken": LATE, "recipe.repaired": "text-foreground" }
export function RecipePanel({ steps }: { steps: RecipeStep[] }) {
  const broken = steps.some((s) => s.type === "recipe.broken")
  const repaired = steps.some((s) => s.type === "recipe.repaired")
  return (
    <Panel title="Recipe health" icon={Wrench} aside={repaired ? <span className={"rounded-full px-1.5 py-px font-mono text-2xs " + CHIP}>repaired</span> : broken ? <span className={"rounded-full px-1.5 py-px font-mono text-2xs " + ALERT}>broken</span> : null}>
      {!steps.length ? (
        <p className="text-sm text-muted-foreground">When a recipe breaks and Aside repairs it, the timeline shows here.</p>
      ) : (
        <ol className="relative flex flex-col gap-3 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-border">
          {steps.map((s) => (
            <li key={s.seq} className="row-in relative grid grid-cols-[0.5rem_1fr] gap-3">
              <span className={cn("mt-1.5 size-2 rounded-full bg-current", RECIPE_TONE[s.type])} />
              <div className="min-w-0 text-sm">
                <p className="font-mono text-2xs text-muted-foreground">{s.type.replace("recipe.", "")} · {s.recipeId ?? s.actor}{s.version !== undefined && ` v${s.version}`}{s.status !== undefined && ` · ${s.status}`}</p>
                {s.endpoint && <p className={cn("truncate font-mono text-xs", RECIPE_TONE[s.type])}>{s.endpoint}</p>}
                <p className="text-foreground/85">{s.reason ?? s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

export function OutcomePanel({ view }: { view: RunView }) {
  const items = [...view.memory, ...view.board].sort((a, b) => a.seq - b.seq)
  return (
    <Panel title="Remembered & posted" icon={LayoutDashboard}>
      {!items.length ? (
        <p className="text-sm text-muted-foreground">gbrain saves and Direction Board posts land here.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {items.map((e) => {
            const column = typeof e.data?.column === "string" ? e.data.column : undefined
            return (
              <li key={e.seq} className="row-in flex items-start gap-2">
                <span className={cn("mt-0.5 rounded-full px-1.5 py-px font-mono text-2xs", column === "approval" ? DECIDE : CHIP)}>
                  {e.type === "memory.saved" ? "gbrain" : column === "approval" ? "approval" : "board"}
                </span>
                <span className="min-w-0 flex-1 text-foreground/85">{e.text}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

const TYPE_TONE: Partial<Record<QuorumEvent["type"], string>> = {
  recall: "text-foreground", proposal: "text-foreground", critique: "text-muted-foreground", verdict: "text-foreground",
  "execute.start": "text-foreground", "execute.result": "text-foreground", "recipe.broken": LATE, "recipe.repaired": "text-foreground",
  "memory.saved": "text-foreground", error: LATE, "run.end": "text-foreground",
}
export function EventLog({ events }: { events: QuorumEvent[] }) {
  return (
    <ol className="scroll-pane max-h-[26rem] overflow-y-auto font-mono text-[11.5px] leading-relaxed" aria-label="Raw event stream">
      {events.map((e) => (
        <li key={`${e.runId}-${e.seq}`} className="grid grid-cols-[2rem_6.5rem_1fr] gap-2 border-b border-border/50 py-1 last:border-0">
          <span className="num text-muted-foreground/70">{e.seq}</span>
          <span className={cn("truncate", TYPE_TONE[e.type] ?? "text-muted-foreground")}>{e.type}</span>
          <span className="line-clamp-2 min-w-0" title={e.text}>
            <span className="text-muted-foreground">{e.actor}</span>{" "}
            <span className="text-foreground/85">{e.text}</span>
            {e.mode === "replay" && <span className={"ml-1.5 rounded px-1 text-[10px] " + CHIP}>replay</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
