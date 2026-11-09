// 단축키 도움말. 출처: board/apps/web/src/components/shortcut-help.tsx — 레지스트리(./shortcuts)에서 표를 만들어요.
import { Fragment } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { SHORTCUTS, formatKeys, isMac } from "./shortcuts"

export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const mac = typeof navigator !== "undefined" && isMac(navigator.platform)
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))]
  const kbd = "num inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted/50 px-1 font-mono text-2xs text-foreground"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] gap-3 overflow-y-auto p-5 sm:max-w-2xl">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription className="text-xs">Single keys do nothing while you type (including Korean IME composition). {mac ? "⌘" : "Ctrl"} combos marked “while typing” always work.</DialogDescription>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g} aria-label={g} className="min-w-0">
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{g}</h3>
              <ul className="flex flex-col gap-1">
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0">{s.label}{s.note && <span className="block text-2xs text-muted-foreground">{s.note}</span>}</span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      {formatKeys(s, mac).map((combo, i) => (
                        <Fragment key={i}>{i > 0 && <span className="text-2xs text-muted-foreground">·</span>}<span className="inline-flex items-center gap-0.5">{combo.map((part, j) => <Fragment key={j}>{s.sequence && j > 0 && <span className="px-0.5 text-2xs text-muted-foreground">then</span>}<kbd className={kbd}>{part}</kbd></Fragment>)}</span></Fragment>
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
