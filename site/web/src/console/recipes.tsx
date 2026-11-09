import { useEffect, useState } from "react"
import { Play, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { listRecipes, type RecipeSummary } from "./stream"
import { Panel } from "./panels"

/** luma.com 주소나 slug 를 slug 로 */
export const lumaSlug = (v: string) => { const t = v.trim(); if (!t) return ""; try { return new URL(t).pathname.split("/").filter(Boolean).pop() ?? "" } catch { return t.replace(/^\/+|\/+$/g, "") } }

export function RecipesPanel({ disabledReason, busy, onRun }: { disabledReason?: string; busy: boolean; onRun: (id: string, vars: Record<string, string>) => void }) {
  // 레시피는 어떤 행사를 읽을지 알아야 해요: 비워 보내면 엔진이 "값이 없어요: slug"로 멈춰요. 마지막 값을 기억해요
  const [event, setEvent] = useState(() => { try { return localStorage.getItem("qc:recipe-event") ?? "" } catch { return "" } })
  const slug = lumaSlug(event)
  const [state, setState] = useState<{ recipes: RecipeSummary[] } | { problem: string } | null>(null)
  useEffect(() => {
    if (disabledReason) return
    let alive = true
    void listRecipes().then((s) => { if (alive) setState(s) })
    return () => { alive = false }
  }, [disabledReason])
  return (
    <Panel title="Recipes" icon={Wrench}>
      {disabledReason ? (
        <p className="text-sm text-muted-foreground">{disabledReason}</p>
      ) : !state ? (
        <p className="text-sm text-muted-foreground">Loading recipes…</p>
      ) : "problem" in state ? (
        <p className="text-sm text-muted-foreground">Recipes are unavailable: {state.problem}</p>
      ) : !state.recipes.length ? (
        <p className="text-sm text-muted-foreground">No recipes on this server.</p>
      ) : (
        <>
        <label className="mb-3 flex flex-col gap-1 text-xs text-muted-foreground">
          Luma event (slug or link)
          <input value={event} onChange={(e) => { setEvent(e.target.value); try { localStorage.setItem("qc:recipe-event", e.target.value) } catch { /* 기억 못 해도 실행은 돼요 */ } }} placeholder="compiled-8lsr or https://luma.com/compiled-8lsr" className="h-8 rounded-lg border bg-transparent px-2.5 font-mono text-xs text-foreground outline-none focus:border-foreground/40 max-md:h-11" />
          {!slug && <span>Fill this in first — the recipes read that event.</span>}
        </label>
        <ul className="flex flex-col gap-3">
          {state.recipes.map((r) => (
            <li key={r.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span className={cn("size-1.5 shrink-0 rounded-full", r.health == null ? "bg-foreground/25" : r.health.ok ? "bg-keep" : "bg-cut")} title={r.health?.note ?? (r.health == null ? "not run yet" : r.health.ok ? "healthy" : "broken")} />
                <span className="font-mono text-xs">{r.id}</span>
                <span className="font-mono text-2xs text-muted-foreground">v{r.version}</span>
                <Button size="xs" variant="outline" className="ml-auto rounded-full" disabled={busy || !slug} onClick={() => onRun(r.id, { slug })}><Play />Run</Button>
              </div>
              <p className="mt-0.5 truncate pl-3.5 text-xs text-muted-foreground">{r.intent} · <span className="font-mono">{r.endpoint}</span></p>
            </li>
          ))}
        </ul>
        </>
      )}
    </Panel>
  )
}
