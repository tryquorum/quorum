// 일 화면의 공간 고르기(할 일·목표). 옮겨도 일 주소·노트·연결은 그대로예요. 목표를 옮겨도 하위 할 일은 제자리예요
import { toast } from "sonner"
import type { Item, SpaceId } from "@direction-board/contracts"
import { useSpaces } from "@/hooks/use-space"
import { spaceName, spaceOf } from "@/lib/spaces"

export function ItemSpaceSelect({ workRef, items, save }: { workRef: string; items?: Item[]; save?: (it: Item) => Promise<boolean> | void }) {
  const { spaces, me } = useSpaces()
  const [, bid, iid] = workRef.split(":")
  const item = workRef.startsWith("item:") ? items?.find((i) => i.boardId === bid && i.id === iid) : undefined
  if (!item || !save || spaces.length < 2 || me?.role === "member" || (item.type !== "todo" && item.type !== "goal")) return null
  const current = spaceOf(item)
  const move = async (to: SpaceId) => {
    if (to === current) return
    const ok = await save({ ...item, space: to })
    if (ok === false) return
    const subs = item.type === "goal" ? items?.filter((i) => i.goalId === item.id && !i.deleted).length ?? 0 : 0
    toast(`${spaceName(spaces, to)} 공간으로 옮겼어요`, { description: subs ? `하위 할 일 ${subs}개는 그대로예요` : item.text })
  }
  return (
    <select aria-label="공간" title="공간" value={current} onChange={(e) => void move(e.target.value as SpaceId)} className="h-8 max-w-32 rounded-md border border-input bg-background px-1.5 text-xs">
      {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  )
}
