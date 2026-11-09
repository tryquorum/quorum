import type { SVGProps } from "react"
import { cn } from "@/lib/utils"

// Seat geometry for the Quorum mark: three arcs of seats around a rostrum, like a parliament chamber.
// Same pattern as board's AiMark (components/ai-mark.tsx): currentColor, sized with size-* classes.
const ROWS = [
  { r: 7, n: 5 },
  { r: 10.5, n: 7 },
  { r: 14, n: 9 },
]
const SEATS = ROWS.flatMap(({ r, n }) =>
  Array.from({ length: n }, (_, i) => {
    const a = Math.PI - (i / (n - 1)) * Math.PI
    return { x: 16 + r * Math.cos(a), y: 24 - r * Math.sin(a) }
  })
)

export function QuorumMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 28" fill="currentColor" aria-hidden className={cn("size-6 shrink-0", className)} {...props}>
      {SEATS.map((s, i) => (
        <circle key={i} cx={s.x.toFixed(2)} cy={s.y.toFixed(2)} r={1.35} opacity={i % 4 === 1 ? 0.45 : 1} />
      ))}
      <circle cx="16" cy="24" r="2.4" className="text-signal" fill="currentColor" />
    </svg>
  )
}

// Monoline lowercase "quorum", drawn as strokes so it renders the same without any font.
const LETTERS = [
  "M17 17a8 8 0 1 1-16 0a8 8 0 1 1 16 0M17 9v23", // q
  "M24 9v9a8 8 0 0 0 16 0V9M40 9v17", // u
  "M63 17a8 8 0 1 1-16 0a8 8 0 1 1 16 0", // o
  "M70 26V9M70 18a9 9 0 0 1 9-9h2", // r
  "M86 9v9a8 8 0 0 0 16 0V9M102 9v17", // u
  "M109 26V9M109 15a6 6 0 0 1 12 0v11M121 15a6 6 0 0 1 12 0v11", // m
]

export function Wordmark({ className, title = "Quorum", ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg viewBox="-2 6 172 28" role="img" aria-label={title} className={cn("h-6 w-auto", className)} {...props}>
      <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {LETTERS.map((d, i) => <path key={i} d={d} />)}
      </g>
      <circle cx="55" cy="17" r="2.6" className="text-signal" fill="currentColor" />
      <g transform="translate(138 4)" fill="currentColor">
        {SEATS.map((s, i) => <circle key={i} cx={s.x.toFixed(2)} cy={s.y.toFixed(2)} r={1.2} opacity={i % 4 === 1 ? 0.45 : 1} />)}
      </g>
    </svg>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <a href={import.meta.env.BASE_URL} className={cn("inline-flex items-center text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md", className)}>
      <Wordmark className="h-[22px]" />
    </a>
  )
}
