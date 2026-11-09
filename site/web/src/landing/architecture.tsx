import { useReducedMotion } from "@/components/reveal"

// Request → gbrain recall → proposer bots → gstack roles → verdict → Aside / Codex / Board → gbrain remember,
// with the reuse loop back into recall and the near-match shortcut that skips the debate.
const C = { fg: "#fafafa", muted: "#a1a1a1", line: "#ffffff2e", card: "#111113", memory: "#a684ff", escalate: "#fbbf24", signal: "#d9f99d", live: "#38bdf8", keep: "#34d399" }

function Node({ x, y, w, h, label, sub, color }: { x: number; y: number; w: number; h: number; label: string; sub: string; color: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} fill={C.card} stroke={color} strokeOpacity={0.55} />
      <rect x={x} y={y} width={w} height={h} rx={14} fill={color} fillOpacity={0.06} />
      <text x={x + w / 2} y={y + h / 2 - 3} textAnchor="middle" fontSize={15} fontWeight={600} fill={C.fg}>{label}</text>
      <text x={x + w / 2} y={y + h / 2 + 15} textAnchor="middle" fontSize={11} fill={C.muted} fontFamily="var(--font-mono)">{sub}</text>
    </g>
  )
}

function Roles({ x, y, w, h, cols }: { x: number; y: number; w: number; h: number; cols: number }) {
  const roles = ["CEO", "Reviewer", "QA", "CSO"]
  const rows = Math.ceil(roles.length / cols)
  const cw = (w - 24 - (cols - 1) * 8) / cols
  const ch = 26
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} fill={C.card} stroke={C.escalate} strokeOpacity={0.55} />
      <rect x={x} y={y} width={w} height={h} rx={14} fill={C.escalate} fillOpacity={0.05} />
      <text x={x + 14} y={y + 22} fontSize={13} fontWeight={600} fill={C.fg}>gstack roles argue</text>
      <text x={x + w - 14} y={y + 22} textAnchor="end" fontSize={11} fill={C.muted} fontFamily="var(--font-mono)">keep · cut · escalate</text>
      {roles.map((r, i) => {
        const cx = x + 12 + (i % cols) * (cw + 8)
        const cy = y + h - 12 - (rows - Math.floor(i / cols)) * (ch + 6) + 6
        return (
          <g key={r}>
            <rect x={cx} y={cy} width={cw} height={ch} rx={8} fill={C.escalate} fillOpacity={0.12} />
            <text x={cx + cw / 2} y={cy + 17} textAnchor="middle" fontSize={12} fill={C.escalate} fontFamily="var(--font-mono)">{r}</text>
          </g>
        )
      })}
    </g>
  )
}

const STYLE = `
@media (prefers-reduced-motion: no-preference) {
  .q-flow { animation: q-flow 1.1s linear infinite; }
  .q-flow-slow { animation: q-flow 2.2s linear infinite; }
}
@keyframes q-flow { to { stroke-dashoffset: -24 } }
`

function Edge({ d, color = C.line, dashed = false, slow = false }: { d: string; color?: string; dashed?: boolean; slow?: boolean }) {
  return <path d={d} fill="none" stroke={color} strokeWidth={dashed ? 1.6 : 2} strokeDasharray={dashed ? "4 8" : "6 6"} strokeLinecap="round" className={slow ? "q-flow-slow" : "q-flow"} />
}

function Dot({ path, color, dur, begin = "0s" }: { path: string; color: string; dur: string; begin?: string }) {
  return (
    <circle r={4.5} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" path={path} />
    </circle>
  )
}

