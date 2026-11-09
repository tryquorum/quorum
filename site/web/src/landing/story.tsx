import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "@/components/reveal"
import { cn } from "@/lib/utils"
import { BAYER, BOAT, PALETTES, SCALE, hash, hex, type RGB } from "./pixel-sea"

// "Too many cooks spoil the broth" / "사공이 많으면 배가 산으로 간다". A sticky, scroll-scrubbed pixel scene in the
// hero's style (same 4x4 Bayer dither and palettes). Progress 0..1 comes from the section scroll, so it rewinds.
// 0-0.4: boats multiply; each has a habit from the proverb: spinning in circles, running for the rocks, climbing
// the mountain, or drifting off. 0.4-0.66: they gather, the four gstack roles flash, the rock runners, climbers
// and some drifters are cut, the spinners get a heading. 0.66-1: the survivors line up and sail one way.
const SMALL = ["...1....", "...11...", "...111..", "...1111.", "...1....", "11111111", ".111111."]
const TINY = ["..1...", "..11..", "..111.", "111111", ".1111."]
const ROLES = ["CEO", "REV", "QA", "CSO"]
const ease = (x: number) => x * x * (3 - 2 * x)
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))

type Kind = "lead" | "spinner" | "rocks" | "climber" | "drift" | "driftcut"
// Who does what, by fleet size. Survivors are lead, spinners and drift.
const KINDS: Record<number, Kind[]> = {
  14: ["lead", "climber", "spinner", "rocks", "drift", "driftcut", "spinner", "drift", "rocks", "climber", "spinner", "driftcut", "drift", "driftcut"],
  8: ["lead", "climber", "spinner", "rocks", "drift", "rocks", "spinner", "driftcut"],
}
type Boat = { kind: Kind; spawn: number; sprite: string[]; angle: number; speed: number; rock: number; cutAt: number }
const cuts = (k: Kind) => k === "rocks" || k === "climber" || k === "driftcut"
function makeFleet(n: 14 | 8): Boat[] {
  let rock = 0
  return KINDS[n].map((kind, i) => ({
    kind,
    spawn: i === 0 ? 0 : 0.02 + (i / n) * 0.3,
    sprite: i === 0 ? BOAT : i % 2 ? SMALL : TINY,
    angle: hash(i + 11) * Math.PI * 2,
    speed: 0.35 + hash(i + 23) * 0.5,
    rock: kind === "rocks" ? rock++ : -1,
    // the council cuts the rock runners first, then the climbers, then the half-way compromises
    cutAt: kind === "rocks" ? 0.46 : kind === "climber" ? 0.51 : 0.56,
  }))
}

export const STORY_STEPS = [
  { title: "More agents, more directions", body: "Some spin in circles, busy and getting nowhere. Some row for the rocks: the email that shouldn't go out, a payment, a public post. Some meet halfway on a result nobody wanted." },
  { title: "They argue before anyone rows", body: "gstack's CEO, Reviewer, QA and CSO question each proposal. The run for the rocks is cut, the climb up the mountain is cut, and the boats going in circles get a heading." },
  { title: "One direction, remembered", body: "Only what survives runs, in Aside or Codex. gbrain remembers the call you made, and Direction Board shows where you are headed." },
]

export function stepOf(p: number) { return p < 0.4 ? 0 : p < 0.66 ? 1 : 2 }

