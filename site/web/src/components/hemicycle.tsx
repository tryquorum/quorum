import { useMemo } from "react"
import { cn } from "@/lib/utils"
import type { Stance } from "@/lib/contract"

// Parliament seat chart. Seats are ordered left to right by angle, so a vote fills the chamber like a
// real hemicycle diagram: keep from the left, escalate in the middle, cut on the right.
export type Seat = { x: number; y: number; a: number }
export function layoutSeats(rows = 5, inner = 120, gap = 19, seat = 14.5): Seat[] {
  const seats: Seat[] = []
  for (let r = 0; r < rows; r++) {
    const radius = inner + r * gap
    const n = Math.max(3, Math.round((Math.PI * radius) / seat))
    for (let i = 0; i < n; i++) {
      const a = Math.PI - (i / (n - 1)) * Math.PI
      seats.push({ x: 250 + radius * Math.cos(a), y: 220 - radius * Math.sin(a), a })
    }
  }
  return seats.sort((p, q) => q.a - p.a)
}

const FILL: Record<Stance, string> = { keep: "text-keep", escalate: "text-escalate", cut: "text-cut" }

export type Tally = { keep: number; escalate: number; cut: number }

/** progress 0..1 lights seats in order; tally decides each lit seat's stance by share. */
export function Hemicycle({ tally, progress, memory = false, className, children }: {
  tally: Tally
  progress: number
  memory?: boolean
  className?: string
  children?: React.ReactNode
}) {
  const seats = useMemo(() => layoutSeats(), [])
  const total = Math.max(1, tally.keep + tally.escalate + tally.cut)
  const lit = Math.round(seats.length * Math.min(1, Math.max(0, progress)))
  const k = Math.round((tally.keep / total) * seats.length)
  const e = Math.round((tally.escalate / total) * seats.length)
  return (
    <svg viewBox="0 0 500 236" className={cn("w-full", className)} aria-hidden>
      {seats.map((s, i) => {
        const on = i < lit
        const stance: Stance = i < k ? "keep" : i < k + e ? "escalate" : "cut"
        return (
          <circle
            key={i}
            cx={s.x.toFixed(1)}
            cy={s.y.toFixed(1)}
            r={5.2}
            fill="currentColor"
            className={cn(
              "transition-colors duration-300",
              on ? cn(memory ? "text-memory" : FILL[stance], "seat-in") : "text-foreground/10"
            )}
            style={on ? { animationDelay: `${(i % 12) * 12}ms` } : undefined}
          />
        )
      })}
      {children}
    </svg>
  )
}
