import { useEffect, useRef } from "react"

// A night sea drawn in code, 8/16-bit style: a low-resolution canvas (one art pixel = SCALE css px) scaled up with
// image-rendering: pixelated. Sky and sea are 4-color ramps mixed with 4x4 Bayer ordered dithering, so the gradient
// is made of tiny checkered dots. The moon, its reflection, a few stars and a sailboat sit on top.
// Pointer: moon, stars and boat move at different depths (max ~10 css px) and a "flashlight" lifts the dither near
// the cursor. Scroll (hero only): the boat sails along the horizon, the moon sinks and the sky darkens.
// Reduced motion draws one still frame. The loop stops while the hero is off screen.
export const SCALE = 4
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
export type RGB = [number, number, number]
export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
// Low-chroma ramps that sit on the site tokens: paper to ink in light mode, navy steps and moon cream in dark mode.
export const PALETTES = {
  light: { sky: ["#f3f3f4", "#efeff1", "#e8e8eb", "#dfe0e4"], sea: ["#c7c8cf", "#a9abb5", "#7d808c", "#4a4c57"], moon: "#fbfaf6", rim: "#2a2b31", shade: "#d9d6cc", star: "#9a9ca6", boat: "#1c1d22", glint: "#ffffff" },
  dark: { sky: ["#08080a", "#0b0d16", "#10142a", "#18203c"], sea: ["#141a33", "#0f1428", "#0b0e1d", "#07080f"], moon: "#f4ecd2", rim: "#f9f4e4", shade: "#b9b096", star: "#c9c6b8", boat: "#020204", glint: "#e9dfbd" },
} as const
// Sailboat, 13x11 art pixels: 1 = hull and sail.
export const BOAT = [
  "......1......",
  "......11.....",
  "......111....",
  "......1111...",
  "......11111..",
  "......111111.",
  ".....1111111.",
  "......1......",
  "1111111111111",
  ".11111111111.",
  "..111111111..",
]

export function hash(n: number) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s) }

