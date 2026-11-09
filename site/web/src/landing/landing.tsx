import { ArrowRight, Brain, Globe, Gavel, History, ShieldAlert, Terminal, Users, Wrench, LayoutDashboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Brand, QuorumMark } from "@/components/wordmark"
import { cn } from "@/lib/utils"
import { HeroSession } from "./hero-session"

const REPO = "https://github.com/lidge-jun/quorum"

function Nav() {
  return (
    <header className="sticky top-3 z-40 mx-auto mt-3 w-[min(100%-1.5rem,64rem)]">
      <nav className="flex items-center gap-2 rounded-full border bg-background/70 py-2 pr-2 pl-5 backdrop-blur-xl">
        <Brand />
        <div className="ml-auto hidden items-center gap-1 text-sm text-muted-foreground md:flex">
          <a href="#how" className="rounded-full px-3 py-1.5 hover:text-foreground">How it works</a>
          <a href="#self-healing" className="rounded-full px-3 py-1.5 hover:text-foreground">Self-healing APIs</a>
          <a href="#built-on" className="rounded-full px-3 py-1.5 hover:text-foreground">Built on</a>
          <a href={REPO} className="rounded-full px-3 py-1.5 hover:text-foreground">GitHub</a>
        </div>
        <Button asChild size="lg" className="ml-auto rounded-full px-4 md:ml-2">
          <a href={`${import.meta.env.BASE_URL}app.html`}>Open the console</a>
        </Button>
      </nav>
    </header>
  )
}

function Hero() {
  return (
    <section className="relative px-5 pt-16 pb-20 sm:pt-24">
      <div className="dot-field pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
        <a href="#self-healing" className="mb-8 inline-flex items-center gap-2 rounded-full border bg-card/70 py-1 pr-3 pl-1 text-sm text-muted-foreground hover:text-foreground">
          <Badge className="rounded-full bg-signal text-background">New</Badge>
          Recipes that repair themselves when a site moves
          <ArrowRight className="size-3.5" />
        </a>
        <h1 className="display text-[clamp(2.75rem,8.5vw,6.5rem)] text-balance">
          An agent parliament that only does what you need.
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground sm:text-xl">
          Bots propose work, then argue it down as CEO, reviewer, QA and CSO. Only what survives runs: browser work
          through Aside, code through Codex. gbrain remembers every verdict, so the next similar request is decided at once.
        </p>
        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild className="h-12 rounded-full px-6 text-base">
            <a href={`${import.meta.env.BASE_URL}app.html?replay=1`}>Watch a recorded session <ArrowRight /></a>
          </Button>
          <Button asChild variant="secondary" className="h-12 rounded-full px-6 text-base">
            <a href={`${import.meta.env.BASE_URL}app.html`}>Convene the council</a>
          </Button>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">Built in a day at c0mpiled-17 Seoul · YC RFS Multiplayer AI + Self-Maintaining APIs</p>
      </div>
      <div className="mx-auto mt-16 max-w-5xl">
        <HeroSession />
      </div>
    </section>
  )
}

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto mb-12 max-w-3xl text-center">
      <p className="mb-3 font-mono text-xs tracking-widest text-signal uppercase">{eyebrow}</p>
      <h2 className="display text-[clamp(2rem,5vw,3.5rem)] text-balance">{title}</h2>
      {children && <p className="mt-5 text-lg leading-relaxed text-pretty text-muted-foreground">{children}</p>}
    </div>
  )
}

const PROBLEMS = [
  { icon: Users, title: "More agents, more noise", body: "Every agent you add proposes more tasks and pings you more often. Most of it is work nobody needs, and you are the one filtering it." },
  { icon: History, title: "They forget yesterday's no", body: "Agents decide the same question from scratch every time. The idea you rejected yesterday comes back this morning." },
  { icon: Wrench, title: "Unofficial APIs break quietly", body: "Automations against sites without an official API die the day a path changes. Nobody notices until the data is stale." },
]

