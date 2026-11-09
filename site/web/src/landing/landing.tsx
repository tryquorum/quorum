import { useEffect } from "react"
import { ArrowRight } from "lucide-react"
import { Brand } from "@/components/wordmark"
import { APP, STATIC, asset } from "@/lib/base"
import { SEOUL_RUN_ID, SEOUL_STATS } from "@/lib/seoul"
import { WorkspacePreview } from "./workspace-preview"
import { Argument } from "./argument"
import { Healing } from "./healing"
import { PixelSea } from "./pixel-sea"
import { Story } from "./story"
import { Judgment, RunsOn } from "./judgment"
import "./landing.css"

// Design system: docs/design/DESIGN-READ.md and CONCEPT.md (concept B "product as stage" + A's provenance labels).
// Three section grammars only: Stage (hero), Claim + artifact (every middle section, .lp-ca), Statement (closing).
// Colors are Direction Board tokens (index.css) and workspace tone.ts; spacing and type come from landing.css.
const REPO = "https://github.com/tryquorum/quorum"
/** Same domain on the Quorum server (/w sits behind Cloudflare Access); the GitHub Pages copy links to the live one. */
const WORKSPACE = STATIC ? "https://quorum.lidgeai.com/w" : asset("w")
/** The 84.6 s submission film (video/final, cut from captures of real runs). */
const DEMO = { src: asset("media/quorum-demo.mp4"), poster: asset("media/quorum-demo-poster.jpg"), seconds: 58 }

const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-base font-medium whitespace-nowrap transition-colors"
const primary = btn + " bg-primary text-primary-foreground hover:bg-primary/90"
const quiet = btn + " lp-ring bg-card text-foreground hover:bg-muted"

function Header() {
  return (
    <header className="sticky top-3 z-40 px-3">
      <div className="lp-ring mx-auto flex min-h-14 max-w-[680px] items-center justify-between gap-4 rounded-full bg-card/90 py-1.5 pr-1.5 pl-5 backdrop-blur-md">
        <Brand />
        <nav aria-label="Main">
          <ul className="flex items-center gap-0.5">
            <li className="max-md:hidden"><a className="lp-nav" href="#story">Why</a></li>
            <li className="max-md:hidden"><a className="lp-nav" href="#record">Proof</a></li>
            <li className="max-md:hidden"><a className="lp-nav" href="#agents">Agents</a></li>
            <li className="max-sm:hidden"><a className="lp-nav" href={REPO}>GitHub</a></li>
            <li><a className="lp-nav lp-ring ml-1 rounded-full px-4" href={WORKSPACE}>Open workspace</a></li>
          </ul>
        </nav>
      </div>
    </header>
  )
}

/** Stage grammar: a centered statement over the pixel sea, the real workspace full width below. */
function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative">
      <div className="relative">
        <PixelSea className="absolute inset-x-0 -top-24 h-[calc(100%+320px)] w-full" seaPx={220} />
        <div className="lp-container relative flex flex-col items-center pt-[clamp(56px,8vw,104px)] text-center">
          <h1 id="hero-title" className="lp-h1">Your board, where agents argue before they act.</h1>
          <p className="lp-lede lp-onscene mx-auto mt-6 max-w-[44ch]">
            Send a task to an agent. gstack's CEO, reviewer, QA and CSO argue it first, only what survives runs, and gbrain remembers your call.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a className={primary} href={WORKSPACE}>Open your workspace <ArrowRight className="size-4" /></a>
            <a className={quiet} href="#record">See the record</a>
          </div>
        </div>
      </div>
      <figure className="lp-container relative mt-[clamp(72px,8vw,112px)]">
        <div className="lp-capture">
          <WorkspacePreview />
        </div>
        <figcaption className="lp-label mx-auto mt-4 max-w-[70ch] text-center">
          The real /w workspace on the recorded c0mpiled-17 Seoul run. Read-only. Open the marked request, then press Send to agent.
        </figcaption>
      </figure>
    </section>
  )
}

