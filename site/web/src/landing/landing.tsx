import { useEffect } from "react"
import { ArrowRight } from "lucide-react"
import { Brand } from "@/components/wordmark"
import { APP, STATIC, asset } from "@/lib/base"
import { SEOUL_STATS } from "@/lib/seoul"
import { WorkspacePreview } from "./workspace-preview"
import { Argument } from "./argument"
import { Healing } from "./healing"
import { Logo, type LogoKey } from "./logos"
import { PixelSea } from "./pixel-sea"
import { Story } from "./story"
import { BringAgents, Slips } from "./judgment"
import { CountUp, Rise, useScrollStep } from "./motion"
import { cn } from "@/lib/utils"
import "./landing.css"

// Layout, type scale, hairline sections and the hero capture that runs off the right edge follow
// trygoat.ai (goat/apps/marketing: Home.astro, site.css, DESIGN.md). Colors are Direction Board's tokens (index.css).
const REPO = "https://github.com/tryquorum/quorum"
/** Same domain on the Quorum server (/w sits behind Cloudflare Access); the GitHub Pages copy links to the live one. */
const WORKSPACE = STATIC ? "https://quorum.lidgeai.com/w" : asset("w")
/** The submission video slot. The recorded cut is temporary and will be replaced by the final edit. */
const DEMO = { src: asset("media/quorum-demo.mp4"), poster: asset("media/quorum-demo-poster.jpg"), seconds: 85 }

const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-base font-medium transition-colors"
const primary = btn + " bg-primary text-primary-foreground hover:bg-primary/90"
const quiet = btn + " lp-ring bg-card text-foreground hover:bg-muted"
const textLink = "lp-text-link inline-flex min-h-11 items-center gap-1.5 font-semibold text-foreground underline-offset-4 hover:underline"

function Header() {
  return (
    <header className="sticky top-3 z-40 px-3">
      <div className="lp-ring mx-auto flex min-h-14 max-w-[720px] items-center justify-between gap-4 rounded-full bg-card/85 py-1.5 pr-1.5 pl-5 backdrop-blur-md">
        <Brand />
        <nav aria-label="Main">
          <ul className="flex items-center gap-0.5">
            <li className="max-sm:hidden"><a className="lp-nav" href="#how">How it works</a></li>
            <li className="max-md:hidden"><a className="lp-nav" href="#record">The record</a></li>
            <li className="max-md:hidden"><a className="lp-nav" href="#recipes">Recipes</a></li>
            <li className="max-sm:hidden"><a className="lp-nav" href={REPO}>GitHub</a></li>
            <li><a className="lp-nav ml-1 rounded-full bg-primary px-4 text-primary-foreground hover:bg-primary/90" href={WORKSPACE}>Open workspace</a></li>
          </ul>
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative">
      <div className="relative">
      <PixelSea className="absolute inset-x-0 -top-24 h-[calc(100%+376px)] w-full" seaPx={252} />
      <div className="lp-container relative flex flex-col items-center pt-[clamp(48px,8vw,96px)] text-center">
        <a href="#record" className="lp-ring mb-7 inline-flex items-center gap-2 rounded-full bg-card py-1 pr-3.5 pl-1 text-sm transition-colors hover:bg-muted">
          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium whitespace-nowrap text-primary-foreground">Live run</span>
          <span>Recorded at c0mpiled-17 Seoul<span className="max-sm:hidden">, 11:31 KST</span></span> <ArrowRight className="size-3.5" />
        </a>
        <h1 id="hero-title" className="lp-h1">Your board, where agents argue before they act.</h1>
        <p className="lp-lede lp-onscene mx-auto mt-6 max-w-[60ch]">
          Write down what you need, the way you would on Direction Board, and send it to an agent. gstack's CEO, reviewer, QA and CSO
          argue it first, Aside or Codex runs only what survives, and gbrain remembers the call, so Quorum stands in for your judgment
          when you have more agents than you can watch.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <a className={primary} href={WORKSPACE}>Open your workspace <ArrowRight className="size-4" /></a>
          <a className={quiet} href="#demo">Watch the {DEMO.seconds}-second run</a>
        </div>
        <p className="lp-onscene mt-4 text-sm">Open source. Built in a day at c0mpiled-17 Seoul on Aside, gbrain, gstack and Direction Board.</p>
      </div>
      </div>
      <figure className="lp-container relative mt-[clamp(96px,11vw,150px)]">
        <div className="lp-capture">
          <WorkspacePreview />
        </div>
        <figcaption className="mt-4 text-center text-sm text-muted-foreground">
          The real workspace from /w, running in your browser on the recorded Seoul run. Read-only: open the Luma request and press
          Send to agent to replay the council.
        </figcaption>
      </figure>
    </section>
  )
}