function Problem() {
  return (
    <section className="px-5 py-24">
      <SectionHead eyebrow="The problem" title="Agents are cheap. Your attention is not." />
      <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
        {PROBLEMS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border bg-card/50 p-6">
            <Icon className="mb-5 size-5 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold tracking-tight">{title}</h3>
            <p className="leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const STEPS = [
  { n: "01", name: "Recall", icon: Brain, tone: "text-memory", body: "gbrain looks for a past verdict on something similar. A near match skips the debate and reuses the decision, with its reasons.", log: "recall  gbrain   gb:v-0412 · 0.93" },
  { n: "02", name: "Propose", icon: Users, tone: "text-foreground", body: "Two or three proposer bots each put candidate tasks on the floor, with the executor that would run them and why.", log: "proposal bot:scout read today's Luma posts" },
  { n: "03", name: "Argue", icon: Gavel, tone: "text-escalate", body: "gstack roles argue every candidate: CEO asks if it is needed, reviewer finds duplicates, QA checks it can work, CSO flags risk.", log: "critique bot:cso  escalate · sends mail" },
  { n: "04", name: "Act & Remember", icon: Terminal, tone: "text-keep", body: "Passed work runs in Aside or Codex. Risky work waits for your approval on Direction Board. gbrain stores the verdict and the result.", log: "execute aside    read 7 announcements" },
]

function How() {
  return (
    <section id="how" className="scroll-mt-24 px-5 py-24">
      <SectionHead eyebrow="How it works" title="Recall, propose, argue, then act.">
        Every request goes through the same four steps. You see the whole argument, and only the verdict needs your attention.
      </SectionHead>
      <ol className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ n, name, icon: Icon, tone, body, log }, i) => (
          <li key={n} className="relative flex flex-col rounded-2xl border bg-card/50 p-6">
            <div className="mb-6 flex items-center justify-between">
              <span className="num text-sm text-muted-foreground">{n}</span>
              <Icon className={cn("size-5", tone)} />
            </div>
            <h3 className="mb-2 text-xl font-semibold tracking-tight">{name}</h3>
            <p className="mb-6 flex-1 leading-relaxed text-muted-foreground">{body}</p>
            <code className="block truncate rounded-lg bg-background/80 px-3 py-2 font-mono text-[11px] text-muted-foreground">{log}</code>
            {i < STEPS.length - 1 && <ArrowRight className="absolute top-1/2 -right-3.5 hidden size-4 text-muted-foreground/50 lg:block" />}
          </li>
        ))}
      </ol>
    </section>
  )
}

const REPAIR = [
  { type: "recipe.run", actor: "recipe:luma-blasts", text: "v1 · GET /event/get-posts", tone: "text-muted-foreground" },
  { type: "recipe.broken", actor: "recipe:luma-blasts", text: "404 · endpoint removed", tone: "text-cut" },
  { type: "recipe.run", actor: "aside", text: "re-explore · watching network on the event page", tone: "text-live" },
  { type: "recipe.repaired", actor: "recipe:luma-blasts", text: "v2 · GET /event/get-blasts · 200", tone: "text-keep" },
  { type: "execute.result", actor: "aside", text: "7 announcements match the validation sample", tone: "text-foreground" },
  { type: "memory.saved", actor: "gbrain", text: "recipe v2 + why v1 broke", tone: "text-memory" },
]

