import { useState } from "react"
import { toast } from "sonner"
import { ArrowUpRight, MessageSquareText, Play, Square } from "lucide-react"
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ago } from "@/lib/api"
import { chipState, countsLabel, STATUS_KO } from "@direction-board/contracts/ops-labels"
import { confirmUnsavedPrompt, runSweepNow, stopSweep, useOps } from "@/hooks/use-ops"

const DOT = { running: "bg-running animate-pulse", error: "bg-destructive", off: "bg-muted-foreground/40", idle: "bg-done" } as const

/** 사이드바 계정 위 순회 상태 한 줄. 누르면 마지막 순회 요약·지금 돌리기·결과·설정. 맥 주인이 아니면 숨겨요 */
export function OpsStatus({ onOpenSettings, onOpenRun }: { onOpenSettings: () => void; onOpenRun: (runId: string) => void }) {
  const { data, status } = useOps(false)
  const { isMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (status === "forbidden" || !data) return null
  const chip = chipState(data)
  const last = data.runs[0]
  const running = last?.status === "running" ? last : undefined
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "하지 못했어요")
    } finally {
      setBusy(false)
    }
  }
  const go = (fn: () => void) => { setOpen(false); fn() }
  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton className="text-muted-foreground" aria-label={`운영 순회: ${chip.label}`} data-ops-chip="">
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center"><span className={cn("size-2 rounded-full", DOT[chip.tone])} /></span>
            <span className="truncate">{chip.label}</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent side={isMobile ? "top" : "right"} align={isMobile ? "start" : "end"} sideOffset={8} className="w-80 p-0 text-sm">
          <div className="border-b px-3 py-2.5">
            <p className="font-medium">운영 순회</p>
            <p className="text-xs text-muted-foreground">{chip.label}</p>
          </div>
          <div className="space-y-1.5 px-3 py-2.5">
            {!last ? <p className="text-muted-foreground">아직 돈 순회가 없어요</p> : (
              <>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={last.status === "error" ? "destructive" : last.status === "running" ? "default" : "secondary"}>{STATUS_KO[last.status] || last.status}</Badge>
                  <span>마지막 순회 {ago(last.created_at)}</span>
                </p>
                {last.report ? (
                  <>
                    <p className="line-clamp-2">{last.report.summary.split("\n")[0] || "요약 없음"}</p>
                    <p className="text-xs text-muted-foreground">{countsLabel(last.report.counts)}</p>
                  </>
                ) : last.status === "running" ? <p className="text-muted-foreground">돌아보는 중이에요. 끝나면 홈에 올라와요</p>
                  : last.status === "error" ? <p className="line-clamp-2 text-destructive">{(last.error || "실패했어요").split("\n")[0]}</p>
                  : <p className="text-muted-foreground">보고 없이 끝났어요</p>}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 border-t px-3 py-2.5">
            {running
              ? <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => stopSweep(running.id), "순회를 멈췄어요")}><Square />멈추기</Button>
              : <Button size="sm" disabled={busy} onClick={() => { if (confirmUnsavedPrompt()) void act(runSweepNow, "순회를 시작했어요. 끝나면 홈에 올라와요") }}><Play />지금 돌리기</Button>}
            {last && <Button size="sm" variant="ghost" onClick={() => go(() => onOpenRun(last.id))}><MessageSquareText />결과</Button>}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => go(onOpenSettings)}>설정<ArrowUpRight /></Button>
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  )
}
