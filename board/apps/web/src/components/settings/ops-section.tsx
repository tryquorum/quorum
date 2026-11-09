import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Play, Square } from "lucide-react"
import type { OpsSettings } from "@direction-board/contracts/api"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { EffortPicker, ModelPicker, useCatalog, type Choice } from "@/components/model-picker"
import { OpsRuns } from "@/components/ops/ops-runs"
import { PromptEditor } from "@/components/ops/prompt-editor"
import { whenLabel } from "@direction-board/contracts/ops-labels"
import { confirmUnsavedPrompt, putOps, refreshOps, runSweepNow, stopSweep, useOps } from "@/hooks/use-ops"
import { useSpaces } from "@/hooks/use-space"
import { Explain, Group, SettingRow } from "./parts"

const EVERY: [number, string][] = [[30, "30분"], [60, "1시간"], [120, "2시간"], [180, "3시간"], [240, "4시간"], [360, "6시간"], [720, "12시간"], [1440, "하루"]]
const HOURS = Array.from({ length: 25 }, (_, i) => i)
const select = "h-8 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
const anchor = "scroll-mt-20 space-y-2 rounded-xl outline-none data-[highlight]:ring-2 data-[highlight]:ring-ring"

/** 설정 › 운영 순회: 순회의 집. 켜기·주기·시간·모델, 지금 돌리기, 지난 순회 결과, 지시문 */
export function OpsSection() {
  const { data, status } = useOps(true)
  const cat = useCatalog()
  const pilot = useSpaces().me?.auth === "google"
  const [busy, setBusy] = useState(false)
  const o = data?.ops
  const choice: Choice | null = useMemo(() => (cat && o ? { provider: o.provider || cat.default.provider, model: o.model || cat.default.modelId, effort: o.effort || cat.default.effort } : null), [cat, o])

  // 파일럿(Google 로그인 서버)은 운영 순회를 꺼 둬요. 서버도 403(reason: pilot)이에요. 개인 Aside 연결이 끝나면 각자 Aside 로 돌려요
  if (pilot) return <Group><p className="px-3 py-3 text-sm text-muted-foreground">이 방향판에서는 운영 순회를 아직 쓰지 않아요. 개인 Aside 연결이 끝나면 각자 자기 Aside 로 돌릴 수 있어요</p></Group>
  if (status === "forbidden") return <Group><p className="px-3 py-3 text-sm text-muted-foreground">운영 순회는 이 맥의 주인만 보고 바꿀 수 있어요</p></Group>
  if (!data || !o) return status === "error"
    ? <div role="alert" className="flex items-center gap-3 rounded-xl border p-4 text-sm"><span className="flex-1">운영 순회를 불러오지 못했어요</span><Button variant="outline" size="sm" onClick={() => void refreshOps()}>다시 불러오기</Button></div>
    : <p aria-busy="true" className="text-sm text-muted-foreground">불러오는 중이에요</p>

  const put = async (patch: Partial<OpsSettings>, msg?: string) => {
    try { await putOps(patch); if (msg) toast.success(msg) } catch { toast.error("저장하지 못했어요") }
  }
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast.success(ok) } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "하지 못했어요") } finally { setBusy(false) }
  }
  const running = data.runs.find((r) => r.status === "running")
  const state = !o.enabled ? "꺼져 있어요" : data.next_at ? `다음 ${whenLabel(data.next_at)}${data.in_window ? "" : " · 지금은 쉬는 시간"}` : "활동 시간이 없어요"

  return (
    <div className="space-y-6">
      {status === "error" && <p role="status" className="text-xs text-muted-foreground">새 내용을 불러오지 못했어요 · 마지막으로 불러온 내용을 보여줘요</p>}
      <Group>
        <SettingRow id="ops-schedule" label="자동 순회" info={<p>저장한 지시대로 주기마다 영역을 살피고 홈의 사건과 할 일로 올려요. 이 맥에서 방향판 서버가 켜져 있고 맥이 깨어 있을 때만 돌아요.</p>}>
          <span className="text-sm text-muted-foreground">{state}</span>
          <Switch checked={o.enabled} onCheckedChange={(v) => void put({ enabled: v }, v ? "자동 순회를 켰어요" : "자동 순회를 껐어요")} aria-label="자동 순회" />
        </SettingRow>
        <SettingRow id="ops-every" label="주기">
          <select aria-label="순회 주기" className={select} value={o.every_min} onChange={(e) => void put({ every_min: Number(e.target.value) })}>
            {EVERY.map(([v, l]) => <option key={v} value={v}>{l}마다</option>)}
          </select>
        </SettingRow>
        <SettingRow id="ops-hours" label="활동 시간(한국)">
          <select aria-label="시작 시각" className={select} value={o.active_from} onChange={(e) => void put({ active_from: Number(e.target.value) })}>
            {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{h}시</option>)}
          </select>
          <span className="text-muted-foreground">~</span>
          <select aria-label="끝 시각" className={select} value={o.active_to} onChange={(e) => void put({ active_to: Number(e.target.value) })}>
            {HOURS.slice(1).map((h) => <option key={h} value={h}>{h}시</option>)}
          </select>
        </SettingRow>
        <SettingRow id="ops-model" label="모델" info={<p>순회만 쓰는 모델이에요. 설정 › AI 의 기본 모델과 따로예요.</p>}>
          {cat && choice ? <>
            <ModelPicker cat={cat} choice={choice} onChange={(c) => void put({ provider: c.provider, model: c.model, effort: c.effort })} side="bottom" align="end" />
            <EffortPicker cat={cat} choice={choice} onChange={(c) => void put({ effort: c.effort })} side="bottom" align="end" />
          </> : <span className="text-sm text-muted-foreground">모델 목록을 불러오는 중이에요</span>}
        </SettingRow>
        <SettingRow id="ops-run" label="지금 돌리기" info={<p>주기를 기다리지 않고 한 번 돌려요. 끝나면 결과가 아래 지난 순회와 홈에 올라와요.</p>}>
          {running
            ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => stopSweep(running.id), "순회를 멈췄어요")}><Square />멈추기</Button>
            : <Button size="sm" disabled={busy} onClick={() => { if (confirmUnsavedPrompt()) void act(runSweepNow, "순회를 시작했어요. 끝나면 홈에 올라와요") }}><Play />지금 돌리기</Button>}
        </SettingRow>
      </Group>

      <section data-setting="ops-runs" tabIndex={-1} aria-labelledby="ops-runs-title" className={anchor}>
        <h2 id="ops-runs-title" className="px-1 text-sm font-medium">지난 순회</h2>
        <OpsRuns runs={data.runs} />
      </section>

      <section data-setting="ops-prompt" tabIndex={-1} aria-labelledby="ops-prompt-title" className={anchor}>
        <h2 id="ops-prompt-title" className="flex items-center gap-1 px-1 text-sm font-medium">지시문<Explain label="지시문">순회할 때마다 이 글 전체가 Aside 에게 그대로 넘어가요. 영역(###), 확인할 곳, 나를 불러야 하는 조건을 고치면 다음 순회부터 반영돼요.</Explain></h2>
        <PromptEditor ops={o} defaultText={data.default_text} />
      </section>
    </div>
  )
}
