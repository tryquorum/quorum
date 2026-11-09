import { Globe, ShieldCheck } from "lucide-react"
import { Md } from "@/components/md"
import { cn } from "@/lib/utils"
import type { Decision, Role, Stance } from "@/lib/contract"
import { CHIP, DECIDE } from "@/workspace/tone"
import { EN, SEOUL_PROPOSALS, SEOUL_SUMMARY } from "@/lib/seoul"

// Real critiques from the live Seoul run, picked by seq. Text is the engine's own Korean; captions are translations.
const PICKS = [6, 15, 10, 11]
const ROLE: Record<Role, string> = { ceo: "CEO", reviewer: "Reviewer", qa: "QA", cso: "CSO" }
const ROLE_Q: Record<Role, string> = { ceo: "Is it needed?", reviewer: "Is it a duplicate or a bug?", qa: "Will it actually work?", cso: "What could go wrong?" }
// One tone, as in the workspace (tone.ts): neutral chips; hold and escalate are the inverted chip; no hue for verdicts.
const STANCE: Record<Stance, string> = { keep: "border border-border text-foreground", cut: CHIP, escalate: "border border-transparent " + DECIDE }
const DECISION: Record<Decision, string> = { pass: "border border-border text-foreground", hold: "border border-transparent " + DECIDE, reject: CHIP }
const BAR: Record<Stance, string> = { keep: "bg-foreground", cut: "bg-foreground/20", escalate: "bg-foreground/60" }

const all = SEOUL_PROPOSALS.flatMap((p) => p.critiques.map((c) => ({ ...c, p })))
const cards = PICKS.map((seq) => all.find((c) => c.seq === seq)).filter((c): c is (typeof all)[number] => !!c)
const checklist = SEOUL_SUMMARY.split("**(2)")[0]

export function Argument() {
  return (
    <div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.seq} className="lp-ring flex flex-col rounded-2xl bg-card p-5">
            <p className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{ROLE[c.role]}</span>
              <span className="text-muted-foreground">{ROLE_Q[c.role]}</span>
            </p>
            <p className="mt-3 leading-snug font-medium text-pretty">“{c.reasonEn}”</p>
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground" lang="ko">{c.reason}</p>
            <p className="mt-auto flex items-center gap-2 pt-4 font-mono text-2xs text-muted-foreground">
              <span className={cn("rounded px-1", STANCE[c.stance])}>{c.stance}</span>on {c.p.id} · seq {c.seq}
            </p>
          </li>
        ))}
      </ul>

      <ul className="lp-ring mt-3 overflow-hidden rounded-2xl bg-card">
        {SEOUL_PROPOSALS.map((p) => (
          <li key={p.id} className="grid gap-x-6 gap-y-2 border-t p-4 first:border-t-0 sm:grid-cols-[1fr_auto] sm:items-center sm:px-5">
            <div className="min-w-0">
              <p className="font-mono text-2xs text-muted-foreground">{p.id} · proposed by {p.actor}</p>
              <p className="mt-1 leading-snug font-medium">{p.titleEn}</p>
              <p className="mt-1 text-sm text-muted-foreground">{p.decisionEn}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex gap-1" aria-label={p.critiques.map((c) => ROLE[c.role] + " " + c.stance).join(", ")}>
                {p.critiques.map((c) => <span key={c.seq} className={cn("h-1.5 w-5 rounded-full", BAR[c.stance])} />)}
              </span>
              {p.decision && <span className={cn("rounded-full px-2 py-0.5 font-mono text-xs font-semibold uppercase", DECISION[p.decision])}>{p.decision}</span>}
            </div>
          </li>
        ))}
      </ul>

      <div className="lp-ring mt-3 overflow-hidden rounded-2xl bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-sm">
          <Globe className="size-4 text-muted-foreground" />
          <span className="font-medium">Aside ran p1 in the signed-in browser</span>
          <span className="font-mono text-2xs text-muted-foreground">execute.result · seq 21</span>
          <span className={"ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs " + CHIP}><ShieldCheck className="size-3.5" />{EN[21].split(". ")[1]}</span>
        </div>
        <details className="group px-5 py-4">
          <summary className="cursor-pointer list-none text-sm text-muted-foreground select-none hover:text-foreground">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">▶</span> Read what Aside wrote back (Korean)
          </summary>
          <Md text={checklist} className="mt-3 max-h-80 overflow-y-auto pr-2 text-sm" />
        </details>
      </div>
    </div>
  )
}
