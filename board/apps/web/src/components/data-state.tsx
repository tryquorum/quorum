import { useState } from "react"
import { CloudOff } from "lucide-react"
import type { DataState } from "@/hooks/use-data"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { joinSources } from "@/lib/data-state-text"

/**
 * 화면 위 데이터 상태 한 곳. 출처(보드·소식 등)가 여럿이어도 한 줄·한 단추로 합쳐요.
 * - 이전 내용이 있는 실패: 일은 계속할 수 있으니 테두리 없는 조용한 한 줄(role=status) + "다시 시도"(실패한 출처를 모두 다시)
 * - 보여 줄 내용이 없는 실패: 막힌 상태라 테두리 카드(role=alert) + "다시 불러오기"
 * - 처음 불러오는 중(내용 없음): 스켈레톤
 */
export function DataStateNotice({ label, sources }: { label: string; sources: { name: string; state: DataState }[] }) {
  const [busy, setBusy] = useState(false)
  const failed = sources.filter((s) => s.state.status === "error")
  const blocked = failed.filter((s) => !s.state.hasData)
  const retry = async () => {
    setBusy(true)
    try {
      await Promise.allSettled(failed.map((s) => s.state.retry()))
    } finally {
      setBusy(false)
    }
  }
  if (blocked.length) return <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
    <span className="flex-1">{joinSources(failed.map((s) => s.name))} 불러오지 못했어요</span>
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void retry()}>{busy ? "불러오는 중…" : "다시 불러오기"}</Button>
  </div>
  const loading = sources.find((s) => !s.state.hasData && s.state.status === "loading")
  // 알림 영역은 늘 그려 두고 내용만 바꿔요: 새로 나타난 live region 은 첫 내용을 읽지 않을 수 있어요
  return <>
    <div role="status" aria-live="polite">
      {failed.length > 0 && <div className="mb-2 flex min-h-8 items-center gap-1.5 text-xs text-muted-foreground" title="마지막으로 불러온 내용을 보여주고 있어요">
        <CloudOff aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{joinSources(failed.map((s) => s.name))} 새로 못 불러왔어요<span className="sr-only"> · 마지막으로 불러온 내용을 보여줘요</span></span>
        <Button variant="ghost" size="xs" className="-my-1 shrink-0 text-foreground" disabled={busy} onClick={() => void retry()}>{busy ? "불러오는 중…" : "다시 시도"}</Button>
      </div>}
    </div>
    {loading && <div aria-busy="true" className="mb-3 space-y-3 py-3">
      <span className="sr-only">{label} 불러오는 중이에요</span>
      <Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
    </div>}
  </>
}