export function StorySea({ progress, label, chips, className }: { progress: React.RefObject<number>; label: React.RefObject<HTMLSpanElement | null>; chips: React.RefObject<(HTMLSpanElement | null)[]>; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    let W = 0, H = 0, img: ImageData | null = null, raf = 0, last = 0, visible = true
    let fleet = makeFleet(14)
    const ptr = { x: -1, y: -1 }
    const pal = () => {
      const p = document.documentElement.classList.contains("dark") ? PALETTES.dark : PALETTES.light
      return { sky: p.sky.map(hex), sea: p.sea.map(hex), moon: hex(p.moon), rim: hex(p.rim), boat: hex(p.boat), glint: hex(p.glint), star: hex(p.star) }
    }
    let P = pal()
    const resize = () => {
      const r = canvas.getBoundingClientRect()
      W = Math.max(1, Math.ceil(r.width / SCALE)); H = Math.max(1, Math.ceil(r.height / SCALE))
      canvas.width = W; canvas.height = H; img = ctx.createImageData(W, H)
      fleet = makeFleet(W < 110 ? 8 : 14)
    }
    const draw = (time: number) => {
      if (!img) return
      const d = img.data, t = reduced ? 0 : time / 1000
      const p = reduced ? 1 : clamp(progress.current ?? 0)
      const horizon = Math.round(H * 0.42), seaH = H - horizon
      const mx0 = 0, mx1 = Math.round(W * 0.3), peak = Math.round(horizon * 0.25), mPeakX = Math.round(W * 0.13)
      const mountainTop = (x: number) => x < mx0 || x > mx1 ? Infinity : x <= mPeakX ? peak + ((mPeakX - x) / (mPeakX - mx0 + 1)) * (horizon - peak) * 0.55 : peak + ((x - mPeakX) / (mx1 - mPeakX)) * (horizon - peak)
      const moonX = Math.round(W * 0.78), moonY = Math.round(horizon * 0.42), moonR = Math.max(5, Math.min(12, Math.round(H * 0.07)))
      const rocks = [
        { x: Math.round(W * 0.36), y: Math.round(horizon + seaH * 0.4), r: W < 110 ? 4 : 5 },
        { x: Math.round(W * 0.22), y: Math.round(horizon + seaH * 0.62), r: 4 },
        { x: Math.round(W * 0.44), y: Math.round(horizon + seaH * 0.72), r: 3 },
      ]
      // sky, mountain, sea
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, th = BAYER[(y & 3) * 4 + (x & 3)]
        let c: RGB
        const mt = mountainTop(x)
        if (y >= mt && y < horizon + 2) {
          const lit = x > mPeakX ? 0.75 : 0.35
          c = P.sea[Math.min(3, Math.max(0, Math.floor(((y - mt) / (horizon - peak)) * 2 + lit + th)))]
        } else if (y < horizon) {
          c = P.sky[Math.min(3, Math.floor((y / horizon) * 3 + th))]
        } else {
          const sy = (y - horizon) / seaH
          const wave = Math.sin(x * 0.18 + y * 1.3 - t * 1.6) * 0.08
          c = P.sea[Math.min(3, Math.max(0, Math.floor((sy * 0.85 + 0.1 + wave) * 3 + th)))]
          const band = moonR * (0.3 + sy * 0.8), off = Math.sin(y * 0.9 + t * 2) * 1.5
          if (Math.abs(x - moonX - off) < band && th < 0.3 - sy * 0.2 && (y + Math.floor(t * 3)) % 3 !== 0) c = P.glint
        }
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
      }
      const put = (x: number, y: number, c: RGB) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2] }
      for (let y = -moonR; y <= moonR; y++) for (let x = -moonR; x <= moonR; x++) if (x * x + y * y <= moonR * moonR) put(moonX + x, moonY + y, x * x + y * y > (moonR - 1.2) ** 2 && x + y < 0 ? P.rim : P.moon)
      // rocks: dark dithered lumps with a lit top-left edge and a ring of broken foam
      const nRocks = W < 110 ? 2 : 3
      for (let k = 0; k < nRocks; k++) {
        const R = rocks[k]
        for (let y = -R.r - 2; y <= R.r + 1; y++) for (let x = -R.r * 2 - 2; x <= R.r * 2 + 2; x++) {
          const e = (x * x) / ((R.r * 1.6) ** 2) + (y * y) / (R.r ** 2) - hash(k * 97 + x * 13 + y * 7) * 0.25
          const th = BAYER[((R.y + y) & 3) * 4 + ((R.x + x) & 3)]
          if (e <= 1 && y <= 0.5) put(R.x + x, R.y + y, x + y < -R.r * 0.6 && th < 0.6 ? P.sea[2] : P.boat)
          else if (e > 1 && e < 1.9 && y >= -1 && th < 0.6 && Math.sin(t * 3 + x + k) > -0.4) put(R.x + x, R.y + y, P.glint)
        }
      }

      const seaTop = horizon + 4, seaBot = H - 6
      const gx = W * 0.6, gy = horizon + seaH * 0.42
      const survivors = fleet.filter((b) => !cuts(b.kind))
      let visibleN = 0, inCircles = 0, onRocks = 0, cutDone = 0
      // phase A position at progress q
      const habitAt = (b: Boat, i: number, q: number): [number, number] => {
        const age = clamp((q - b.spawn) / 0.4)
        if (b.kind === "spinner") {
          const cx = W * (0.5 + (hash(i + 61) - 0.3) * 0.35), cy = horizon + seaH * (0.25 + hash(i + 67) * 0.4)
          const rr = 4 + hash(i + 71) * 4, a = hash(i + 73) * 6.3 + q * 14 + t * 1.1
          return [cx + Math.cos(a) * rr * 1.6, cy + Math.sin(a) * rr]
        }
        if (b.kind === "rocks") {
          const R = rocks[Math.min(b.rock, nRocks - 1)], k = ease(Math.min(1, age * 2.6))
          const sx = W * 0.55, sy = gy
          return [sx + (R.x + R.r * 1.6 + 3 - sx) * k, sy + (R.y + 1 - sy) * k]
        }
        if (b.kind === "climber") {
          const x = W * 0.5 - Math.min(1, age * 1.7) * W * 0.44, top = mountainTop(x)
          return [x, Math.min(gy, top === Infinity ? gy : top)]
        }
        const x = W * 0.58 + Math.cos(b.angle) * b.speed * age * W * 0.5
        const y = gy + Math.sin(b.angle) * b.speed * age * seaH * 0.8
        return [x, clamp(y, seaTop, seaBot)]
      }
      fleet.forEach((b, i) => {
        if (p < b.spawn) return
        let [x, y] = habitAt(b, i, Math.min(p, 0.4))
        let alpha = 1
        const ox = (hash(i + 41) - 0.5) * W * 0.3, oy = (hash(i + 43) - 0.5) * seaH * 0.4
        if (p > 0.4) {
          const k = ease(clamp((p - 0.4) / 0.14))
          // rock runners and climbers stay where they went wrong while the council cuts them
          if (!(b.kind === "rocks" || b.kind === "climber")) { x = x + (gx + ox - x) * k; y = y + (gy + oy - y) * k }
          if (cuts(b.kind)) { alpha = 1 - clamp((p - b.cutAt) / 0.08); if (alpha < 0.5) cutDone++ }
        }
        if (p > 0.66 && !cuts(b.kind)) {
          const s = survivors.indexOf(b), k = ease(clamp((p - 0.66) / 0.12))
          const row = s % 2, col = Math.floor(s / 2)
          const fx = gx - W * 0.3 + col * Math.max(10, W * 0.07) + row * 6 + (p - 0.66) * W * 0.4, fy = gy - 4 + row * 8
          x = gx + ox + (fx - gx - ox) * k; y = gy + oy + (fy - gy - oy) * k
        }
        if (alpha <= 0) return
        visibleN++
        if (p < 0.4 && b.kind === "spinner") inCircles++
        const arrived = b.kind === "rocks" && ((Math.min(p, 0.4) - b.spawn) / 0.4) * 2.6 >= 0.95
        if (arrived && alpha >= 0.5) onRocks++
        // the circle a spinner keeps tracing
        if (b.kind === "spinner" && p < 0.5) {
          const fade = p < 0.4 ? 1 : 1 - (p - 0.4) / 0.1
          const cx = W * (0.5 + (hash(i + 61) - 0.3) * 0.35), cy = horizon + seaH * (0.25 + hash(i + 67) * 0.4), rr = 4 + hash(i + 71) * 4
          for (let a = 0; a < 6.28; a += 0.45) { const tx = cx + Math.cos(a) * rr * 1.6, ty = cy + Math.sin(a) * rr; if (BAYER[(Math.round(ty) & 3) * 4 + (Math.round(tx) & 3)] < 0.5 * fade) put(tx, ty, P.glint) }
        }
        // pointer: nearby boats sidestep and their sails catch the light
        const dx = x - ptr.x, dy = y - ptr.y, dd = Math.hypot(dx, dy)
        const near = ptr.x >= 0 && dd < 14
        if (near && !reduced) x += (dx / (dd || 1)) * (14 - dd) * 0.35
        const spr = b.sprite, sw = spr[0].length, sh = spr.length
        const bob = reduced ? 0 : Math.sin(t * 1.5 + i) * 0.6
        const tilt = arrived ? 1 : 0 // aground: the hull lists
        for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) {
          if (spr[yy][xx] !== "1") continue
          if (alpha < 1 && BAYER[((yy + Math.round(y)) & 3) * 4 + ((xx + Math.round(x)) & 3)] > alpha) continue
          const sail = yy < sh - 2
          put(x - sw / 2 + xx, y - sh + yy + bob + (tilt ? Math.floor(xx / 4) : 0), near && sail ? P.glint : P.boat)
        }
      })
      ctx.putImageData(img, 0, 0)
      const step = stepOf(p)
      if (label.current) label.current.textContent =
        step === 0 ? "agents: " + visibleN + " · in circles: " + inCircles + " · on the rocks: " + onRocks
        : step === 1 ? "agents: " + visibleN + " · arguing · cut: " + cutDone
        : "agents: " + survivors.length + " · direction: 1"
      chips.current?.forEach((el, k) => {
        if (!el) return
        const on = p > 0.42 && p < 0.68
        const blink = on && (reduced || Math.floor(t * 4 + k * 1.3) % 3 !== 0)
        el.style.opacity = on ? (blink ? "1" : "0.35") : "0"
      })
    }
    const loop = (time: number) => { raf = 0; if (!visible) return; if (time - last > 33) { draw(time); last = time } raf = requestAnimationFrame(loop) }
    resize(); draw(0)
    const ro = new ResizeObserver(() => { resize(); draw(performance.now()) }); ro.observe(canvas)
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf && !reduced) raf = requestAnimationFrame(loop) }); io.observe(canvas)
    const mo = new MutationObserver(() => { P = pal(); draw(performance.now()) }); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    const fine = matchMedia("(pointer: fine)").matches
    const onMove = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); ptr.x = (e.clientX - r.left) / SCALE; ptr.y = (e.clientY - r.top) / SCALE }
    if (fine && !reduced) canvas.addEventListener("pointermove", onMove)
    const onLeave = () => { ptr.x = -1; ptr.y = -1 }
    canvas.addEventListener("pointerleave", onLeave)
    if (!reduced) raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); mo.disconnect(); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerleave", onLeave) }
  }, [reduced, progress, label, chips])
  return <canvas ref={ref} aria-hidden className={cn("block h-full w-full", className)} style={{ imageRendering: "pixelated" }} />
}