export function PixelSea({ className, seaPx = 200 }: { className?: string; seaPx?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    const finePointer = matchMedia("(pointer: fine)").matches
    let W = 0, H = 0, img: ImageData | null = null
    let visible = true, raf = 0, last = 0
    const ptr = { x: 0.5, y: 0.3, on: false, sx: 0, sy: 0 }
    let scroll = 0
    const pal = () => {
      const p = document.documentElement.classList.contains("dark") ? PALETTES.dark : PALETTES.light
      return { sky: p.sky.map(hex), sea: p.sea.map(hex), moon: hex(p.moon), rim: hex(p.rim), shade: hex(p.shade), star: hex(p.star), boat: hex(p.boat), glint: hex(p.glint) }
    }
    let P = pal()

    const resize = () => {
      const r = canvas.getBoundingClientRect()
      W = Math.max(1, Math.ceil(r.width / SCALE)); H = Math.max(1, Math.ceil(r.height / SCALE))
      canvas.width = W; canvas.height = H
      img = ctx.createImageData(W, H)
    }

    const draw = (time: number) => {
      if (!img) return
      const d = img.data
      const t = time / 1000
      const horizon = Math.max(8, H - Math.round(seaPx / SCALE))
      // parallax in art pixels (css max ~ 10px)
      const px = ptr.on ? (ptr.sx - 0.5) : 0, py = ptr.on ? (ptr.sy - 0.5) : 0
      const moonR = W < 160 ? 6 : Math.max(6, Math.min(16, Math.round(H * 0.075)))
      const narrow = W < 160 // phones: a half-risen moon on the horizon keeps clear of the headline
      const moonX = Math.round(W * (narrow ? 0.8 : 0.74) + px * -2.5)
      const moonY = narrow ? horizon + Math.round(scroll * moonR * 2) : Math.round(horizon * 0.34 + scroll * horizon * 0.42 + py * -1.5)
      const flX = ptr.sx * W, flY = ptr.sy * H, flR = 22
      const dark = scroll * 0.55
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4
          const th = BAYER[(y & 3) * 4 + (x & 3)]
          let c: RGB
          let lift = 0
          if (ptr.on) { const dx = x - flX, dy = (y - flY) * 1.4, dd = Math.sqrt(dx * dx + dy * dy); if (dd < flR) lift = (1 - dd / flR) * 0.9 }
          if (y < horizon) {
            const g = y / horizon + dark
            const v = Math.min(3, Math.max(0, Math.floor(g * 3 + th - lift * 0.6)))
            c = P.sky[v]
          } else {
            const sy = (y - horizon) / (H - horizon)
            const wave = Math.sin(x * 0.18 + y * 1.3 - t * 1.6) * 0.09 + Math.sin(x * 0.05 - t * 0.7) * 0.05
            const v = Math.min(3, Math.max(0, Math.floor((sy * 0.85 + 0.1 + wave + dark * 0.4) * 3 + th - lift)))
            c = P.sea[v]
            // moon path on the water: broken dashes that wobble
            const band = moonR * (0.3 + sy * 0.75)
            const off = Math.sin(y * 0.9 + t * 2.2) * 1.5
            if (Math.abs(x - moonX - off) < band && th < 0.34 - sy * 0.22 + lift * 0.25 && ((y + Math.floor(t * 3)) % 3 !== 0)) c = P.glint
            else if (lift > 0.35 && th < lift * 0.18 && hash(x * 31 + y * 17 + Math.floor(t * 6)) > 0.7) c = P.glint
          }
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
        }
      }
      const put = (x: number, y: number, c: RGB) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2] }
      // stars: fixed positions, slow twinkle, farthest layer
      const n = Math.round(W * horizon / 900)
      for (let s = 0; s < n; s++) {
        const sx = Math.floor(hash(s + 1) * W + px * -1), sy = Math.floor(hash(s + 99) * horizon * 0.8)
        if (Math.abs(sx - moonX) < moonR + 3 && Math.abs(sy - moonY) < moonR + 3) continue
        if (reduced || Math.sin(t * (0.8 + hash(s + 7)) + s) > -0.4) put(sx, sy, P.star)
        if (hash(s + 3) > 0.85) { put(sx + 1, sy, P.star); put(sx - 1, sy, P.star); put(sx, sy + 1, P.star); put(sx, sy - 1, P.star) }
      }
      // moon: filled disc, dithered shade on the lower right, bright rim on the upper left
      if (moonY - moonR < horizon) {
        for (let y = -moonR; y <= moonR; y++) for (let x = -moonR; x <= moonR; x++) {
          const r2 = x * x + y * y
          if (r2 > moonR * moonR || moonY + y >= horizon) continue
          const edge = r2 > (moonR - 1.2) * (moonR - 1.2)
          const shadeAmt = (x + y) / (moonR * 2) + 0.15
          const th = BAYER[((moonY + y) & 3) * 4 + ((moonX + x) & 3)]
          put(moonX + x, moonY + y, edge && x + y < 0 ? P.rim : shadeAmt > th + 0.35 ? P.shade : P.moon)
        }
      }
      // boat on the horizon: sails right as the page scrolls, bobs, nearest layer
      const bw = BOAT[0].length, bh = BOAT.length
      const bx = Math.round(W * 0.12 + scroll * W * 0.5 + px * 3)
      const by = horizon - bh + 3 + Math.round(Math.sin(t * 1.4) * (reduced ? 0 : 0.6))
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (BOAT[y][x] === "1") put(bx + x, by + y, P.boat)
      ctx.putImageData(img, 0, 0)
    }

    const loop = (time: number) => {
      raf = 0
      if (!visible) return
      // ease the pointer, cap at ~30 fps
      ptr.sx += (ptr.x - ptr.sx) * 0.12; ptr.sy += (ptr.y - ptr.sy) * 0.12
      if (time - last > 33) { draw(time); last = time }
      raf = requestAnimationFrame(loop)
    }
    const start = () => { if (!raf && !reduced) raf = requestAnimationFrame(loop) }

    resize(); ptr.sx = ptr.x; ptr.sy = ptr.y; draw(0)
    const ro = new ResizeObserver(() => { resize(); draw(performance.now()) })
    ro.observe(canvas)
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start() })
    io.observe(canvas)
    const onMove = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); ptr.x = (e.clientX - r.left) / r.width; ptr.y = (e.clientY - r.top) / r.height; ptr.on = ptr.y > -0.1 && ptr.y < 1.1 }
    const onLeave = () => { ptr.on = false }
    const onScroll = () => { const r = canvas.getBoundingClientRect(); scroll = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height))); if (reduced) draw(0) }
    const mo = new MutationObserver(() => { P = pal(); draw(performance.now()) })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    if (finePointer && !reduced) { window.addEventListener("pointermove", onMove, { passive: true }); document.addEventListener("pointerleave", onLeave) }
    window.addEventListener("scroll", onScroll, { passive: true })
    start()
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); mo.disconnect()
      window.removeEventListener("pointermove", onMove); document.removeEventListener("pointerleave", onLeave); window.removeEventListener("scroll", onScroll)
    }
  }, [seaPx])
  return <canvas ref={ref} aria-hidden className={className} style={{ imageRendering: "pixelated", maskImage: "linear-gradient(to bottom, #000 78%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 78%, transparent)" }} />
}
