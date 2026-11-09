import { Reveal } from "@/components/reveal"
import { SEOUL_STATS } from "@/lib/seoul"

// Every number is read from the recorded live run (site/web/public/fixtures/live-seoul.json).
const secs = Math.round(SEOUL_STATS.durationMs / 1000)
const ITEMS = [
  { v: String(SEOUL_STATS.proposals), k: "proposals", tone: "text-foreground" },
  { v: String(SEOUL_STATS.critiques), k: "critiques", tone: "text-escalate" },
  { v: String(SEOUL_STATS.pass), k: "passed", tone: "text-keep" },
  { v: String(SEOUL_STATS.hold), k: "held for a person", tone: "text-escalate" },
  { v: String(SEOUL_STATS.reject), k: "rejected", tone: "text-cut" },
  { v: `${Math.floor(secs / 60)}m ${secs % 60}s`, k: "end to end", tone: "text-live" },
  { v: "0", k: "things submitted or sent", tone: "text-signal" },
]

export function Numbers() {
  return (
    <Reveal className="border-y bg-card/30">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <p className="mb-5 text-center font-mono text-2xs tracking-widest text-muted-foreground uppercase">Today's live run · c0mpiled-17 Seoul · 11:31 KST</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-7">
          {ITEMS.map((it) => (
            <div key={it.k} className="text-center">
              <dd className={`display num whitespace-nowrap text-4xl sm:text-[2.75rem] ${it.tone}`}>{it.v}</dd>
              <dt className="mt-2 text-xs text-muted-foreground">{it.k}</dt>
            </div>
          ))}
        </dl>
      </div>
    </Reveal>
  )
}
