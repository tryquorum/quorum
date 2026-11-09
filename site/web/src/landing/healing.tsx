import { useEffect, useState } from "react"
import { useInView, useReducedMotion } from "@/components/reveal"
import { cn } from "@/lib/utils"

// The luma-blasts recipe (src/recipes/defs/luma-blasts.json): v1 called event/get-posts, which now 404s.
// The repair path below follows lane/recipes: detect, recall past repairs, re-explore in Aside, validate, save v2.
const LINES: { tag: string; tone: string; text: string; ms: number }[] = [
  { tag: "$", tone: "text-muted-foreground", text: "quorum recipe run luma-blasts", ms: 500 },
  { tag: "recipe.run", tone: "text-muted-foreground", text: "v1 · GET api2.luma.com/event/get-posts?event_api_id=…", ms: 900 },
  { tag: "recipe.broken", tone: "text-cut", text: "404 · verify failed: expected a non-empty array with id", ms: 1100 },
  { tag: "recall", tone: "text-memory", text: "gbrain · past repairs on api2.luma.com", ms: 1000 },
  { tag: "aside", tone: "text-live", text: "re-explore in the signed-in tab · watching network on luma.com/<event>", ms: 1500 },
  { tag: "candidate", tone: "text-foreground", text: "GET api2.luma.com/event/get-blasts?event_api_id=…  200", ms: 1000 },
  { tag: "verify", tone: "text-keep", text: "7 announcements · schema ok · non-empty ✓", ms: 900 },
  { tag: "recipe.repaired", tone: "text-keep", text: "luma-blasts v2 saved · prev endpoint and reason kept", ms: 900 },
  { tag: "memory.saved", tone: "text-memory", text: "gbrain remembers why v1 broke", ms: 900 },
]

export function Healing() {
  const reduced = useReducedMotion()
  const { ref, seen } = useInView<HTMLDivElement>(0.35)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!seen) return
    if (reduced) { setN(LINES.length); return }
    let i = 0
    let t: number
    const tick = () => { i++; setN(i); if (i < LINES.length) t = window.setTimeout(tick, LINES[i].ms) }
    t = window.setTimeout(tick, 300)
    return () => window.clearTimeout(t)
  }, [seen, reduced])
  const done = n >= LINES.length
  return (
    <div ref={ref} className="dark lp-float overflow-hidden rounded-[20px] border bg-[#050506] text-foreground">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 font-mono text-xs text-muted-foreground">
        <span className="size-2.5 rounded-full bg-foreground/15" /><span className="size-2.5 rounded-full bg-foreground/15" /><span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="ml-2">recipe · luma-blasts</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-2xs", done ? "bg-keep/15 text-keep" : n >= 3 ? "bg-cut/15 text-cut" : "bg-muted")}>{done ? "v2 verified" : n >= 3 ? "repairing" : "v1"}</span>
      </div>
      <ol className="min-h-[19rem] space-y-1.5 p-4 font-mono text-[12.5px] leading-relaxed sm:p-5">
        {LINES.slice(0, n).map((l, i) => (
          <li key={i} className="type-in grid grid-cols-[7.5rem_1fr] gap-3 max-sm:grid-cols-1 max-sm:gap-0">
            <span className={cn(l.tone, l.tag === "$" && "text-signal")}>{l.tag}</span>
            <span className={cn("break-words", l.tag === "$" ? "text-foreground" : l.tone)}>{l.text}</span>
          </li>
        ))}
        {!done && <li className="caret text-muted-foreground" aria-hidden />}
      </ol>
      <div className="border-t px-4 py-3 font-mono text-[12.5px] sm:px-5">
        <p className="rounded-md bg-cut/10 px-3 py-1 text-cut">- GET /event/get-posts   404</p>
        <p className={cn("mt-1 rounded-md px-3 py-1 transition-colors duration-500", done ? "bg-keep/10 text-keep" : "text-muted-foreground/40")}>+ GET /event/get-blasts  200 · 7 posts</p>
      </div>
    </div>
  )
}