function Wide({ motion }: { motion: boolean }) {
  return (
    <svg viewBox="0 0 1000 440" className="w-full" role="img" aria-label="Quorum architecture: request, gbrain recall, proposer bots, gstack roles, verdict, executors Aside, Codex and Direction Board, then gbrain remember, which feeds recall next time.">
      <style>{STYLE}</style>
      <Edge d="M180 82 H230" />
      <Edge d="M400 82 H450" />
      <Edge d="M620 82 H670" />
      <Edge d="M845 134 V260" color={C.signal} />
      <Edge d="M760 292 C 712 292, 708 236, 660 236" color={C.live} />
      <Edge d="M760 292 C 712 292, 708 306, 660 306" color={C.live} />
      <Edge d="M760 292 C 712 292, 708 376, 660 376" color={C.live} />
      <Edge d="M470 236 C 432 236, 438 312, 400 312" />
      <Edge d="M470 306 C 440 306, 430 312, 400 312" />
      <Edge d="M470 376 C 432 376, 438 312, 400 312" />
      <Edge d="M315 280 V114" color={C.memory} dashed slow />
      <Edge d="M392 114 C 440 186, 700 168, 800 260" color={C.memory} dashed slow />
      <text x={326} y={204} fontSize={11} fill={C.memory} fontFamily="var(--font-mono)">reused next time</text>
      <text x={560} y={190} textAnchor="middle" fontSize={11} fill={C.memory} fontFamily="var(--font-mono)">near match: skip the debate</text>
      {motion && <Dot path="M105 82 H845 V292" color={C.signal} dur="4.2s" />}
      {motion && <Dot path="M760 292 C 712 292, 708 236, 660 236 H470 C 432 236, 438 312, 400 312 H315 V82" color={C.memory} dur="4.2s" begin="2.1s" />}
      <Node x={30} y={50} w={150} h={64} label="Request" sub="you ask" color={C.fg} />
      <Node x={230} y={50} w={170} h={64} label="gbrain recall" sub="similar past verdicts" color={C.memory} />
      <Node x={450} y={50} w={170} h={64} label="Proposer bots" sub="aside exec · 2–3 bots" color={C.fg} />
      <Roles x={670} y={30} w={300} h={104} cols={4} />
      <Node x={760} y={260} w={170} h={64} label="Verdict" sub="pass · hold · reject" color={C.signal} />
      <Node x={470} y={210} w={190} h={52} label="Aside" sub="browser, signed in" color={C.live} />
      <Node x={470} y={280} w={190} h={52} label="Codex CLI" sub="code, sandboxed" color={C.live} />
      <Node x={470} y={350} w={190} h={52} label="Direction Board" sub="approval queue" color={C.keep} />
      <Node x={230} y={280} w={170} h={64} label="gbrain remember" sub="verdict + reasons" color={C.memory} />
    </svg>
  )
}

function Tall({ motion }: { motion: boolean }) {
  return (
    <svg viewBox="0 0 360 800" className="mx-auto w-full max-w-sm" role="img" aria-label="Quorum architecture, top to bottom.">
      <style>{STYLE}</style>
      <Edge d="M180 76 V100" />
      <Edge d="M180 156 V180" />
      <Edge d="M180 236 V260" />
      <Edge d="M180 372 V400" color={C.signal} />
      <Edge d="M180 456 C 180 476, 62 476, 62 496" color={C.live} />
      <Edge d="M180 456 V496" color={C.live} />
      <Edge d="M180 456 C 180 476, 298 476, 298 496" color={C.live} />
      <Edge d="M62 548 C 62 570, 180 566, 180 590" />
      <Edge d="M180 548 V590" />
      <Edge d="M298 548 C 298 570, 180 566, 180 590" />
      <Edge d="M70 618 H24 V128 H70" color={C.memory} dashed slow />
      <Edge d="M290 128 H340 V428 H290" color={C.memory} dashed slow />
      <text x={16} y={380} fontSize={10.5} fill={C.memory} fontFamily="var(--font-mono)" transform="rotate(-90 16 380)" textAnchor="middle">reused next time</text>
      <text x={352} y={278} fontSize={10.5} fill={C.memory} fontFamily="var(--font-mono)" transform="rotate(90 352 278)" textAnchor="middle">near match: skip</text>
      {motion && <Dot path="M180 48 V428 V476 V620" color={C.signal} dur="4.5s" />}
      <Node x={70} y={20} w={220} h={56} label="Request" sub="you ask" color={C.fg} />
      <Node x={70} y={100} w={220} h={56} label="gbrain recall" sub="similar past verdicts" color={C.memory} />
      <Node x={70} y={180} w={220} h={56} label="Proposer bots" sub="aside exec · 2–3 bots" color={C.fg} />
      <Roles x={40} y={260} w={280} h={112} cols={2} />
      <Node x={70} y={400} w={220} h={56} label="Verdict" sub="pass · hold · reject" color={C.signal} />
      <Node x={8} y={496} w={108} h={52} label="Aside" sub="browser" color={C.live} />
      <Node x={126} y={496} w={108} h={52} label="Codex" sub="code" color={C.live} />
      <Node x={244} y={496} w={108} h={52} label="Board" sub="approval" color={C.keep} />
      <Node x={70} y={590} w={220} h={56} label="gbrain remember" sub="verdict + reasons" color={C.memory} />
    </svg>
  )
}

export function Architecture() {
  const reduced = useReducedMotion()
  return (
    <>
      <div className="hidden sm:block"><Wide motion={!reduced} /></div>
      <div className="sm:hidden"><Tall motion={!reduced} /></div>
    </>
  )
}