function Demo() {
  return (
    <section id="demo" aria-labelledby="demo-title" className="lp-section">
      <div className="lp-container lp-split">
        <div>
          <p className="lp-eyebrow">The run</p>
          <h2 id="demo-title" className="lp-h2">One request, start to finish.</h2>
          <p className="mt-5 text-muted-foreground">
            A real run, unedited apart from cuts: the request goes in, the council argues, Aside reads the signed-in Luma tab, and a broken API recipe repairs itself.
          </p>
        </div>
        <figure className="m-0">
          <video className="lp-float aspect-video w-full rounded-2xl border border-[var(--lp-ring)] bg-card" controls muted playsInline preload="none" poster={DEMO.poster} src={DEMO.src}>
            <a href={DEMO.src}>Download the demo video</a>
          </video>
          <figcaption className="mt-3 text-sm text-muted-foreground">{DEMO.seconds} seconds, no sound. Recorded from the console at c0mpiled-17 Seoul.</figcaption>
        </figure>
      </div>
    </section>
  )
}

const FLOW: { title: string; body: string; tool?: LogoKey }[] = [
  { title: "Capture", body: "Write it down in one line, as on Direction Board. Tasks, goals and signals from your board land in the same list." },
  { title: "Click", body: "Open any item. Nothing runs until you choose to send it." },
  { title: "Summary", body: "The popup shows the note so far and what gbrain remembers: similar past verdicts and why they were made." },
  { title: "Send to agent", body: "One button hands the item to the council. A close enough past verdict is reused without a new debate." },
  { title: "gstack argues", body: "CEO asks if it is needed, Reviewer if it duplicates something, QA if it will work, CSO what could go wrong.", tool: "gstack" },
  { title: "Aside or Codex runs it", body: "Browser work runs in your signed-in Aside, code in Codex. Anything that reaches outside waits for you.", tool: "aside" },
  { title: "gbrain remembers", body: "The verdict and its reasons are saved, so the same question tomorrow is decided at once.", tool: "gbrain" },
]

