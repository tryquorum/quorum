import { useEffect, useState } from "react"
import { Play, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { listRecipes, type RecipeSummary } from "./stream"
import { Panel } from "./panels"

export function RecipesPanel({ disabledReason, busy, onRun }: { disabledReason?: string; busy: boolean; onRun: (id: string) => void }) {
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
        <ul className="flex flex-col gap-3">
          {state.recipes.map((r) => (
            <li key={r.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span className={cn("size-1.5 shrink-0 rounded-full", r.health == null ? "bg-foreground/25" : r.health.ok ? "bg-keep" : "bg-cut")} title={r.health?.note ?? (r.health == null ? "not run yet" : r.health.ok ? "healthy" : "broken")} />
                <span className="font-mono text-xs">{r.id}</span>
                <span className="font-mono text-2xs text-muted-foreground">v{r.version}</span>
                <Button size="xs" variant="outline" className="ml-auto rounded-full" disabled={busy} onClick={() => onRun(r.id)}><Play />Run</Button>
              </div>
              <p className="mt-0.5 truncate pl-3.5 text-xs text-muted-foreground">{r.intent} · <span className="font-mono">{r.endpoint}</span></p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