function SelfHealing() {
  return (
    <section id="self-healing" className="scroll-mt-24 px-5 py-24">
      <SectionHead eyebrow="Self-maintaining APIs" title="When a site moves, the recipe follows.">
        A recipe is a site, an intent, an endpoint, a parse rule and a validation sample. When the endpoint 404s, the schema
        drifts or the result goes empty, Aside opens the real page, watches its network traffic and finds the new path.
      </SectionHead>
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="overflow-hidden rounded-2xl border bg-card/50">
          <div className="flex items-center gap-2 border-b px-4 py-2.5 font-mono text-xs text-muted-foreground">
            <Globe className="size-3.5" /> Today, reading Luma announcements for this hackathon
          </div>
          <div className="space-y-1 p-4 font-mono text-[12.5px]">
            <p className="rounded-md bg-cut/10 px-3 py-1.5 text-cut">- GET lu.ma/api/event/get-posts   404</p>
            <p className="rounded-md bg-keep/10 px-3 py-1.5 text-keep">+ GET lu.ma/api/event/get-blasts  200 · 7 posts</p>
          </div>
          <ol className="relative space-y-3 border-t p-5">
            {REPAIR.map((r, i) => (
              <li key={i} className="grid grid-cols-[1.25rem_1fr] gap-3">
                <span className={cn("mt-1.5 size-2 rounded-full bg-current", r.tone)} />
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{r.type} · {r.actor}</p>
                  <p className={cn("text-sm", r.tone)}>{r.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-4">
          {[
            { k: "Detect", v: "404, a schema mismatch, or an empty result that disagrees with the validation sample." },
            { k: "Re-explore", v: "Aside drives the logged-in browser, opens the page and records the requests it makes." },
            { k: "Validate", v: "A candidate path becomes v2 only if it passes the same validation sample. No sample, no repair." },
            { k: "Remember", v: "gbrain keeps every version with the reason the old one broke, so the next break starts from history." },
          ].map(({ k, v }) => (
            <div key={k} className="rounded-2xl border bg-card/50 p-5">
              <p className="mb-1 font-semibold">{k}</p>
              <p className="leading-relaxed text-muted-foreground">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const BUILT_ON = [
  { name: "Aside", role: "Runs browser work in your signed-in browser and re-explores broken recipes.", href: "https://aside.com", icon: Globe },
  { name: "gbrain", role: "Remembers verdicts, reasons and recipe versions, and recalls similar cases. MIT.", href: "https://github.com/garrytan/gbrain", icon: Brain },
  { name: "gstack", role: "The roles that argue: CEO, reviewer, QA and CSO. MIT.", href: "https://github.com/garrytan/gstack", icon: ShieldAlert },
  { name: "Direction Board", role: "Where people see results, approve held work and read why each call was made.", href: REPO, icon: LayoutDashboard },
]

function BuiltOn() {
  return (
    <section id="built-on" className="scroll-mt-24 px-5 py-24">
      <SectionHead eyebrow="Built on" title="Aside · gbrain · gstack · Direction Board">
        Quorum is the parliament in the middle. Code runs through Codex CLI; everything else is a tool you can already use.
      </SectionHead>
      <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {BUILT_ON.map(({ name, role, href, icon: Icon }) => (
          <a key={name} href={href} className="group rounded-2xl border bg-card/50 p-6 transition-colors hover:bg-card">
            <Icon className="mb-6 size-5 text-muted-foreground group-hover:text-foreground" />
            <p className="mb-2 text-lg font-semibold tracking-tight">{name}</p>
            <p className="leading-relaxed text-muted-foreground">{role}</p>
          </a>
        ))}
      </div>
    </section>
  )
}

function Cta() {
  return (
    <section className="px-5 pt-12 pb-28">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border bg-card/60 px-6 py-16 text-center">
        <div className="dot-field pointer-events-none absolute inset-0" />
        <QuorumMark className="relative mx-auto mb-6 size-12 text-foreground" />
        <h2 className="display relative text-[clamp(2rem,5vw,3.5rem)] text-balance">Bring a request. Leave with a verdict.</h2>
        <p className="relative mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
          Type what you need, watch the council argue it out, and see exactly what ran and why.
        </p>
        <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild className="h-12 rounded-full px-6 text-base"><a href={`${import.meta.env.BASE_URL}app.html`}>Open the console <ArrowRight /></a></Button>
          <Button asChild variant="secondary" className="h-12 rounded-full px-6 text-base"><a href={`${import.meta.env.BASE_URL}app.html?replay=1`}>Watch the demo run</a></Button>
        </div>
      </div>
    </section>
  )
}

export function Landing() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <Nav />
      <main>
        <Hero />
        <Problem />
        <How />
        <SelfHealing />
        <BuiltOn />
        <Cta />
      </main>
      <footer className="border-t px-5 py-10 text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center">
          <Brand />
          <p>c0mpiled-17 Seoul · 2026-11-09. Built on Aside, gbrain (MIT), gstack (MIT) and Direction Board.</p>
          <a href={REPO} className="sm:ml-auto hover:text-foreground">Source on GitHub</a>
        </div>
      </footer>
    </div>
  )
}
