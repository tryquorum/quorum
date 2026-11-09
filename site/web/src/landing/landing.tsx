import { ArrowRight, Brain, Gavel, History, Terminal, Users, Wrench, LayoutDashboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Brand, QuorumMark } from "@/components/wordmark"
import { Reveal } from "@/components/reveal"
import { APP } from "@/lib/base"
import { cn } from "@/lib/utils"
import { HeroSession } from "./hero-session"
import { Numbers } from "./numbers"
import { Argument } from "./argument"
import { Healing } from "./healing"
import { Architecture } from "./architecture"
import { Logo, LogoStrip, type LogoKey } from "./logos"

const REPO = "https://github.com/tryquorum/quorum"
const WORKSPACE = "https://quorum.lidgeai.com"

function Nav() {
  return (
    <header className="sticky top-3 z-40 mx-auto mt-3 w-[min(100%-1.5rem,64rem)]">
      <nav className="flex items-center gap-2 rounded-full border bg-background/70 py-2 pr-2 pl-5 shadow-lg shadow-black/30 backdrop-blur-xl">
        <Brand />
        <div className="ml-auto hidden items-center gap-1 text-sm text-muted-foreground md:flex">
          <a href="#argument" className="rounded-full px-3 py-1.5 transition-colors hover:text-foreground">The argument</a>
          <a href="#how" className="rounded-full px-3 py-1.5 transition-colors hover:text-foreground">How it works</a>
          <a href="#self-healing" className="rounded-full px-3 py-1.5 transition-colors hover:text-foreground">Self-healing APIs</a>
          <a href={REPO} className="rounded-full px-3 py-1.5 transition-colors hover:text-foreground">GitHub</a>
        </div>
        <Button asChild size="lg" className="ml-auto rounded-full px-4 md:ml-2">
          <a href={APP}>Open the console</a>
        </Button>
      </nav>
    </header>
  )
}

