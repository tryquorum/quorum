// 할 일 한 층: 미리알림(보드 todo)·목표·내가 처리할 사건(signal)·메인 일을 같은 모양으로 다룬다.
// 사이드바 "오늘", 전체 목록, (첫 화면과 같은 db:main 키로) 메인 표시가 모두 여기를 쓴다.
import { useCallback } from "react"
import { toast } from "sonner"
import type { Item } from "@/lib/api"
import type { Task } from "@direction-board/contracts/tasks"
import { useStored } from "@/hooks/use-data"
// 순수 규칙(Task·toTasks·정렬)은 iOS 와 함께 쓰려고 packages/contracts/src/tasks.ts 에 있어요
export { compareTasks, isCalendar, opsCardRefs, TASK_LANES, toTasks, type Task } from "@direction-board/contracts/tasks"

const dayKey = () => new Date().toDateString()
/** 오늘 메인 일 키 (첫 화면 "오늘 내 메인 일"과 같은 저장값). 끝낸 것도 남겨 두고, 3개 제한은 안 끝난 것만 센다 */
export function useMainKeys() {
  const [st, setSt] = useStored<{ day: string; keys: string[] }>("db:main", { day: dayKey(), keys: [] })
  const keys = st.day === dayKey() ? st.keys : []
  const setKeys = useCallback((k: string[]) => setSt({ day: dayKey(), keys: [...new Set(k)] }), [setSt])
  return [keys, setKeys] as const
}

/** 별 누르기: 메인으로 / 메인에서 빼기. openKeys = 지금 안 끝난 할 일 키 전체(다른 판 포함) */
export function toggleMain(t: Task, keys: string[], setKeys: (k: string[]) => void, openKeys: Set<string>) {
  if (t.main) return setKeys(keys.filter((k) => k !== t.key))
  const live = keys.filter((k) => openKeys.has(k)).length
  if (live >= 3) return void toast("메인 일은 3개까지예요", { description: "하나를 끝내거나 빼고 다시 골라요" })
  setKeys([...keys, t.key])
  toast("오늘 메인으로 골랐어요", { description: t.title })
}

/** 끝냄/다시 열기: 미리알림·목표는 보드에, 사건은 처리함으로 */
export function useSetDone(save: (it: Item) => Promise<boolean> | void, patchSignal: (id: string, body: Record<string, unknown>) => Promise<void>) {
  return useCallback(async (t: Task, done: boolean) => {
    const apply = (v: boolean) => (t.item ? save({ ...t.item, done: v }) : t.signal ? patchSignal(t.signal.id, { status: v ? "resolved" : "open" }) : undefined)
    const r = await apply(done)
    if (done && r !== false) toast("끝냈어요", { description: t.title, action: { label: "되돌리기", onClick: () => { void apply(false) } } })
  }, [save, patchSignal])
}
