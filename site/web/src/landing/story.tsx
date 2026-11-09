import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "@/components/reveal"
import { cn } from "@/lib/utils"
import { BAYER, BOAT, PALETTES, SCALE, hash, hex, type RGB } from "./pixel-sea"

// "사공이 많으면 배가 산으로 간다": too many boatmen steer the ship up a mountain. A sticky, scroll-scrubbed pixel
// scene in the hero's style (same 4x4 Bayer dither and palettes). Progress 0..1 comes from the section scroll,
// so it rewinds too: 0-0.4 boats multiply and scatter, a few climb the mountain; 0.4-0.66 they gather, the four
// gstack roles flash and some are cut; 0.66-1 the survivors line up and sail one way along the moon path.
const SMALL = ["...1....", "...11...", "...111..", "...1111.", "...1....", "11111111", ".111111."]
const TINY = ["..1...", "..11..", "..111.", "111111", ".1111."]
const SPRITES = [BOAT, SMALL, TINY]
const ROLES = ["CEO", "REV", "QA", "CSO"]
const ease = (x: number) => x * x * (3 - 2 * x)
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))

type Fleet = { n: number; boats: { spawn: number; sprite: string[]; angle: number; speed: number; climber: boolean; cut: boolean; bucket: number }[] }
function makeFleet(n: number): Fleet {
  const boats = Array.from({ length: n }, (_, i) => {
    const climber = i > 0 && i % 4 === 1
    const angle = climber ? Math.PI * (0.92 + hash(i + 5) * 0.06) : hash(i + 11) * Math.PI * 2
    return { spawn: i === 0 ? 0 : 0.02 + (i / n) * 0.3, sprite: SPRITES[i === 0 ? 0 : 1 + (i % 2)], angle, speed: 0.35 + hash(i + 23) * 0.5, climber, cut: i % 3 === 2 || (climber && i % 2 === 1), bucket: climber ? 99 : Math.floor((angle / (Math.PI * 2)) * 8) }
  })
  return { n, boats }
}

