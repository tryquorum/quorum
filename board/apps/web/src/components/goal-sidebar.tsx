import { useMemo } from "react"
import { Plus, Target } from "lucide-react"
import { SidebarGroupAction, useSidebar } from "@/components/ui/sidebar"
import { Section } from "@/components/app-sidebar"
import { useQuickAdd } from "@/components/quick-add"
import {
  compareWorkOrder,
  computeGoalProgress,
  goalProgressBasis,
  computeGoalState,
  dday,
  goalStateLabel,
  type Board,
  type GoalState,
  type Item,
} from "@/lib/api"
import { cn } from "@/lib/utils"

const stateBadgeClass = (state: GoalState) =>
  state === "late"
    ? "bg-destructive/10 text-destructive"
    : state === "done"
      ? "bg-muted text-muted-foreground"
      : "bg-done/10 text-done-foreground"

export function GoalSection({
  board,
  boardId,
  items,
  activeWorkRef,
  onOpenGoal,
}: {
  board: Board | undefined
  boardId: string | undefined
  items: Item[]
  activeWorkRef?: string | null
  onOpenGoal: (ref: string) => void
}) {
  const { open: openQuickAdd } = useQuickAdd()
  const { isMobile, setOpenMobile } = useSidebar()
  const goals = useMemo(
    () =>
      items
        .filter((i) => i.boardId === boardId && !i.deleted && i.type === "goal")
        .sort((a, b) => compareWorkOrder(a, b)),
    [items, boardId],
  )
  const openCount = goals.filter((g) => !g.done).length

  const createGoal = (from: HTMLElement) => {
    const draft = {
      boardId: boardId ?? "",
      kind: "goal" as const,
      title: "",
      at: null,
      areaId: null,
      tags: [],
      note: "",
      props: [],
    }
    if (!isMobile) return openQuickAdd("", from, undefined, draft)
    setOpenMobile(false)
    window.setTimeout(() => openQuickAdd("", document.querySelector<HTMLElement>('[data-sidebar="trigger"]'), undefined, draft), 260)
  }

  return (
    <Section
      id="goals"
      label="목표"
      count={openCount}
      // 목표가 없고 펼쳐져 있으면 아래 "+ 목표 세우기" 하나만(GAP-21). 접혀 있으면 이 + 가 유일한 생성 길이라 둬요
      action={(sectionOpen) => goals.length === 0 && sectionOpen ? undefined :
        <SidebarGroupAction type="button" aria-label="새 목표" title="새 목표" disabled={!boardId} onClick={(e) => createGoal(e.currentTarget)}>
          <Plus />
        </SidebarGroupAction>
      }
    >
      {goals.length === 0 ? (
        <button
          type="button"
          disabled={!boardId}
          onClick={(e) => createGoal(e.currentTarget)}
          className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          + 목표 세우기
        </button>
      ) : (
        <ul className="flex flex-col gap-0.5" aria-label="목표 목록">
          {goals.map((g) => {
            const ref = `item:${g.boardId}:${g.id}`
            const active = activeWorkRef === ref
            const title = (g.text || "(제목 없음)").split("\n")[0]
            const progress = computeGoalProgress(g, items)
            const basis = goalProgressBasis(g, items)
            const state = computeGoalState(g)
            const label = goalStateLabel(state)
            const dd = dday(g.due)
            const area = board?.areas.find((a) => a.id === g.area)
            const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : g.done ? 100 : 0
            return (
              <li key={g.id}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onOpenGoal(ref)}
                  className={cn(
                    "flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent",
                    active && "bg-sidebar-accent font-medium",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    {area ? (
                      <><span className="size-2 shrink-0 rounded-full" style={{ background: area.color }} title={area.name} aria-hidden /><span className="sr-only">{area.name}</span></>
                    ) : (
                      <Target className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className={cn("min-w-0 flex-1 truncate text-sm", g.done && "text-muted-foreground line-through")}>{title}</span>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-2xs leading-none font-medium", stateBadgeClass(state))}>
                      {label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pl-3.5 text-2xs text-muted-foreground">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-sidebar-border" aria-hidden>
                      <div
                        className={cn("h-full transition-all", state === "late" ? "bg-destructive" : "bg-done")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="num shrink-0">{progress.done}/{progress.total}</span>
                    {basis !== "linked" && <span className="shrink-0" title={basis === "area" ? "이 목표에 붙인 할 일이 없어 같은 영역의 할 일을 세요. 목표 페이지에서 할 일을 추가하면 이 목표에 붙어요" : "이 목표에 붙인 할 일도, 영역도 없어요. 목표 페이지에서 할 일을 추가하면 이 목표에 붙어요"}>{basis === "area" ? "영역 기준" : "붙인 할 일 없음"}<span className="sr-only">{basis === "area" ? ", 붙인 할 일이 없어 같은 영역의 할 일을 세요" : ", 목표 페이지에서 할 일을 추가하면 붙어요"}</span></span>}
                    <span className={cn("num shrink-0", dd.late && !g.done && "font-medium text-destructive")}>
                      {g.due ? dd.t : "기한 없음"}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
