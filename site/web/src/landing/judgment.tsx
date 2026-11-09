import { useMemo } from "react"
import { asset } from "@/lib/base"
import { cn } from "@/lib/utils"
import { Logo, type LogoKey } from "./logos"
import { useScrollStep } from "./motion"

// Two claim + artifact sections (docs/design/CONCEPT.md). Copy rules: the Seoul line is from the recorded run; the email
// and the lead are labelled as examples; agent names are examples of tools people already run, reachable over Quorum's
// MCP endpoint, never presented as official integrations (src/engine/mcp.ts: quorum_runs, quorum_run, quorum_memory;
// quorum_propose only with QUORUM_MCP_PROPOSE=1). The hold rule is src/engine/rules.ts HOLD_RISKS (money, external,
// prod, legal).

const SLIPS = [
  { tag: "Seoul run", text: "The line that mattered: due today, demo video and repo." },
  { tag: "example", text: "A customer's reply, buried in Gmail under agent notifications." },
  { tag: "example", text: "A sales lead gone cold because every agent assumed another had it." },
]

// The flow from a line on your board to work that ran. Steps 5-7 are the three ways Quorum stands in for you.
const FLOW: { title: string; body: string; tool?: LogoKey }[] = [
  { title: "Capture", body: "Write it down in one line, as on Direction Board. Board tasks, goals and signals land in the same list." },
  { title: "Open it", body: "The popup shows the note so far and what gbrain remembers about similar requests. Nothing runs yet." },
  { title: "Send to agent", body: "One button hands it to the council. A close enough past verdict is reused without a new debate." },
  { title: "Argue first", body: "CEO asks if it is needed, Reviewer if it repeats something, QA if it will work, CSO what could go wrong.", tool: "gstack" },
  { title: "Act only on what survives", body: "Aside runs browser work, Codex runs code. Anything that spends, sends out, touches production or signs is held for you.", tool: "aside" },
  { title: "Remember your call", body: "The verdict and its reasons are saved, so the next similar request is decided the way you decided it.", tool: "gbrain" },
]

