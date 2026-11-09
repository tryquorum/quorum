import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T | null>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect() } }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [seen, threshold])
  return { ref, seen }
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const q = matchMedia("(prefers-reduced-motion: reduce)")
    const on = () => setReduced(q.matches)
    q.addEventListener("change", on)
    return () => q.removeEventListener("change", on)
  }, [])
  return reduced
}

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({ children, className, delay = 0, as: Tag = "div" }: { children: React.ReactNode; className?: string; delay?: number; as?: "div" | "section" | "li" }) {
  const { ref, seen } = useInView<HTMLDivElement>(0.12)
  return (
    <Tag ref={ref as never} className={cn("reveal", seen && "reveal-in", className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  )
}
