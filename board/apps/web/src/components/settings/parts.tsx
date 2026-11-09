import { useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { Check, Copy, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { SettingsInfo } from "@direction-board/contracts/settings"

/** 판단에 필요한 설명만 눌러서 여는 (i) 로. 터치·키보드에서도 열려요 */
export function Explain({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`${label} 설명`}><Info /></Button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3 text-sm text-muted-foreground">{children}</PopoverContent>
    </Popover>
  )
}

/** 설정 한 줄. id 는 레지스트리 항목 id 이고 검색에서 고르면 이 줄이 강조돼요 */
export function SettingRow({ id, label, info, children, stack }: { id: string; label: string; info?: ReactNode; children: ReactNode; stack?: boolean }) {
  return (
    <div data-setting={id} tabIndex={-1} className={cn("scroll-mt-20 rounded-lg px-3 py-3 outline-none transition-[box-shadow,background-color] duration-300 data-[highlight]:bg-accent/60 data-[highlight]:ring-2 data-[highlight]:ring-ring", stack ? "space-y-3" : "flex flex-wrap items-center justify-between gap-x-4 gap-y-2")}>
      <div className="flex min-w-0 items-center gap-1">
        <span className="text-sm font-medium">{label}</span>
        {info && <Explain label={label}>{info}</Explain>}
      </div>
      <div data-setting-control className={cn("min-w-0", !stack && "flex items-center gap-2")}>{children}</div>
    </div>
  )
}

export function Group({ children }: { children: ReactNode }) {
  return <div className="divide-y rounded-xl border bg-card">{children}</div>
}

/** 여러 개 중 하나 고르기(테마·주소). 화살표 키로 움직여요 */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = options[(i + d + options.length) % options.length]
    onChange(next.value)
    const group = e.currentTarget.parentElement
    requestAnimationFrame(() => group?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus())
  }
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((o, i) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} data-value={o.value} tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)} onKeyDown={(e) => move(e, i)}
          className={cn("h-7 rounded-md px-3 text-sm text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", value === o.value && "bg-background font-medium text-foreground shadow-sm")}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export async function copyText(text: string, what = "복사했어요") {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(what)
    return true
  } catch {
    toast.error("복사하지 못했어요. 직접 선택해 복사해 주세요")
    return false
  }
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1500); return () => clearTimeout(t) }, [done])
  return <Button variant="outline" size="sm" aria-label={label} onClick={() => void copyText(text).then(setDone)}>{done ? <Check /> : <Copy />}{done ? "복사됨" : "복사"}</Button>
}

/** 코드 조각 + 복사 */
export function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-lg border bg-muted/40">
      <figcaption className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="truncate font-mono">{label}</span>
        <CopyButton text={code} label={`${label} 복사`} />
      </figcaption>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"><code>{code}</code></pre>
    </figure>
  )
}

let cached: Promise<SettingsInfo> | null = null
/** GET /api/settings 한 번. 실패하면 다음에 다시 받아요 */
export function useSettingsInfo() {
  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    cached ||= api<SettingsInfo>("/api/settings")
    cached.then((v) => { if (live) { setInfo(v); setError(false) } }).catch(() => { cached = null; if (live) setError(true) })
    return () => { live = false }
  }, [tick])
  return { info, error, retry: () => setTick((t) => t + 1) }
}
