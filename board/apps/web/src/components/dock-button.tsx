// 머리글의 AI 단추. 모든 화면에서 같은 자리·같은 모양이고, 누르거나 "/" 로 AI 명령창을 열고 닫아요.
import { useSyncExternalStore } from "react"
import { AiMark } from "@/components/ai-mark"
import { Button } from "@/components/ui/button"

type DockState = { open: boolean; running: boolean; draft: boolean }
let state: DockState = { open: false, running: false, draft: false }
const subs = new Set<() => void>()

/** 명령창이 자기 상태(열림·도는 중·쓰던 글)를 알려요. 머리글 단추가 이것으로 점과 aria-expanded 를 그려요 */
export function publishDock(next: DockState) {
  if (next.open === state.open && next.running === state.running && next.draft === state.draft) return
  state = next
  for (const f of subs) f()
}
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

export function DockButton() {
  const s = useSyncExternalStore(subscribe, () => state)
  const hint = s.running ? "AI가 답하는 중" : s.draft ? "쓰던 글이 있어요" : ""
  return (
    <Button
      variant="ghost"
      size="sm"
      data-dock-trigger
      aria-expanded={s.open}
      aria-controls={s.open ? "command-dock" : undefined}
      aria-label={hint ? `AI에게 맡기기, ${hint}` : "AI에게 맡기기"}
      aria-keyshortcuts="/"
      title="AI에게 맡기기 ( / )"
      className="relative gap-1.5 max-md:w-11 max-md:px-0"
      onClick={() => window.dispatchEvent(new CustomEvent("dock:toggle"))}
    >
      <AiMark className="size-4 text-ai" />
      <span className="max-md:hidden">AI</span>
      {(s.running || s.draft) && <span aria-hidden className={s.running ? "absolute top-1 right-1 size-2 animate-pulse rounded-full bg-running motion-reduce:animate-none" : "absolute top-1 right-1 size-2 rounded-full bg-muted-foreground"} />}
    </Button>
  )
}
