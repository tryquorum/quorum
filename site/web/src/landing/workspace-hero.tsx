import { useState } from "react"
import { Brain, Check, ChevronsUpDown, CircleDot, Gavel, Globe, Inbox, LayoutGrid, ListChecks, PanelLeft, PenLine, Radio, Search, Send, Target, Workflow } from "lucide-react"
import { QuorumMark } from "@/components/wordmark"
import { cn } from "@/lib/utils"
import type { Decision, Role, Stance } from "@/lib/contract"
import { EN, SEOUL_PROPOSALS, SEOUL_REQUEST_EN } from "@/lib/seoul"

// The Quorum workspace (lane/workspace: ws-sidebar.tsx, rows.tsx, detail.tsx) redrawn with the recorded Seoul run.
// Same layout as the real screen: sidebar, capture bar, "Needs you" rows, and the item popup with
// "gbrain remembers", Send to agent, the four gstack critiques and the verdict. No personal items appear here.
const ROLE: Record<Role, string> = { ceo: "CEO", reviewer: "Reviewer", qa: "QA", cso: "CSO" }
const STANCE: Record<Stance, string> = { keep: "text-keep ring-keep/40", cut: "text-cut ring-cut/40", escalate: "text-escalate ring-escalate/40" }
const DECISION: Record<Decision, string> = { pass: "text-keep ring-keep/40 bg-keep/10", hold: "text-escalate ring-escalate/40 bg-escalate/10", reject: "text-cut ring-cut/40 bg-cut/10" }
const EXEC: Record<string, string> = { p1: "Aside", p2: "Aside", p3: "Direction Board" }

function Sidebar() {
  const nav = [
    { icon: LayoutGrid, label: "Now", n: "3", on: true },
    { icon: Inbox, label: "Inbox" },
    { icon: Target, label: "Goals" },
    { icon: Radio, label: "Signals" },
    { icon: ListChecks, label: "All tasks" },
    { icon: Gavel, label: "Council runs" },
    { icon: Workflow, label: "Recipes" },
  ]
  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-1 border-r bg-sidebar p-3 lg:flex">
      <div className="mb-3 flex items-center gap-2.5 px-1">
        <span className="grid size-8 place-items-center rounded-lg border bg-background"><QuorumMark className="size-4" /></span>
        <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-sm font-semibold">Quorum workspace</span><span className="block text-2xs text-muted-foreground">Seoul demo space</span></span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </div>
      <div className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground"><Search className="size-4" />Search<kbd className="ml-auto rounded border px-1 font-mono text-2xs">⌘K</kbd></div>
      {nav.map(({ icon: Icon, label, n, on }) => (
        <div key={label} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", on ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground")}>
          <Icon className="size-4" />{label}{n && <span className="num ml-auto text-xs">{n}</span>}
        </div>
      ))}
    </aside>
  )
}

export function WorkspaceHero() {
  const [pick, setPick] = useState(SEOUL_PROPOSALS[0]?.id ?? "p1")
  const p = SEOUL_PROPOSALS.find((x) => x.id === pick) ?? SEOUL_PROPOSALS[0]
  const verdictSeq = { pass: 17, hold: 18, reject: 19 } as const
  return (
    <div className="flex min-h-[34rem] bg-background text-left text-foreground lg:min-h-[43rem]">
      <Sidebar />
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <PanelLeft className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Now</span>
          <span className="num text-2xs text-muted-foreground">2026-11-09 · c0mpiled-17 Seoul</span>
          <span className="ml-auto hidden rounded-full border px-2 py-0.5 font-mono text-2xs text-muted-foreground sm:inline">replay · recorded 11:31 KST</span>
        </div>
        <div className="px-4 pt-4 sm:px-6">
          <div className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-sm">
            <PenLine className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{SEOUL_REQUEST_EN}</span>
            <span className="shrink-0 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">Saved</span>
          </div>
        </div>
        <div className="px-4 pt-5 pb-6 sm:px-6 lg:pr-[calc(min(46%,30rem)+2.75rem)]">
          <p className="mb-2 text-2xs font-semibold tracking-wide text-escalate uppercase">Council results <span className="ml-1 font-normal tracking-normal text-muted-foreground normal-case">{SEOUL_PROPOSALS.length} proposals from one request</span></p>
          <ul className="flex flex-col">
            {SEOUL_PROPOSALS.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => setPick(x.id)} aria-pressed={x.id === pick}
                  className={cn("flex w-full items-start gap-3 rounded-lg border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60", x.id === pick ? "border-l-foreground bg-muted/60" : "border-l-transparent")}>
                  <Gavel className={cn("mt-0.5 size-4 shrink-0", x.decision === "pass" ? "text-keep" : x.decision === "hold" ? "text-escalate" : "text-cut")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug">{x.titleEn}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                      <span className="rounded border px-1 font-mono">{x.id} · {x.actor}</span>{x.decisionEn}
                    </span>
                  </span>
                  {x.decision && <span className={cn("shrink-0 rounded px-1.5 font-mono text-2xs font-semibold uppercase ring-1", DECISION[x.decision])}>{x.decision}</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-5 mb-2 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">Due today</p>
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground"><CircleDot className="size-4" />Check in at COEX before 09:40<span className="num ml-auto text-2xs">09:40</span></div>
        </div>

        {/* The item popup, docked right on wide screens like the real dialog */}
        <div className="border-t bg-popover lg:absolute lg:top-16 lg:right-5 lg:bottom-5 lg:w-[min(46%,30rem)] lg:overflow-hidden lg:rounded-xl lg:border lg:shadow-2xl lg:shadow-black/25">
          <div className="flex flex-col gap-2.5 border-b p-4">
            <div className="flex flex-wrap items-center gap-1.5 text-2xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground"><Gavel className="size-3" />Council result</span>
              <span className="rounded-full border px-2 py-0.5 font-mono text-muted-foreground">{p.id} → {EXEC[p.id] ?? "Aside"}</span>
            </div>
            <p className="text-base leading-6 font-semibold">{p.titleEn}</p>
            <div className="rounded-lg border border-memory/25 bg-memory/5 p-2.5">
              <p className="mb-1 flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-memory uppercase"><Brain className="size-3.5" />gbrain remembers</p>
              <p className="text-xs leading-5 text-muted-foreground">{EN[1]}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-medium text-primary-foreground"><Send className="size-3.5" />Send to agent</span>
            <span className="text-2xs leading-4 text-muted-foreground">gstack argues it first</span>
          </div>
          <ul className="flex flex-col gap-2 p-4">
            {p.critiques.map((c) => (
              <li key={c.seq} className="grid grid-cols-[4.5rem_1fr] items-start gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">{ROLE[c.role]}</span>
                <span className="min-w-0 leading-5"><span className={cn("mr-1.5 rounded px-1 font-mono text-2xs ring-1", STANCE[c.stance])}>{c.stance}</span>{c.reasonEn}</span>
              </li>
            ))}
          </ul>
          {p.decision && (
            <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border p-2.5 text-xs">
              {p.decision === "pass" ? <Globe className="mt-0.5 size-3.5 shrink-0 text-live" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
              <span className="leading-5"><span className="font-medium">{EN[verdictSeq[p.decision]]}</span>{p.decision === "pass" && <span className="block text-muted-foreground">{EN[21]}</span>}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
