// 단축키 도움말: lib/shortcuts.ts 레지스트리에서 만들어요. ?·⌘/·Ctrl+/, 문서 도구줄 키보드 아이콘, 명령 팔레트로 열어요.
import { Fragment } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { SHORTCUTS, formatKeys, isMac, screenOf, type Screen } from "@/lib/shortcuts"

/** 화면마다 먼저 보일 묶음 */
const FIRST: Partial<Record<Screen, string[]>> = { docs: ["문서 목록", "문서"], doc: ["문서", "노트 편집기"], work: ["노트 편집기", "AI 대화"] }

export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const mac = typeof navigator !== "undefined" && isMac(navigator.platform)
  const screen = typeof location !== "undefined" ? screenOf(location.hash) : "home"
  const shown = SHORTCUTS.filter((s) => s.owner !== "reserved")
  const groups = [...new Set(shown.map((s) => s.group))]
  const first = FIRST[screen] ?? []
  groups.sort((a, b) => (first.includes(a) ? first.indexOf(a) : 99) - (first.includes(b) ? first.indexOf(b) : 99))
  const kbd = "num inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted/50 px-1 text-2xs text-foreground"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] gap-3 overflow-y-auto p-5 sm:max-w-2xl">
        <DialogTitle>키보드 단축키</DialogTitle>
        <DialogDescription className="text-xs">입력칸 밖에서 누르는 한 글자 키는 글을 쓰는 동안(한글 조합 중 포함)에는 먹지 않아요. {mac ? "⌘" : "Ctrl"} 키 조합은 표시한 것만 입력 중에도 돼요.</DialogDescription>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g} aria-label={g} className="min-w-0">
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{g}</h3>
              <ul className="flex flex-col gap-1">
                {shown.filter((s) => s.group === g).map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0">{s.label}{s.owner === "global" && s.whileTyping && <span className="ml-1.5 text-2xs text-muted-foreground">입력 중에도</span>}{s.note && <span className="block text-2xs text-muted-foreground">{s.note}</span>}</span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1" aria-label={formatKeys(s, mac).map((k) => k.join(s.sequence ? " 다음 " : "+")).join(" 또는 ")}>
                      {formatKeys(s, mac).map((combo, i) => (
                        <Fragment key={i}>{i > 0 && <span className="text-2xs text-muted-foreground">·</span>}<span className="inline-flex items-center gap-0.5">{combo.map((part, j) => <Fragment key={j}>{s.sequence && j > 0 && <span className="px-0.5 text-2xs text-muted-foreground">다음</span>}<kbd className={kbd}>{part}</kbd></Fragment>)}</span></Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
