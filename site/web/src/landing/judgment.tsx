import { asset } from "@/lib/base"
import { cn } from "@/lib/utils"
import { BOAT } from "./pixel-sea"

// Two short sections after the story. Copy rules: the Seoul line is from the recorded run; the email and the lead are
// labelled as examples; the agent names are examples of tools people already run, reachable over Quorum's MCP
// endpoint, never presented as official integrations (src/engine/mcp.ts: quorum_runs, quorum_run, quorum_memory;
// quorum_propose only with QUORUM_MCP_PROPOSE=1). The hold rule is src/engine/rules.ts HOLD_RISKS (money, external, prod, legal).

const SLIPS = [
  { tag: "example", title: "The email that mattered", body: "A reply from a customer, buried in Gmail under a morning of agent notifications." },
  { tag: "example", title: "The lead nobody answered", body: "A sales inquiry goes cold because every agent assumed another one had it." },
  { tag: "from the Seoul run", title: "The deadline that was today", body: "Three bots proposed three tasks. The line that mattered was one: due today, demo video and repo." },
]

const STANDS_IN = [
  { title: "Argue first", body: "gstack's CEO, Reviewer, QA and CSO question every proposal before anything runs." },
  { title: "Act only on what survives", body: "Aside runs the browser work and Codex the code. A proposal that spends money, sends something out, touches production or signs anything is held for you by rule." },
  { title: "Remember your call", body: "gbrain keeps each verdict with its reasons, so the next similar request is decided the way you decided it." },
]

export function Slips() {
  return (
    <section id="judgment" aria-labelledby="slips-title" className="lp-section">
      <div className="lp-container">
        <p className="lp-eyebrow">Meanwhile</p>
        <h2 id="slips-title" className="lp-h2">What slips while they argue.</h2>
        <ul className="mt-10 grid gap-x-10 sm:grid-cols-3">
          {SLIPS.map((s) => (
            <li key={s.title} className="border-t pt-5 pb-6">
              <p className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">{s.tag}</p>
              <p className="mt-2 font-semibold">{s.title}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ul>
        <div className="lp-split mt-14 items-start lg:mt-20">
          <p className="text-[clamp(1.5rem,1rem+1.4vw,2.25rem)] leading-tight font-semibold tracking-[-0.03em] text-balance">
            You need something that stands in for your judgment.
          </p>
          <ol className="lp-steps">
            {STANDS_IN.map((s) => (
              <li key={s.title}>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

// Logos from site/web/public/logos/agents (sources and terms in logos/SOURCES.md), drawn as published: no recolor,
// crop, pixelation or skew. Each sits on a chip it reads on: cursor.svg is light grey, so it gets a dark chip.
const AGENTS: { name: string; logo: string; chip: "light" | "dark" }[] = [
  { name: "Codex", logo: "codex.svg", chip: "light" },
  { name: "Claude Code", logo: "claude.svg", chip: "light" },
  { name: "Cursor", logo: "cursor.svg", chip: "dark" },
  { name: "Grok Build", logo: "grok.svg", chip: "light" },
  { name: "Muse Code", logo: "muse.svg", chip: "light" },
  { name: "Pickle", logo: "pickle.svg", chip: "light" },
]
// The sailboat with three more pixels of mast, so a flag can fly from the top.
const MASTED = ["......1......", "......1......", "......1......", ...BOAT]

/** A pixel boat with the agent's logo on a small flag at the masthead. The flag sways a little; more on hover. */
function FlagBoat({ name, logo, chip }: (typeof AGENTS)[number]) {
  const w = MASTED[0].length, h = MASTED.length
  return (
    <span className="relative inline-block h-12 shrink-0" style={{ aspectRatio: w + " / " + h }}>
      <svg viewBox={"0 0 " + w + " " + h} className="size-full text-foreground/80" aria-hidden shapeRendering="crispEdges" fill="currentColor">
        {MASTED.flatMap((row, y) => row.split("").map((c, x) => (c === "1" ? <rect key={x + "-" + y} x={x} y={y} width="1" height="1" /> : null)))}
      </svg>
      {/* flag: hoisted at the masthead (column 7 of 13), swinging from its left edge */}
      <span className={cn("lp-flag absolute top-[-3px] grid size-[26px] place-items-center rounded-md shadow-sm ring-1", chip === "dark" ? "bg-zinc-900 ring-white/15" : "bg-white ring-black/10")} style={{ left: (7 / w) * 100 + "%" }}>
        <img src={asset("logos/agents/" + logo)} alt={name + " logo"} className="size-4 object-contain" draggable={false} />
      </span>
    </span>
  )
}

export function BringAgents() {
  return (
    <section id="agents" aria-labelledby="agents-title" className="lp-section">
      <div className="lp-container">
        <div className="lp-split items-end">
          <div>
            <p className="lp-eyebrow">Bring your agents</p>
            <h2 id="agents-title" className="lp-h2">Keep the boatmen you have. Give them one council.</h2>
          </div>
          <p className="text-muted-foreground">
            Quorum speaks MCP. Any agent that can call an MCP server can read runs, verdicts and what gbrain remembers,
            and once you turn proposals on it can put a request in front of the council instead of acting on its own.
          </p>
        </div>
        <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Examples of agents people already run">
          {AGENTS.map((a) => (
            <li key={a.name} className="group lp-ring flex flex-col items-start gap-3 rounded-2xl bg-card p-4 pt-5">
              <FlagBoat {...a} />
              <span className="text-sm font-medium">{a.name}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
          <pre className="lp-ring overflow-x-auto rounded-2xl bg-card p-4 font-mono text-xs leading-6 text-foreground"><code>{"POST /mcp            JSON-RPC, MCP tools/list · tools/call\n  quorum_runs        recent council runs\n  quorum_run         one run: proposals, critiques, verdicts, results\n  quorum_memory      search the verdicts gbrain remembers\n  quorum_propose     put a request in front of the council   (QUORUM_MCP_PROPOSE=1)"}</code></pre>
          <p className="max-w-[34ch] text-sm text-muted-foreground">
            Names and logos are examples of agents people already use, over MCP. They are not official integrations or endorsements. Proposing is off
            by default, and the council's hold rule applies to every request, wherever it came from.
          </p>
        </div>
      </div>
    </section>
  )
}
