import { useEffect, useRef, useState } from "react"

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