/** The story section: a sticky stage scrubbed by scroll, with the same story as readable text beside it. */
export function Story() {
  const reduced = useReducedMotion()
  const section = useRef<HTMLElement | null>(null)
  const progress = useRef(0)
  const label = useRef<HTMLSpanElement | null>(null)
  const chips = useRef<(HTMLSpanElement | null)[]>([])
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (reduced) { progress.current = 1; setStep(2); return }
    let raf = 0
    const measure = () => {
      raf = 0
      const el = section.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const p = clamp(-r.top / Math.max(1, r.height - window.innerHeight))
      progress.current = p
      setStep(stepOf(p))
    }
    const on = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    window.addEventListener("scroll", on, { passive: true }); window.addEventListener("resize", on)
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", on); window.removeEventListener("resize", on) }
  }, [reduced])
  return (
    <section ref={section} id="story" aria-labelledby="story-title" className={cn("relative", reduced ? "lp-section" : "h-[200svh] lg:h-[260svh]")}>
      <div className={cn("lp-container", !reduced && "sticky top-0 flex h-svh flex-col justify-center pt-20 pb-6")}>
        <div className="grid items-center gap-6 lg:grid-cols-[5fr_7fr] lg:gap-14">
          <div>
            <p className="font-mono text-sm tracking-tight text-foreground">Too many cooks spoil the broth.</p>
            <p className="mt-1 text-xs text-muted-foreground">In Korea they say: too many boatmen steer the ship up a mountain. <span lang="ko" className="whitespace-nowrap">사공이 많으면 배가 산으로 간다</span></p>
            <h2 id="story-title" className="lp-h2 mt-4">More agents, one direction.</h2>
            <p className="mt-4 text-muted-foreground max-lg:hidden">
              Hand the same job to more agents with no way to agree, and you get what the proverb promises: a boat that spins in circles,
              runs onto the rocks, or ends up somewhere nobody meant to go.
            </p>
            <ol className="mt-5 flex flex-col gap-1 lg:mt-7">
              {STORY_STEPS.map((s, i) => (
                <li key={s.title} className={cn("border-l-2 py-1.5 pl-4 transition-[opacity,border-color] duration-300", reduced ? "border-foreground/30" : i === step ? "border-foreground opacity-100" : "border-transparent opacity-45", !reduced && i !== step && "max-lg:hidden")} aria-current={i === step ? "step" : undefined}>
                  <p className="font-semibold"><span className="num mr-2 text-xs text-muted-foreground">0{i + 1}</span>{s.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="relative h-[42svh] overflow-hidden rounded-2xl border border-[var(--lp-ring)] lg:h-[min(64svh,560px)]">
            <StorySea progress={progress} label={label} chips={chips} />
            <span ref={label} aria-hidden className="absolute top-3 left-3 max-w-[calc(100%-1.5rem)] rounded-full bg-background/85 px-2.5 py-1 font-mono text-2xs text-foreground backdrop-blur" />
            <div aria-hidden className="pointer-events-none absolute top-[24%] left-[60%] flex -translate-x-1/2 gap-1.5">
              {ROLES.map((r, k) => (
                <span key={r} ref={(el) => { chips.current[k] = el }} className="rounded-[3px] bg-foreground px-1.5 py-0.5 font-mono text-[10px] leading-none text-background opacity-0 transition-opacity duration-150">{r}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