/** Proof, claim + artifact: real numbers left, the critics' own words, the verdicts and the run video right. */
function Record() {
  const secs = Math.round(SEOUL_STATS.durationMs / 1000)
  const facts: { v: number; k: string; f?: (n: number) => string }[] = [
    { v: SEOUL_STATS.proposals, k: "proposals" },
    { v: SEOUL_STATS.critiques, k: "critiques" },
    { v: SEOUL_STATS.pass, k: "passed" },
    { v: SEOUL_STATS.hold, k: "held for you" },
    { v: SEOUL_STATS.reject, k: "rejected" },
    { v: secs, k: "end to end", f: (n) => Math.floor(n / 60) + "m " + (n % 60) + "s" },
  ]
  return (
    <section id="record" aria-labelledby="record-title" className="lp-section">
      <div className="lp-container lp-ca">
        <div className="lp-claim">
          <p className="lp-eyebrow">The record</p>
          <h2 id="record-title" className="lp-h2">The record from Seoul.</h2>
          <p className="mt-4 text-muted-foreground">
            Asked to sort out the day's hackathon announcements, three bots put three tasks on the floor. These are the critics' words, translated
            from the engine's Korean, and what the council decided.
          </p>
          <p className="lp-label mt-3">Recorded 9 Nov 2026, 11:31 KST · run {SEOUL_RUN_ID}</p>
          <dl className="mt-6 grid grid-cols-3 gap-x-6">
            {facts.map((f) => (
              <div key={f.k} className="border-t pt-3 pb-4">
                <dd className="num text-2xl font-semibold tracking-tight">{f.f ? f.f(f.v) : f.v}</dd>
                <dt className="mt-0.5 text-sm text-muted-foreground">{f.k}</dt>
              </div>
            ))}
          </dl>
          <figure className="m-0 mt-4">
            <video className="aspect-video w-full rounded-2xl border border-[var(--lp-ring)] bg-card" controls playsInline preload="none" poster={DEMO.poster} src={DEMO.src}>
              <a href={DEMO.src}>Download the demo video</a>
            </video>
            <figcaption className="mt-2 text-sm text-muted-foreground">The {DEMO.seconds}-second submission film, cut from captures of real runs.</figcaption>
          </figure>
          {STATIC && <a className="lp-text-link mt-2 inline-flex min-h-11 items-center gap-1.5 font-semibold underline-offset-4 hover:underline" href={APP + "?demo=seoul"}>Replay it in the console</a>}
        </div>
        <div className="lp-artifact">
          <Argument />
        </div>
      </div>
    </section>
  )
}

const REPAIR = [
  { k: "Detect", v: "A 404, a schema mismatch or an empty result fails the recipe's check." },
  { k: "Re-explore", v: "Aside opens the real page in your signed-in browser and records its requests." },
  { k: "Validate", v: "A candidate becomes the next version only if it passes the same check." },
  { k: "Remember", v: "gbrain keeps each version and why the old one broke." },
]

function Recipes() {
  return (
    <section id="recipes" aria-labelledby="recipes-title" className="lp-section">
      <div className="lp-container lp-ca">
        <div className="lp-claim">
          <h2 id="recipes-title" className="lp-h2">APIs that fix themselves.</h2>
          <p className="mt-4 text-muted-foreground">
            A recipe is a site, an intent, an endpoint, a parse rule and a check. When Luma retired event/get-posts, the recipe failed loudly and
            only a version that passed the check was saved.
          </p>
        </div>
        <div className="lp-artifact">
          <Healing />
          <dl className="mt-6 grid gap-x-8 sm:grid-cols-2">
            {REPAIR.map(({ k, v }) => (
              <div key={k} className="border-t pt-3 pb-4">
                <dt className="font-semibold">{k}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}

/** Statement grammar: the closing. */
function Cta() {
  return (
    <section aria-labelledby="cta-title" className="lp-section">
      <div className="lp-container flex flex-col items-center text-center">
        <h2 id="cta-title" className="lp-h1 max-w-[18ch]">Bring a request. Leave with a verdict.</h2>
        <p className="mx-auto mt-5 max-w-[52ch] text-muted-foreground">Your workspace runs your own council after sign-in. The source, the recorded run and this page are public.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
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
    const els = Array.from(document.querySelectorAll<HTMLElement>(".lp-section .lp-claim, .lp-section .lp-artifact, .lp-section > .lp-container:not(.lp-ca)"))
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
        <Record />
        <Judgment />
        <Recipes />
        <RunsOn />
        <Cta />
      </main>
      <footer className="border-t">
        <div className="lp-container flex flex-wrap items-center justify-between gap-x-8 gap-y-2 pt-6 pb-10 text-sm text-muted-foreground">
          <span className="flex items-center gap-3"><Brand />Built in a day at c0mpiled-17 Seoul, 9 Nov 2026</span>
          <span>Open source. Built on Aside, gbrain (MIT), gstack (MIT) and Direction Board.</span>
          <a href={REPO} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">Source on GitHub</a>
        </div>
      </footer>
    </div>
  )
}
