import { useEffect, useState } from "react"
import { Globe, ShieldCheck } from "lucide-react"
import { Md } from "@/components/md"
import { useInView, useReducedMotion } from "@/components/reveal"
import { cn } from "@/lib/utils"
import type { Decision, Role, Stance } from "@/lib/contract"
import { EN, SEOUL_PROPOSALS, SEOUL_SUMMARY } from "@/lib/seoul"

// Real critiques from today's live run, picked by seq. Text is the engine's own Korean; captions are translations.
const PICKS: { seq: number; why: string }[] = [
  { seq: 6, why: "scope" },
  { seq: 15, why: "risk" },
  { seq: 10, why: "duplicate" },
  { seq: 11, why: "evidence" },
]
const ROLE: Record<Role, string> = { ceo: "CEO", reviewer: "Reviewer", qa: "QA", cso: "CSO" }
const ROLE_Q: Record<Role, string> = { ceo: "Is it needed?", reviewer: "Is it a duplicate or a bug?", qa: "Will it actually work?", cso: "What could go wrong?" }
const STANCE: Record<Stance, string> = { keep: "bg-keep/15 text-keep", cut: "bg-cut/15 text-cut", escalate: "bg-escalate/15 text-escalate" }
const BORDER: Record<Stance, string> = { keep: "border-keep/35", cut: "border-cut/35", escalate: "border-escalate/40" }
const DECISION: Record<Decision, string> = { pass: "border-keep text-keep", hold: "border-escalate text-escalate", reject: "border-cut text-cut" }

const all = SEOUL_PROPOSALS.flatMap((p) => p.critiques.map((c) => ({ ...c, p })))
const cards = PICKS.map(({ seq }) => all.find((c) => c.seq === seq)!).filter(Boolean)
const checklist = SEOUL_SUMMARY.split("**(2)")[0]

function FlipCard({ c, on, onToggle }: { c: (typeof cards)[number]; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} className={cn("flip group h-64 w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl", on && "flip-on")}>
      <div className="flip-inner h-full">
        <div className="flip-face flex h-full flex-col rounded-2xl border bg-card/70 p-5">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{ROLE[c.role]}</p>
          <p className="mt-1 text-lg font-semibold tracking-tight">{ROLE_Q[c.role]}</p>
          <p className="mt-auto text-sm text-muted-foreground">on <span className="font-mono">{c.p.id}</span>: {c.p.titleEn}</p>
          <p className="mt-3 font-mono text-2xs text-muted-foreground/70">tap to reveal · seq {c.seq}</p>
        </div>
        <div className={cn("flip-face flip-back flex h-full flex-col rounded-2xl border bg-card p-5", BORDER[c.stance])}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{ROLE[c.role]}</span>
            <span className={cn("rounded-full px-2 py-0.5 font-mono text-xs font-semibold", STANCE[c.stance])}>{c.stance}</span>
            <span className="ml-auto font-mono text-2xs text-muted-foreground">{c.p.id}</span>
          </div>
          <p className="mt-3 text-[15px] leading-snug font-medium text-pretty">“{c.reasonEn}”</p>
          <p className="mt-auto line-clamp-3 text-xs leading-relaxed text-muted-foreground" lang="ko">{c.reason}</p>
        </div>
      </div>
    </button>
  )
}

export function Argument() {
  const reduced = useReducedMotion()
  const { ref, seen } = useInView<HTMLDivElement>(0.3)
  const [flipped, setFlipped] = useState<boolean[]>(() => cards.map(() => false))
  const [verdicts, setVerdicts] = useState(false)
  useEffect(() => {
    if (!seen) return
    if (reduced) { setFlipped(cards.map(() => true)); setVerdicts(true); return }
    const timers = cards.map((_, i) => window.setTimeout(() => setFlipped((f) => f.map((v, k) => (k === i ? true : v))), 500 + i * 650))
    timers.push(window.setTimeout(() => setVerdicts(true), 500 + cards.length * 650 + 300))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [seen, reduced])

  return (
    <div ref={ref} className="mx-auto max-w-6xl">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c, i) => (
          <FlipCard key={c.seq} c={c} on={flipped[i]} onToggle={() => setFlipped((f) => f.map((v, k) => (k === i ? !v : v)))} />
        ))}
      </div>

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {SEOUL_PROPOSALS.map((p, i) => (
          <div key={p.id} className={cn("rounded-2xl border bg-card/50 p-5 transition-all duration-700", verdicts ? "opacity-100" : "translate-y-3 opacity-0")} style={{ transitionDelay: `${i * 180}ms` }}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-2xs text-muted-foreground">{p.id} · {p.actor}</p>
                <p className="mt-1 leading-snug font-medium">{p.titleEn}</p>
              </div>
              {p.decision && verdicts && (
                <span className={cn("stamp shrink-0 rounded-md border-2 px-2 py-0.5 font-mono text-xs font-bold tracking-widest uppercase", DECISION[p.decision])} style={{ animationDelay: `${i * 180}ms` }}>{p.decision}</span>
              )}
            </div>
            <div className="mt-3 flex gap-1" aria-label="critic stances">
              {p.critiques.map((c) => <span key={c.seq} title={`${ROLE[c.role]}: ${c.stance}`} className={cn("h-1.5 flex-1 rounded-full", c.stance === "keep" ? "bg-keep" : c.stance === "cut" ? "bg-cut" : "bg-escalate")} />)}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{p.decisionEn}</p>
          </div>
        ))}
      </div>

      <div className={cn("mt-8 overflow-hidden rounded-2xl border bg-card/60 transition-all duration-700", verdicts ? "opacity-100" : "opacity-0")} style={{ transitionDelay: "700ms" }}>
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-sm">
          <Globe className="size-4 text-live" />
          <span className="font-medium">Aside ran p1 in the signed-in browser</span>
          <span className="font-mono text-2xs text-muted-foreground">execute.result · seq 21</span>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-keep/12 px-2.5 py-0.5 text-xs text-keep"><ShieldCheck className="size-3.5" />{EN[21].split(". ")[1]}</span>
        </div>
        <details className="group px-5 py-4">
          <summary className="cursor-pointer list-none text-sm text-muted-foreground select-none hover:text-foreground">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">▶</span> Read what Aside wrote back (Korean, rendered markdown)
          </summary>
          <Md text={checklist} className="mt-3 max-h-80 overflow-y-auto pr-2 text-sm" />
        </details>
      </div>
    </div>
  )
}
