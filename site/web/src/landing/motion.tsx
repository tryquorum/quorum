import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "@/components/reveal"
import { cn } from "@/lib/utils"

/** Calls back once, the moment the element's first pixel enters the viewport. Content is visible before that. */
export function useFirstSight<T extends Element>(onSight: (el: T) => void) {
  const ref = useRef<T | null>(null)
  const cb = useRef(onSight)
  cb.current = onSight
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    // already on screen at mount: leave it alone, it is being read
    if (el.getBoundingClientRect().top < window.innerHeight) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); cb.current(el) } }, { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}

/** Short entrance (0.35 s fade and 10 px rise) layered on visible content the first time it scrolls into view. */
export function Rise({ children, className, as: Tag = "div" }: { children: React.ReactNode; className?: string; as?: "div" | "li" | "section" }) {
  const reduced = useReducedMotion()
  const ref = useFirstSight<HTMLDivElement>((el) => { if (!reduced) el.classList.add("lp-rise-in") })
  return <Tag ref={ref as never} className={cn(className)}>{children}</Tag>
}

/** Shows the real value; replays a count-up once when it scrolls into view. Reduced motion never counts. */
export function CountUp({ value, format = String }: { value: number; format?: (n: number) => string }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(value)
  const raf = useRef(0)
  const ref = useFirstSight<HTMLSpanElement>(() => {
    if (reduced) return
    const t0 = performance.now(), dur = 700
    const tick = (now: number) => { const p = Math.min(1, (now - t0) / dur); setN(Math.round(value * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf.current = requestAnimationFrame(tick) }
    raf.current = requestAnimationFrame(tick)
  })
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  useEffect(() => { setN(value) }, [value])
  return <span ref={ref} className="tnum">{format(n)}</span>
}

/** Index of the last list item whose top has passed 60% of the viewport, for scroll-driven step lists. */
export function useScrollStep(count: number) {
  const listRef = useRef<HTMLOListElement | null>(null)
  const [active, setActive] = useState(-1)
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    let raf = 0
    const measure = () => {
      raf = 0
      const line = window.innerHeight * 0.6
      let a = -1
      Array.from(list.children).forEach((li, i) => { if (li.getBoundingClientRect().top < line) a = i })
      setActive(Math.min(a, count - 1))
    }
    const on = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    window.addEventListener("scroll", on, { passive: true }); window.addEventListener("resize", on)
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", on); window.removeEventListener("resize", on) }
  }, [count])
  return { listRef, active }
}
