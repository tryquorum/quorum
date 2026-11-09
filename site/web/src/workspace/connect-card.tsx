// 호스팅(quorum.lidgeai.com) 연결 카드: 각자 자기 Aside 를 MCP 로 붙여요. 서버는 이 사람 대신 아무것도 실행하지 않고,
// 통과·승인한 일과 봇 의견을 이 사람 대기열에 넣어요. 이 카드는 연결 토큰을 만들고(원문은 이 화면에서 한 번만), Aside 설정 조각과 Aside 에게 줄 한 문장을 보여 줘요.
// Aside 설정 모양(mcp.servers 의 streamable-http + auth.type headers)은 Aside 1.26.1107 의 ~/.aside/u/<n>/settings.json 에서 확인했어요.
import { useCallback, useEffect, useState } from "react"
import { Check, Copy, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ws, type Health, type McpToken } from "./api"
import { ALERT, CHIP } from "./tone"

export const ASIDE_PROMPT = "Work through my Quorum tasks: call quorum_next_task with waitSeconds 20, do each task exactly as it says, report it with quorum_report_result, and stop when it returns no task twice in a row. Never send, pay, submit or post anything."

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500) })}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-2xs text-muted-foreground hover:text-foreground max-md:min-h-11" aria-label={label}>
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}{done ? "Copied" : "Copy"}
    </button>
  )
}

function Block({ text, label }: { text: string; label: string }) {
  return (
    <div className="relative mt-1.5 rounded-xl border bg-background/60">
      <pre className="max-h-52 overflow-auto p-3 pr-20 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">{text}</pre>
      <div className="absolute top-2 right-2"><CopyButton text={text} label={label} /></div>
    </div>
  )
}

export function asideSnippet(origin: string, secret: string) {
  return JSON.stringify({ quorum: { enabled: true, transport: "streamable-http", url: origin + "/mcp", auth: { type: "headers", headers: { Authorization: "Bearer " + secret } } } }, null, 2)
}

export function ConnectCard({ health, onDismiss }: { health: Health; onDismiss: () => void }) {
  const [tokens, setTokens] = useState<McpToken[]>([])
  const [name, setName] = useState("My Aside")
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => ws.tokens().then((r) => setTokens(r.tokens)).catch((e) => setError(e instanceof Error ? e.message : String(e))), [])
  useEffect(() => { void load() }, [load])
  const d = health.details ?? {}
  const connected = !!health.executors?.aside
  const active = tokens.filter((t) => !t.revokedAt)
  const make = async () => {
    setBusy(true); setError(null)
    try { const r = await ws.makeToken(name.trim() || "My Aside"); setSecret(r.secret); await load() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const revoke = async (id: string) => {
    try { await ws.revokeToken(id); await load() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <section aria-label="Connect your Aside" className="mx-2 mb-5 rounded-2xl border bg-card/50 p-4">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Connect your Aside</h2>
          <p className="text-2xs text-muted-foreground">On this hosted Quorum nothing runs on the host's computer. Bot opinions and the browser work your council passes wait in your own queue, and your Aside picks them up over MCP.</p>
        </div>
        {connected && <button type="button" onClick={onDismiss} className="rounded-full p-1 text-muted-foreground hover:text-foreground max-md:size-11" aria-label="Hide connection card"><X className="size-4" /></button>}
      </div>

      <ul className="mb-3 grid gap-x-6 gap-y-1 sm:grid-cols-3">
        <li className="flex items-start gap-2"><span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", connected ? "bg-emerald-400" : "bg-foreground/25")} /><div className="min-w-0"><p className="text-xs font-medium">Your Aside</p><p className="text-2xs text-muted-foreground">{connected ? "connected" : d.aside?.reason ?? "not connected yet"}</p></div></li>
        <li className="flex items-start gap-2"><span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground/40" /><div className="min-w-0"><p className="text-xs font-medium">Your queue</p><p className="text-2xs text-muted-foreground">{d.queue?.hint ?? "—"}</p></div></li>
        <li className="flex items-start gap-2"><span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground/40" /><div className="min-w-0"><p className="text-xs font-medium">Bot opinions</p><p className="text-2xs text-muted-foreground">{d.bots?.hint ?? "—"}</p></div></li>
      </ul>

      <ol className="flex flex-col gap-3 border-t pt-3 text-xs">
        <li>
          <p><span className="font-medium">1. Make a connection token.</span> <span className="text-muted-foreground">It is shown once. Anyone with it can work through your queue, so keep it in Aside only.</span></p>
          {secret ? (
            <div className="mt-1.5">
              <Block text={secret} label="Copy token" />
              <p className="mt-1 text-2xs text-muted-foreground">Copy it now. Quorum keeps only a hash and cannot show it again.</p>
            </div>
          ) : (
            <form className="mt-1.5 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void make() }}>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Token name" className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-xs max-md:h-11" />
              <button type="submit" disabled={busy || active.length >= 5} className="h-8 rounded-full bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50 max-md:h-11">{busy ? "Making…" : "Make token"}</button>
            </form>
          )}
        </li>
        <li>
          <p><span className="font-medium">2. Add Quorum to Aside as an MCP server.</span> <span className="text-muted-foreground">Put this entry under <code className="font-mono">mcp.servers</code> in your Aside settings file (<code className="font-mono">~/.aside/u/&lt;account&gt;/settings.json</code>, next to any servers already there).</span></p>
          <Block text={asideSnippet(location.origin, secret ?? "qmcp_…your token…")} label="Copy Aside settings entry" />
        </li>
        <li>
          <p><span className="font-medium">3. Ask Aside to do the work.</span> <span className="text-muted-foreground">Send this in Aside after you press Send to agent here. Anything that sends, pays or posts stays under Needs you until you approve it.</span></p>
          <Block text={ASIDE_PROMPT} label="Copy Aside prompt" />
        </li>
      </ol>

      {error && <p role="alert" className={"mt-3 rounded-xl px-3 py-2 text-xs " + ALERT}>{error}</p>}
      {tokens.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">Connection tokens</p>
          <ul className="flex flex-col">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate">{t.name} <span className="font-mono text-2xs text-muted-foreground">{t.prefix}…</span></span>
                <span className="shrink-0 text-2xs text-muted-foreground">{t.revokedAt ? "revoked" : t.lastUsedAt ? "used " + new Date(t.lastUsedAt).toLocaleString() : "never used"}</span>
                {!t.revokedAt && <button type="button" onClick={() => void revoke(t.id)} className={cn("shrink-0 rounded-full px-2 py-0.5 text-2xs max-md:min-h-11", CHIP)}>Revoke</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
