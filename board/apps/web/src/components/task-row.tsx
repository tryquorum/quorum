import { Building2, CalendarClock, Star } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { dday, isoLocal, W } from "@/lib/api"
import type { Task } from "@/lib/tasks"
import { useSpaces } from "@/hooks/use-space"
import { spaceName } from "@/lib/spaces"

export const taskWhen = (t: Task) => (t.kind === "goal" && t.item?.due ? dday(t.item.due as string).t : typeof t.when === "string" && t.when ? W.short(t.when) : t.at !== null ? W.short(isoLocal(t.at)) : "")

/** 할 일 한 줄: 미리알림·목표·사건 모두 같은 모양. compact = 사이드바 */
export function TaskRow({ t, onOpen, onDone, onStar, compact }: { t: Task; onOpen: (ref: string) => void; onDone: (t: Task, done: boolean) => void; onStar: (t: Task) => void; compact?: boolean }) {
  const when = taskWhen(t)
  const { spaces, view, me } = useSpaces()
  // 모든 공간을 볼 때 워크스페이스 일에 공간 이름을 붙여요(개인은 표시 없음, 회사 공간만 보는 파일럿 멤버도 없음)
  const chip = view === "all" && t.space !== "personal" && spaces.length > 1 && me?.role !== "member" ? spaceName(spaces, t.space) : null
  return (
    <li className={cn("group/tr flex items-center gap-2 rounded-md px-2 max-md:min-h-11 max-md:py-0 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:py-0", compact ? "py-1.5 hover:bg-sidebar-accent" : "py-2 hover:bg-muted/60")}>
      {t.kind === "goal" ? (
        <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-label="목표" />
      ) : (
        <Checkbox className="rounded-full" checked={t.done} onCheckedChange={(v) => onDone(t, !!v)} aria-label={t.done ? "다시 열기" : "끝냄"} />
      )}
      {t.kind === "signal" ? (
        <span className="shrink-0 rounded bg-muted px-1 text-2xs leading-4 font-medium text-muted-foreground">{t.source}</span>
      ) : null}
      {chip && (compact
        ? <span className="flex shrink-0 text-muted-foreground" title={chip}><Building2 className="size-3" aria-hidden /><span className="sr-only">{chip}</span></span>
        : <span className="shrink-0 rounded bg-primary/10 px-1 text-2xs leading-4 font-medium text-primary">{chip}</span>)}
      <button type="button" onClick={() => onOpen(t.ref)} title={t.title} className={cn("min-w-0 flex-1 self-stretch truncate text-left text-sm hover:underline", t.done && "text-muted-foreground line-through")}>{t.title}</button>
      {!compact && t.area && (
        <span className="flex shrink-0 items-center" title={t.area.name}><span className="size-1.5 rounded-full" style={{ background: t.area.color }} aria-hidden /><span className="sr-only">{t.area.name}</span></span>
      )}
      {when && <span className={cn("shrink-0 num text-2xs text-muted-foreground", t.late && "text-destructive")}>{when}</span>}
      {!t.done && (
        <button type="button" onClick={() => onStar(t)} aria-label={t.main ? "메인에서 빼기" : "오늘 메인으로"} title={t.main ? "메인에서 빼기" : "오늘 메인으로"}
          className={cn("grid shrink-0 place-items-center rounded p-0.5 transition-colors max-md:-mr-2 max-md:size-11 [@media(pointer:coarse)]:-mr-2 [@media(pointer:coarse)]:size-11", t.main ? "text-warn" : "text-transparent [@media(hover:none)]:text-muted-foreground/70 group-hover/tr:text-muted-foreground/70 hover:!text-warn focus-visible:text-muted-foreground")}>
          <Star className={cn("size-3.5", t.main && "fill-current")} />
        </button>
      )}
    </li>
  )
}