function How() {
  const { listRef, active } = useScrollStep(FLOW.length)
  return (
    <section id="how" aria-labelledby="how-title" className="lp-section">
      <div className="lp-container lp-split">
        <div className="self-start lg:sticky lg:top-28">
          <p className="lp-eyebrow">How it works</p>
          <h2 id="how-title" className="lp-h2">From a line on your board to work that ran.</h2>
          <p className="mt-5 text-muted-foreground">
            Quorum keeps Direction Board's habit of seeing everything in one place, then puts a council between you and the agents.
            Every step is an event you can open in the console.
          </p>
          <div className="mt-8 flex items-center gap-3" aria-hidden>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-foreground transition-[width] duration-300" style={{ width: ((active + 1) / FLOW.length) * 100 + "%" }} /></div>
            <span className="num text-xs text-muted-foreground">{String(Math.max(0, active + 1)).padStart(2, "0")} / {String(FLOW.length).padStart(2, "0")}</span>
          </div>
        </div>
        <ol ref={listRef} className="lp-steps">
          {FLOW.map((s, i) => (
            <li key={s.title} className={cn("lp-step", i <= active && "is-on", i === active && "is-now")}>
              <h3 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">{s.title}{s.tool && <Logo name={s.tool} size="sm" />}</h3>
              <p className="mt-1.5 text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Record() {
  const secs = Math.round(SEOUL_STATS.durationMs / 1000)
  const facts: { v: number; k: string; f?: (n: number) => string }[] = [
    { v: SEOUL_STATS.proposals, k: "proposals" },
    { v: SEOUL_STATS.critiques, k: "critiques" },
    { v: SEOUL_STATS.pass, k: "passed" },
    { v: SEOUL_STATS.hold, k: "held for a person" },
    { v: SEOUL_STATS.reject, k: "rejected" },
    { v: secs, k: "end to end", f: (n) => Math.floor(n / 60) + "m " + (n % 60) + "s" },
  ]
  return (
    <section id="record" aria-labelledby="record-title" className="lp-section">
      <div className="lp-container">
        <div className="lp-split">
          <div>
            <p className="lp-eyebrow">The record</p>
          <h2 id="record-title" className="lp-h2">The record from Seoul.</h2>
            <p className="mt-5 text-muted-foreground">
              Asked to sort out the day's hackathon announcements, three bots put three tasks on the floor. These are the critics' words from that run,
              translated from the engine's Korean, and what the council decided.
            </p>
            {STATIC && <a className={textLink + " mt-3"} href={APP + "?demo=seoul"}>Replay it in the console</a>}
          </div>
          <dl className="grid grid-cols-2 gap-x-10 sm:grid-cols-3">
            {facts.map((f) => (
              <div key={f.k} className="border-t py-4">
                <dd className="num text-3xl font-semibold tracking-tight"><CountUp value={f.v} format={f.f} /></dd>
                <dt className="mt-1 text-sm text-muted-foreground">{f.k}</dt>
              </div>
            ))}
          </dl>
        </div>
        <Rise className="mt-12"><Argument /></Rise>
      </div>
    </section>
  )
}

const REPAIR = [
  { k: "Detect", v: "A 404, a schema mismatch or an empty result fails the recipe's check. Nothing breaks silently." },
  { k: "Re-explore", v: "Aside opens the real page in your signed-in browser and records the requests it makes." },
  { k: "Validate", v: "A candidate becomes the next version only if it passes the same check." },
  { k: "Remember", v: "gbrain keeps each version and why the old one broke." },
]

function Recipes() {
  return (
    <section id="recipes" aria-labelledby="recipes-title" className="lp-section">
      <div className="lp-container lp-split">
        <div>
          <p className="lp-eyebrow">Self-maintaining APIs</p>
          <h2 id="recipes-title" className="lp-h2">APIs that fix themselves.</h2>
          <p className="mt-5 text-muted-foreground">
            A recipe is a site, an intent, an endpoint, a parse rule and a check. When Luma retired event/get-posts, the recipe failed loudly,
            Aside found the new path in a signed-in tab, and only a version that passed the check was saved.
          </p>
          <dl className="mt-8 grid gap-x-10 sm:grid-cols-2">
            {REPAIR.map(({ k, v }) => (
              <div key={k} className="border-t pt-4 pb-5">
                <dt className="font-semibold">{k}</dt>
                <dd className="mt-1.5 text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <Healing />
      </div>
    </section>
  )
}

const BUILT_ON: { name: string; logo?: LogoKey; role: string; href: string }[] = [
  { name: "Direction Board", role: "The board Quorum grew from: one place for what you must do, what agents are doing and what waits on you.", href: REPO },
  { name: "gstack", logo: "gstack", role: "The roles that argue: CEO, reviewer, QA and CSO. MIT.", href: "https://github.com/garrytan/gstack" },
  { name: "gbrain", logo: "gbrain", role: "Remembers verdicts, reasons and recipe versions, and recalls similar cases. MIT.", href: "https://github.com/garrytan/gbrain" },
  { name: "Aside", logo: "aside", role: "Runs browser work in your signed-in browser and re-explores broken recipes.", href: "https://aside.com" },
  { name: "Codex CLI", logo: "codex", role: "Runs passed coding work in a sandbox folder per run.", href: "https://github.com/openai/codex" },
]

function BuiltOn() {
  return (
    <section id="built-on" aria-labelledby="built-title" className="lp-section">
      <div className="lp-container">
        <p className="lp-eyebrow">Built on</p>
          <h2 id="built-title" className="lp-h2">Built on real tools.</h2>
        <p className="mt-5 text-muted-foreground">Quorum is the council in the middle. Everything around it is a real tool, called over its own CLI or HTTP API.</p>
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {BUILT_ON.map((b) => (
            <li key={b.name} className="lp-ring rounded-2xl bg-card p-5 transition-shadow hover:shadow-lg">
              <a href={b.href} className="group block rounded-md">
                <span className="flex h-9 items-center">{b.logo ? <Logo name={b.logo} /> : <span className="text-lg font-semibold tracking-tight">Direction Board</span>}</span>
                <span className="mt-3 block text-sm text-muted-foreground group-hover:text-foreground">{b.role}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Cta() {
  return (
    <section aria-labelledby="cta-title" className="lp-section">
      <div className="lp-container flex flex-col items-center py-[clamp(24px,5vw,64px)] text-center">
        <h2 id="cta-title" className="lp-h1 max-w-[18ch] text-[clamp(2rem,1rem+2.4vw,3.25rem)]">Bring a request. Leave with a verdict.</h2>
        <p className="mx-auto mt-6 text-muted-foreground">Your workspace runs your own council after sign-in. The source, the recorded run and this page are public.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <a className={primary} href={WORKSPACE}>Open your workspace <ArrowRight className="size-4" /></a>
          <a className={quiet} href={REPO}>Source on GitHub</a>
        </div>
      </div>
    </section>
  )
}

/**
 * Short entrance for every block below the hero, layered on content that is already visible: a block gets lp-rise-in only
 * when its first pixel enters the viewport. Without script, before the observer runs, or in a full-page capture, every block
 * shows as is. Reduced motion adds nothing.
 */
function useSectionRise() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return
    const els = Array.from(document.querySelectorAll<HTMLElement>(".lp-section > .lp-container > *, .lp-section .lp-split > *"))
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("lp-rise-in"); io.unobserve(e.target) } }), { threshold: 0 })
    els.forEach((el) => { if (el.getBoundingClientRect().top > window.innerHeight) io.observe(el) })
    return () => io.disconnect()
  }, [])
}

export function Landing() {
  useSectionRise()
  return (
    <div className="lp min-h-dvh overflow-x-clip">
      <a href="#main" className="lp-skip">Skip to content</a>
      <Header />
      <main id="main">
        <Hero />
        <Story />
        <Slips />
        <Demo />
        <How />
        <BringAgents />
        <Record />
        <Recipes />
        <BuiltOn />
        <Cta />
      </main>
      <footer className="border-t">
        <div className="lp-container flex flex-wrap items-center justify-between gap-x-8 gap-y-2 pt-6 pb-10 text-sm text-muted-foreground">
          <span className="flex items-center gap-3"><Brand />c0mpiled-17 Seoul · 2026-11-09</span>
          <span>Built on Aside, gbrain (MIT), gstack (MIT) and Direction Board.</span>
          <a href={REPO} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">Source on GitHub</a>
        </div>
      </footer>
    </div>
  )
}
