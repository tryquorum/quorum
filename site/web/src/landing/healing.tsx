import { CHIP } from "@/workspace/tone"

// tone.ts LATE is red-400, tuned for the dark-only workspace; on the light landing it fails AA, so the landing uses
// red-700 in light and red-400 in dark (measured by docs/design/audit/a11y.cjs).
const LATE = "text-red-700 dark:text-red-400"

// The luma-blasts recipe (src/recipes/defs/luma-blasts.json): v1 called event/get-posts, which now 404s.
// The repair path below follows lane/recipes: detect, recall past repairs, re-explore in Aside, validate, save v2.
// One tone (DESIGN-READ hue budget): ink for what happened, muted for context, red only for the failure.
type Tone = "ink" | "muted" | "fail"
const TONE: Record<Tone, string> = { ink: "text-foreground", muted: "text-muted-foreground", fail: LATE }
const LINES: { tag: string; tone: Tone; text: string }[] = [
  { tag: "$", tone: "ink", text: "quorum recipe run luma-blasts" },
  { tag: "recipe.run", tone: "muted", text: "v1 · GET api2.luma.com/event/get-posts?event_api_id=…" },
  { tag: "recipe.broken", tone: "fail", text: "404 · verify failed: expected a non-empty array with id" },
  { tag: "recall", tone: "muted", text: "gbrain · past repairs on api2.luma.com" },
  { tag: "aside", tone: "muted", text: "re-explore in the signed-in tab · watching network on luma.com/<event>" },
  { tag: "candidate", tone: "ink", text: "GET api2.luma.com/event/get-blasts?event_api_id=…  200" },
  { tag: "verify", tone: "ink", text: "7 announcements · schema ok · non-empty" },
  { tag: "recipe.repaired", tone: "ink", text: "luma-blasts v2 saved · prev endpoint and reason kept" },
  { tag: "memory.saved", tone: "muted", text: "gbrain remembers why v1 broke" },
]

export function Healing() {
  return (
    <div className="lp-ring overflow-hidden rounded-2xl bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 font-mono text-xs text-muted-foreground">
        <span>recipe · luma-blasts</span>
        <span className={"ml-auto rounded-full px-2 py-0.5 text-2xs " + CHIP}>v2 verified</span>
      </div>
      <ol className="space-y-1.5 p-4 font-mono text-[12.5px] leading-relaxed sm:p-5">
        {LINES.map((l, i) => (
          <li key={i} className="grid grid-cols-[7.5rem_1fr] gap-3 max-sm:grid-cols-1 max-sm:gap-0">
            <span className="text-muted-foreground">{l.tag}</span>
            <span className={"break-words " + TONE[l.tone]}>{l.text}</span>
          </li>
        ))}
      </ol>
      <div className="border-t px-4 py-3 font-mono text-[12.5px] sm:px-5">
        <p className={"rounded-md border border-red-700/50 dark:border-red-500/45 px-3 py-1 " + LATE}>- GET /event/get-posts   404</p>
        <p className="mt-1 rounded-md border border-border px-3 py-1 text-foreground">+ GET /event/get-blasts  200 · 7 posts</p>
      </div>
    </div>
  )
}