export function Judgment() {
  const { listRef, active } = useScrollStep(FLOW.length)
  return (
    <section id="judgment" aria-labelledby="judgment-title" className="lp-section">
      <div className="lp-container lp-ca">
        <div className="lp-claim">
          <h2 id="judgment-title" className="lp-h2">Something that stands in for your judgment.</h2>
          <p className="mt-4 text-muted-foreground">While agents argue among themselves, the things only you would notice slip:</p>
          <ul className="mt-4 flex flex-col">
            {SLIPS.map((s) => (
              <li key={s.text} className="grid grid-cols-[6.5rem_1fr] gap-3 border-t py-2.5 text-sm">
                <span className="lp-label pt-0.5">{s.tag}</span>
                <span>{s.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <ol ref={listRef} className="lp-artifact lp-steps">
          {FLOW.map((s, i) => (
            <li key={s.title} className={cn("lp-step", i <= active && "is-on", i === active && "is-now")}>
              <h3 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">{s.title}{s.tool && <Logo name={s.tool} size="sm" />}</h3>
              <p className="mt-1 text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// Logos from site/web/public/logos/agents (sources and terms in logos/SOURCES.md), drawn as published: no recolor,
// crop, pixelation or skew. Names are the products the logos come from (grok.com, muse.ai). Each logo sits on a chip it
// reads on: cursor.svg is light grey, so it gets a dark chip.
// pad: the OpenAI file ships with wide built-in margins, so it renders larger to show the same mark size (no crop).
const AGENTS: { name: string; logo: string; chip: "light" | "dark"; pad?: boolean }[] = [
  { name: "Codex", logo: "codex.svg", chip: "light", pad: true },
  { name: "Claude Code", logo: "claude.svg", chip: "light" },
  { name: "Cursor", logo: "cursor.svg", chip: "dark" },
  { name: "Grok", logo: "grok.svg", chip: "light" },
  { name: "Muse", logo: "muse.svg", chip: "light" },
  { name: "Pickle", logo: "pickle.svg", chip: "light" },
]

// A sailboat sprite with a real mainsail and jib (the old one was a mast on a hull and read as a chair, audit GAP-6).
// Column 8 is the mast; the flag flies from its top, to the right, above the jib.
// Rows 0-8 are bare mast so the flag never covers a sail.
const SAILBOAT = [
  "........1........",
  "........1........",
  "........1........",
  "........1........",
  "........1........",
  "........1........",
  "........1........",
  "........1........",
  "........1........",
  ".......11........",
  "......111..1.....",
  ".....1111..11....",
  "....11111..111...",
  "...111111..1111..",
  "..1111111..11111.",
  "........1........",
  "11111111111111111",
  ".111111111111111.",
  "..1111111111111..",
]
const MAST = 8

/** A pixel sailboat flying the agent's logo from the masthead. The flag sways a little; more on hover. */
function FlagBoat({ name, logo, chip, pad }: (typeof AGENTS)[number]) {
  const w = SAILBOAT[0].length, h = SAILBOAT.length
  const rects = useMemo(() => SAILBOAT.flatMap((row, y) => row.split("").map((c, x) => (c === "1" ? <rect key={x + "-" + y} x={x} y={y} width="1" height="1" /> : null))), [])
  return (
    <span className="relative inline-block h-[84px] shrink-0" style={{ aspectRatio: w + " / " + h }}>
      <svg viewBox={"0 0 " + w + " " + h} className="size-full text-foreground/85" aria-hidden shapeRendering="crispEdges" fill="currentColor">{rects}</svg>
      <span className={cn("lp-flag absolute top-[-2px] grid size-10 place-items-center rounded-lg ring-1", chip === "dark" ? "bg-zinc-900 ring-white/20" : "bg-white ring-black/15")} style={{ left: ((MAST + 1) / w) * 100 + "%" }}>
        <img src={asset("logos/agents/" + logo)} alt={name + " logo"} className={pad ? "size-9 max-w-none object-contain" : "size-6 object-contain"} draggable={false} />
      </span>
    </span>
  )
}

const BUILT_ON: { name: string; logo?: LogoKey; role: string; href: string }[] = [
  { name: "Direction Board", role: "The board Quorum grew from.", href: "https://github.com/tryquorum/quorum" },
  { name: "gstack", logo: "gstack", role: "The roles that argue. MIT.", href: "https://github.com/garrytan/gstack" },
  { name: "gbrain", logo: "gbrain", role: "Remembers verdicts and recipe versions. MIT.", href: "https://github.com/garrytan/gbrain" },
  { name: "Aside", logo: "aside", role: "Runs browser work in your signed-in browser.", href: "https://aside.com" },
  { name: "Codex CLI", logo: "codex", role: "Runs passed coding work in a sandbox.", href: "https://github.com/openai/codex" },
]

export function RunsOn() {
  return (
    <section id="agents" aria-labelledby="agents-title" className="lp-section">
      <div className="lp-container lp-ca">
        <div className="lp-claim">
          <h2 id="agents-title" className="lp-h2">Keep the boatmen you have. Give them one council.</h2>
          <p className="mt-4 text-muted-foreground">
            Quorum speaks MCP. An agent that can call an MCP server can read runs, verdicts and what gbrain remembers, and once you turn proposals on,
            it puts requests in front of the council instead of acting alone.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            Names and logos are examples of agents people already use over MCP, not official integrations or endorsements. The hold rule applies to
            every request, wherever it came from.
          </p>
        </div>
        <div className="lp-artifact">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Examples of agents people already run">
            {AGENTS.map((a) => (
              <li key={a.name} className="group lp-ring flex items-end justify-between gap-3 rounded-2xl bg-card px-4 pt-5 pb-4">
                <span className="text-sm font-medium">{a.name}</span>
                <FlagBoat {...a} />
              </li>
            ))}
          </ul>
          <pre className="lp-ring mt-3 overflow-x-auto rounded-2xl bg-card p-4 font-mono text-xs leading-6 text-foreground"><code>{"POST /mcp            JSON-RPC, MCP tools/list · tools/call\n  quorum_runs        recent council runs\n  quorum_run         one run: proposals, critiques, verdicts, results\n  quorum_memory      search the verdicts gbrain remembers\n  quorum_propose     put a request in front of the council   (QUORUM_MCP_PROPOSE=1)"}</code></pre>
          <h3 className="lp-label mt-8">Built on</h3>
          <ul className="mt-2 flex flex-col">
            {BUILT_ON.map((b) => (
              <li key={b.name} className="border-t">
                <a href={b.href} className="group flex min-h-14 items-center gap-4 py-2">
                  <span className="flex h-9 w-40 shrink-0 items-center">{b.logo ? <Logo name={b.logo} /> : <span className="text-lg font-semibold tracking-tight">Direction Board</span>}</span>
                  <span className="text-sm text-muted-foreground group-hover:text-foreground group-hover:underline">{b.role}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