export const STORY_STEPS = [
  { title: "More agents, more directions", body: "Every agent you add proposes its own work. Some of it rows straight up the mountain: duplicates, yesterday's rejected idea, things nobody asked for." },
  { title: "They argue first", body: "Before anyone rows, gstack's CEO, Reviewer, QA and CSO question each proposal. What isn't needed, repeats something or could leak is cut." },
  { title: "One direction, remembered", body: "What survives runs in Aside or Codex. gbrain keeps the heading and Direction Board shows it, so the next request starts on course." },
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
      const d = img.data, t = time / 1000
      const p = reduced ? 1 : clamp(progress.current ?? 0)
      const horizon = Math.round(H * 0.42)
      const mx0 = 0, mx1 = Math.round(W * 0.3), peak = Math.round(horizon * 0.25), mPeakX = Math.round(W * 0.13)
      const mountainTop = (x: number) => x < mx0 || x > mx1 ? Infinity : x <= mPeakX ? peak + ((mPeakX - x) / (mPeakX - mx0 + 1)) * (horizon - peak) * 0.55 : peak + ((x - mPeakX) / (mx1 - mPeakX)) * (horizon - peak)
      const moonX = Math.round(W * 0.78), moonY = Math.round(horizon * 0.42), moonR = Math.max(5, Math.min(12, Math.round(H * 0.07)))
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, th = BAYER[(y & 3) * 4 + (x & 3)]
        let c: RGB
        const mt = mountainTop(x)
        if (y >= mt && y < horizon + 2) {
          // the mountain: same ramp, lit from the moon side
          const lit = x > mPeakX ? 0.75 : 0.35
          c = P.sea[Math.min(3, Math.max(0, Math.floor(((y - mt) / (horizon - peak)) * 2 + lit + th)))]
        } else if (y < horizon) {
          c = P.sky[Math.min(3, Math.floor((y / horizon) * 3 + th))]
        } else {
          const sy = (y - horizon) / (H - horizon)
          const wave = reduced ? 0 : Math.sin(x * 0.18 + y * 1.3 - t * 1.6) * 0.08
          c = P.sea[Math.min(3, Math.max(0, Math.floor((sy * 0.85 + 0.1 + wave) * 3 + th)))]
          const band = moonR * (0.3 + sy * 0.8), off = Math.sin(y * 0.9 + t * 2) * 1.5
          if (Math.abs(x - moonX - off) < band && th < 0.3 - sy * 0.2 && (y + Math.floor(t * 3)) % 3 !== 0) c = P.glint
        }
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
      }
      const put = (x: number, y: number, c: RGB) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2] }
      for (let y = -moonR; y <= moonR; y++) for (let x = -moonR; x <= moonR; x++) if (x * x + y * y <= moonR * moonR) put(moonX + x, moonY + y, x * x + y * y > (moonR - 1.2) ** 2 && x + y < 0 ? P.rim : P.moon)

      // fleet
      const seaTop = horizon + 4, seaBot = H - 6
      const gx = W * 0.6, gy = horizon + (H - horizon) * 0.42
      const survivors = fleet.boats.filter((b) => !b.cut)
      let visibleN = 0
      const buckets = new Set<number>()
      fleet.boats.forEach((b, i) => {
        if (p < b.spawn) return
        // phase A position at progress q (scatter or climb)
        const scatterAt = (q: number) => {
          const age = clamp((q - b.spawn) / 0.4)
          let x = W * 0.55 + Math.cos(b.angle) * b.speed * age * W * 0.6
          let y = gy + Math.sin(b.angle) * b.speed * age * (H - horizon) * 0.9
          if (b.climber) {
            x = W * 0.5 - Math.min(1, age * 1.7) * W * 0.44
            const top = mountainTop(x)
            y = Math.min(gy, top === Infinity ? gy : top)
          }
          return [x, clamp(y, b.climber ? 0 : seaTop, seaBot)]
        }
        let [x, y] = scatterAt(Math.min(p, 0.4))
        let alpha = 1
        if (p > 0.4) {
          const [ax, ay] = scatterAt(0.4)
          const k = ease(clamp((p - 0.4) / 0.16))
          const ox = (hash(i + 41) - 0.5) * W * 0.3, oy = (hash(i + 43) - 0.5) * (H - horizon) * 0.4
          x = ax + (gx + ox - ax) * k; y = ay + (gy + oy - ay) * k
          if (b.cut) alpha = 1 - clamp((p - 0.54) / 0.1)
        }
        if (p > 0.66 && !b.cut) {
          const s = survivors.indexOf(b), m = survivors.length
          const k = ease(clamp((p - 0.66) / 0.12))
          const row = s % 2, col = Math.floor(s / 2)
          const fx = gx - W * 0.3 + col * Math.max(10, W * 0.07) + row * 6 + (p - 0.66) * W * 0.4, fy = gy - 4 + row * 8
          const ox = (hash(i + 41) - 0.5) * W * 0.3, oy = (hash(i + 43) - 0.5) * (H - horizon) * 0.4
          x = gx + ox + (fx - gx - ox) * k; y = gy + oy + (fy - gy - oy) * k
          void m
        }
        if (alpha <= 0) return
        visibleN++
        if (p < 0.4) buckets.add(b.bucket)
        // pointer: nearby boats sidestep and their sails catch the light
        const dx = x - ptr.x, dy = y - ptr.y, dd = Math.hypot(dx, dy)
        const near = ptr.x >= 0 && dd < 14
        if (near && !reduced) { x += (dx / (dd || 1)) * (14 - dd) * 0.35 }
        const spr = b.sprite, sw = spr[0].length, sh = spr.length
        const bob = reduced ? 0 : Math.sin(t * 1.5 + i) * 0.6
        for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) {
          if (spr[yy][xx] !== "1") continue
          if (alpha < 1 && BAYER[((yy + Math.round(y)) & 3) * 4 + ((xx + Math.round(x)) & 3)] > alpha) continue
          const sail = yy < sh - 2
          put(x - sw / 2 + xx, y - sh + yy + bob, near && sail ? P.glint : P.boat)
        }
      })
      ctx.putImageData(img, 0, 0)
      const step = stepOf(p)
      if (label.current) label.current.textContent = step === 0 ? "agents: " + visibleN + " · directions: " + buckets.size : step === 1 ? "agents: " + visibleN + " · arguing" : "agents: " + survivors.length + " · direction: 1"
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
    <section ref={section} id="story" aria-labelledby="story-title" className={cn("relative", reduced ? "" : "h-[190svh] lg:h-[250svh]")}>
      <div className={cn("lp-container", !reduced && "sticky top-0 flex h-svh flex-col justify-center pt-20 pb-6")}>
        <div className="grid items-center gap-6 lg:grid-cols-[5fr_7fr] lg:gap-14">
          <div>
            <p className="lp-eyebrow normal-case tracking-normal">Too many boatmen steer the ship up a mountain. <span lang="ko" className="text-muted-foreground/80">사공이 많으면 배가 산으로 간다</span></p>
            <h2 id="story-title" className="lp-h2">More agents, one direction.</h2>
            <p className="mt-4 text-muted-foreground max-lg:hidden">
              Add agents and each one rows its own way: more tasks, yesterday's rejected idea back again, work nobody asked for.
              Quorum makes them agree on a heading before anyone rows, and keeps that heading on your board.
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
            <span ref={label} aria-hidden className="absolute top-3 left-3 rounded-full bg-background/85 px-2.5 py-1 font-mono text-2xs text-foreground backdrop-blur" />
            <div aria-hidden className="pointer-events-none absolute top-[24%] left-[60%] flex -translate-x-1/2 gap-1.5">
              {ROLES.map((r, k) => (
                <span key={r} ref={(el) => { chips.current[k] = el }} className="rounded-[3px] bg-foreground px-1.5 py-0.5 font-mono text-[10px] leading-none text-background opacity-0 transition-opacity duration-150" style={{ imageRendering: "pixelated" }}>{r}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