function Hero() {
  return (
    <section className="relative px-5 pt-14 pb-16 sm:pt-20">
      <div className="glow-hero pointer-events-none absolute inset-0 -z-10" />
      <div className="dot-field pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
        <a href="#argument" className="mb-7 inline-flex items-center gap-2 rounded-full border bg-card/70 py-1 pr-3 pl-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-cut/15 px-2 py-0.5 font-mono text-2xs font-semibold tracking-wider text-cut uppercase"><span className="size-1.5 rounded-full bg-cut" />live</span>
          Watch today's real council run, recorded in Seoul
          <ArrowRight className="size-3.5" />
        </a>
        <h1 className="display text-[clamp(2.6rem,8.5vw,6.75rem)] text-balance">
          An agent parliament that only does what you need.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground sm:text-xl">
          Bots propose work. A CEO, reviewer, QA and CSO argue it down. Only what survives runs: browser work in
          Aside, code in Codex. gbrain remembers every verdict, so the next similar request is decided at once.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild className="h-12 rounded-full px-6 text-base shadow-[0_0_40px_-8px] shadow-signal/50">
            <a href={`${APP}?demo=seoul`}>Replay the Seoul run <ArrowRight /></a>
          </Button>
          <Button asChild variant="secondary" className="h-12 rounded-full px-6 text-base">
            <a href={WORKSPACE}>Open your workspace</a>
          </Button>
        </div>
      </div>
      <div className="mx-auto mt-14 max-w-6xl">
        <HeroSession />
      </div>
      <LogoStrip />
    </section>
  )
}

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <Reveal className="mx-auto mb-12 max-w-3xl text-center">
      <p className="mb-3 font-mono text-xs tracking-widest text-signal uppercase">{eyebrow}</p>
      <h2 className="display text-[clamp(2rem,5.5vw,3.75rem)] text-balance">{title}</h2>
      {children && <p className="mt-5 text-lg leading-relaxed text-pretty text-muted-foreground">{children}</p>}
    </Reveal>
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
        {PROBLEMS.map(({ icon: Icon, title, body }, i) => (
          <Reveal key={title} delay={i * 120} className="lift rounded-2xl border bg-card/50 p-6">
            <Icon className="mb-5 size-5 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold tracking-tight">{title}</h3>
            <p className="leading-relaxed text-muted-foreground">{body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

function ArgumentSection() {
  return (
    <section id="argument" className="scroll-mt-24 px-5 py-24">
      <SectionHead eyebrow="The argument · live, 11:31 KST" title="Four critics. Twelve objections. One thing ran.">
        Asked to sort out today's hackathon announcements, three bots put three tasks on the floor. Here is what the
        critics said, word for word, and what the council decided.
      </SectionHead>
      <Argument />
    </section>
  )
}

const STEPS = [
  { n: "01", name: "Recall", icon: Brain, tone: "text-memory", body: "gbrain looks for a past verdict on something similar. A close match skips the debate and reuses the decision with its reasons." },
  { n: "02", name: "Propose", icon: Users, tone: "text-foreground", body: "Two or three proposer bots put candidate tasks on the floor, each with the executor that would run it and why." },
  { n: "03", name: "Argue", icon: Gavel, tone: "text-escalate", body: "gstack roles argue every candidate: is it needed, is it a duplicate, will it work, what could go wrong." },
  { n: "04", name: "Act & remember", icon: Terminal, tone: "text-keep", body: "Passed work runs in Aside or Codex. Anything that reaches outside waits for you on Direction Board. gbrain keeps the verdict." },
]

function How() {
  return (
    <section id="how" className="scroll-mt-24 px-5 py-24">
      <SectionHead eyebrow="How it works" title="Recall, propose, argue, then act.">
        One request, one pass through the chamber. Every step is a contract event you can watch in the console.
      </SectionHead>
      <Reveal className="mx-auto max-w-6xl rounded-3xl border bg-card/40 p-4 sm:p-8">
        <Architecture />
      </Reveal>
      <ol className="mx-auto mt-6 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ n, name, icon: Icon, tone, body }, i) => (
          <Reveal as="li" key={n} delay={i * 100} className="lift flex flex-col rounded-2xl border bg-card/50 p-6">
            <div className="mb-5 flex items-center justify-between">
              <span className="num text-sm text-muted-foreground">{n}</span>
              <Icon className={cn("size-5", tone)} />
            </div>
            <h3 className="mb-2 text-xl font-semibold tracking-tight">{name}</h3>
            <p className="leading-relaxed text-muted-foreground">{body}</p>
          </Reveal>
        ))}
      </ol>
    </section>
  )
}

function SelfHealing() {
  return (
    <section id="self-healing" className="scroll-mt-24 px-5 py-24">
      <SectionHead eyebrow="Self-maintaining APIs" title="When a site moves, the recipe follows.">
        A recipe is a site, an intent, an endpoint, a parse rule and a check. When Luma retired event/get-posts, the recipe
        broke loudly, Aside found the new path in a signed-in tab, and only a version that passed the check was saved.
      </SectionHead>
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Reveal><Healing /></Reveal>
        <div className="flex flex-col gap-4">
          {[
            { k: "Detect", v: "A 404, a schema mismatch, or an empty result fails the recipe's check. Nothing breaks silently." },
            { k: "Re-explore", v: "Aside opens the real page in your signed-in browser and records the requests it makes." },
            { k: "Validate", v: "A candidate becomes v2 only if it passes the same check. No check, no repair." },
            { k: "Remember", v: "gbrain keeps each version and the reason the old one broke, so the next break starts from history." },
          ].map(({ k, v }, i) => (
            <Reveal key={k} delay={i * 110} className="lift rounded-2xl border bg-card/50 p-5">
              <p className="mb-1 font-semibold">{k}</p>
              <p className="leading-relaxed text-muted-foreground">{v}</p>
            </Reveal>
          ))}
        </div>
      </div>
      <Reveal className="mx-auto mt-6 max-w-6xl rounded-2xl border border-dashed px-5 py-4 text-sm text-muted-foreground">
        <span className="font-mono text-2xs tracking-widest text-escalate uppercase">From the live run · QA, seq 11</span>
        <p className="mt-1 text-foreground/90">“Read-only and every item cites a source. Announcements come from get-blasts.”</p>
      </Reveal>
    </section>
  )
}

const BUILT_ON: { name: string; logo?: LogoKey; role: string; href: string }[] = [
  { name: "Aside", logo: "aside", role: "Runs browser work in your signed-in browser and re-explores broken recipes.", href: "https://aside.com" },
  { name: "Codex CLI", logo: "codex", role: "Runs passed coding work in a sandbox folder per run.", href: "https://github.com/openai/codex" },
  { name: "gbrain", logo: "gbrain", role: "Remembers verdicts, reasons and recipe versions, and recalls similar cases. MIT.", href: "https://github.com/garrytan/gbrain" },
  { name: "gstack", logo: "gstack", role: "The roles that argue: CEO, reviewer, QA and CSO. MIT.", href: "https://github.com/garrytan/gstack" },
  { name: "Direction Board", role: "Where people see results, approve held work and read why each call was made.", href: REPO },
]

function BuiltOn() {
  return (
    <section id="built-on" className="scroll-mt-24 px-5 py-24">
      <SectionHead eyebrow="Built on" title="Five real tools around one parliament.">
        Quorum is the parliament in the middle. Every tool around it is real and called over its own CLI or HTTP API.
      </SectionHead>
      <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {BUILT_ON.map(({ name, logo, role, href }, i) => (
          <Reveal key={name} delay={i * 90}>
            <a href={href} className="lift group block h-full rounded-2xl border bg-card/50 p-6 hover:bg-card">
              <div className="mb-6 flex h-9 items-center">
                {logo ? <Logo name={logo} /> : <span className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight"><LayoutDashboard className="size-6 text-muted-foreground transition-colors group-hover:text-signal" />Direction Board</span>}
              </div>
              <p className="mb-2 text-sm font-medium text-muted-foreground">{name}</p>
              <p className="leading-relaxed text-muted-foreground">{role}</p>
            </a>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

function Cta() {
  return (
    <section className="px-5 pt-12 pb-28">
      <Reveal className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border bg-card/60 px-6 py-16 text-center">
        <div className="glow-hero pointer-events-none absolute inset-0" />
        <div className="dot-field pointer-events-none absolute inset-0" />
        <QuorumMark className="relative mx-auto mb-6 size-12 text-foreground" />
        <h2 className="display relative text-[clamp(2rem,5vw,3.5rem)] text-balance">Bring a request. Leave with a verdict.</h2>
        <p className="relative mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
          Type what you need, watch the council argue it out, and see exactly what ran and why.
        </p>
        <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild className="h-12 rounded-full px-6 text-base"><a href={WORKSPACE}>Open your workspace <ArrowRight /></a></Button>
          <Button asChild variant="secondary" className="h-12 rounded-full px-6 text-base"><a href={`${APP}?demo=seoul`}>Replay the Seoul run</a></Button>
        </div>
        <p className="relative mt-5 text-sm text-muted-foreground">The workspace runs your own council after sign-in. This page and the replay are a public demo.</p>
      </Reveal>
    </section>
  )
}

export function Landing() {
  return (
    <div className="grain min-h-dvh overflow-x-clip">
      <Nav />
      <main>
        <Hero />
        <Numbers />
        <ArgumentSection />
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
          <a href={REPO} className="transition-colors hover:text-foreground sm:ml-auto">Source on GitHub</a>
        </div>
      </footer>
    </div>
  )
}
