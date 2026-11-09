// 첫 실행 연결 카드(/w). 이 서버가 쓸 수 있는 실행기와, 꺼진 것은 왜 꺼졌는지·어떻게 켜는지를 /api/health 의 details 그대로 보여 줘요.
// Aside 가 꺼져 있으면 닫아도 다시 보여요(의회가 돌 수 없어서). 나머지는 없어도 의회가 돌아서 회색으로만 보여요.
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Health, HealthDetail } from "./api"
import { ALERT, CHIP } from "./tone"

const ROWS: { key: "aside" | "gbrain" | "codex" | "board"; label: string; off: string }[] = [
  { key: "aside", label: "Aside", off: "required" },
  { key: "gbrain", label: "gbrain", off: "memory off" },
  { key: "codex", label: "Codex CLI", off: "no code tasks" },
  { key: "board", label: "Direction Board", off: "optional" },
]

function Row({ label, d, off, required }: { label: string; d: HealthDetail | undefined; off: string; required: boolean }) {
  const ok = !!d?.ok
  const text = ok ? (d?.email ? d.email + (d.account ? " · " + d.account : "") : "ready") : (d?.reason || d?.hint || "not reported")
  return (
    <li className="flex min-w-0 items-start gap-2.5 py-1.5">
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", ok ? "bg-emerald-400" : required ? "bg-red-400" : "bg-foreground/25")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs font-medium">{label}</span>
          {!ok && <span className={cn("rounded-full px-1.5 py-px font-mono text-2xs", required ? ALERT : CHIP)}>{off}</span>}
        </div>
        <p className={cn("text-2xs break-words", ok ? "text-muted-foreground" : required ? "text-red-400" : "text-muted-foreground")}>{text}</p>
      </div>
    </li>
  )
}

export function SetupCard({ health, error, onDismiss }: { health: Health | null; error: string | null; onDismiss: () => void }) {
  const asideOk = !!health?.executors?.aside
  return (
    <section aria-label="Connections" className="mx-2 mb-5 rounded-2xl border bg-card/50 p-4">
      <div className="mb-1 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Run it with your own Aside</h2>
          <p className="text-2xs text-muted-foreground">Quorum runs bot opinions and browser tasks in the Aside you are signed in to on this Mac.</p>
        </div>
        {asideOk && <button type="button" onClick={onDismiss} className="rounded-full p-1 text-muted-foreground hover:text-foreground max-md:size-11" aria-label="Hide connection card"><X className="size-4" /></button>}
      </div>
      {error ? <p role="alert" className={"mt-2 rounded-xl px-3 py-2 text-xs " + ALERT}>Can't read /api/health: {error}</p> : !health ? <p className="mt-2 text-xs text-muted-foreground">Checking connections…</p> : (
        <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
          {ROWS.map((r) => <Row key={r.key} label={r.label} d={health.details?.[r.key] ?? (health.executors?.[r.key] === undefined ? undefined : { ok: !!health.executors?.[r.key] })} off={r.off} required={r.key === "aside"} />)}
        </ul>
      )}
      <div className="mt-3 grid gap-2 border-t pt-3 text-2xs text-muted-foreground sm:grid-cols-2">
        <p><span className="font-medium text-foreground">Try it:</span> open the demo item in Inbox and press <span className="font-medium text-foreground">Send to agent</span>. Bots propose, four reviewers argue, and only what passes runs. Anything that sends, pays or posts waits for you under Needs you.</p>
        <p><span className="font-medium text-foreground">Cost:</span> one council is about 7 Aside runs (3 proposers + 4 reviewers) plus one per passed browser task. To keep Aside for browser work only, start the server with <code className="font-mono">QUORUM_BOT_RUNNER=codex</code> and the opinions run on Codex CLI.</p>
      </div>
    </section>
  )
}
