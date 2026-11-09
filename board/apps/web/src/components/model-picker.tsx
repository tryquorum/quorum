import { useEffect, useMemo, useState } from "react"
import { ArrowUpRight, Check, ChevronDown, Search } from "lucide-react"
import { AiMark } from "@/components/ai-mark"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useStored } from "@/hooks/use-data"
import { effortLabel, findModel, pickEffort, searchModels, validChoice, type ModelCatalog, type ModelChoice, type ModelInfo, type ProviderInfo } from "@direction-board/contracts/models"

// 카탈로그 타입과 고르기 규칙은 웹·iOS 공용(@direction-board/contracts/models)
export type Catalog = ModelCatalog
export type Choice = ModelChoice

let cached: Promise<Catalog> | null = null
export function useCatalog() {
  const [cat, setCat] = useState<Catalog | null>(null)
  useEffect(() => {
    cached ||= api<Catalog>("/api/models")
    cached.then(setCat).catch(() => {
      cached = null
    })
  }, [])
  return cat
}

/** 모델 고르기: 마지막으로 고른 걸 기억, 없으면 Aside 기본 모델 */
export function useChoice(cat: Catalog | null) {
  // 설정창과 명령창이 같은 값을 쓰도록 useStored(db:stored 이벤트·다른 탭 storage 이벤트)로 맞춰요
  const [choice, setChoiceState] = useStored<Choice | null>("db:model", null)
  const valid = useMemo(() => validChoice(cat, choice), [cat, choice])
  const setChoice = (c: Choice) => setChoiceState(c)
  return [valid, setChoice] as const
}

function ProviderIcon({ id, className }: { id: string; className?: string }) {
  if (id === "opencodex")
    return (
      <svg viewBox="0 0 16 16" className={cn("size-4", className)} aria-hidden>
        {[[8, 3], [12.3, 5.5], [12.3, 10.5], [8, 13], [3.7, 10.5], [3.7, 5.5]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2" fill="currentColor" />)}
      </svg>
    )
  if (id === "openai-codex")
    return (
      <svg viewBox="0 0 16 16" className={cn("size-4", className)} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3">
        <path d="M8 2.2l4.9 2.9v5.8L8 13.8l-4.9-2.9V5.1z" />
        <path d="M8 5.2l2.4 1.4v2.8L8 10.8 5.6 9.4V6.6z" />
      </svg>
    )
  return <AiMark className={cn("size-4", className)} aria-hidden />
}

/** 스크린샷의 Aside 모델 선택기와 같은 모양: 검색 + 제공자 > 모델 하위 메뉴 + 설정 */
type PickerPlacement = { side?: "top" | "bottom"; align?: "start" | "end" }

export function ModelPicker({ cat, choice, onChange, side = "top", align = "start" }: { cat: Catalog | null; choice: Choice | null; onChange: (c: Choice) => void } & PickerPlacement) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const curModel = findModel(cat, choice)?.model
  const pick = (p: ProviderInfo, m: ModelInfo) => {
    onChange({ provider: p.id, model: m.id, effort: pickEffort(m, choice?.effort) })
    setOpen(false)
    setQ("")
  }
  const hits = useMemo(() => searchModels(cat, q).map(({ provider, model }) => ({ p: provider, m: model })), [q, cat])

  return (
    <DropdownMenu open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ("") }}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex h-8 max-w-[220px] items-center gap-1.5 rounded-full bg-muted px-3 text-sm font-medium hover:bg-muted/80 data-[state=open]:bg-muted/80" aria-label="모델 고르기">
          <ProviderIcon id={choice?.provider || "aside"} className="shrink-0" />
          <span className="truncate">{curModel?.name || choice?.model || "모델"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-64">
        <div className="flex items-center gap-2 px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search models"
            className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {q.trim() ? (
          <div className="max-h-72 overflow-y-auto">
            {hits.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">맞는 모델이 없어요</div>}
            {hits.map(({ p, m }) => (
              <DropdownMenuItem key={p.id + m.id} disabled={p.status !== "ok"} onSelect={() => pick(p, m)}>
                <ProviderIcon id={p.id} className="text-muted-foreground" />
                <span className="flex-1 truncate">{m.name}</span>
                {choice?.provider === p.id && choice?.model === m.id && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}
          </div>
        ) : (
          (cat?.providers || []).map((p) =>
            p.status !== "ok" ? (
              <DropdownMenuItem key={p.id} disabled>
                <ProviderIcon id={p.id} />
                <span className="flex-1">{p.label}</span>
                <span className="text-xs">만료됨</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuSub key={p.id}>
                <DropdownMenuSubTrigger className={cn(choice?.provider === p.id && "font-medium")}>
                  <ProviderIcon id={p.id} />
                  <span className="flex-1">{p.label}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-[min(420px,70vh)] w-72 overflow-y-auto">
                  {p.models.map((m) => (
                    <DropdownMenuItem key={m.id} onSelect={() => pick(p, m)}>
                      <span className="flex-1 truncate">{m.name}</span>
                      {choice?.provider === p.id && choice?.model === m.id && <Check className="size-4" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ),
          )
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => window.open("aside://settings", "_blank")}>
          <span className="flex-1">Settings</span>
          <ArrowUpRight className="size-4" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function EffortPicker({ cat, choice, onChange, side = "top", align = "start" }: { cat: Catalog | null; choice: Choice | null; onChange: (c: Choice) => void } & PickerPlacement) {
  const m = cat?.providers.find((p) => p.id === choice?.provider)?.models.find((x) => x.id === choice?.model)
  const efforts = m?.efforts || []
  if (!choice || efforts.length <= 1) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex h-8 items-center gap-1 rounded-full px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted" aria-label="생각 수준">
          {effortLabel(choice.effort)}
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-44">
        <DropdownMenuRadioGroup value={choice.effort} onValueChange={(v) => onChange({ ...choice, effort: v })}>
          {efforts.map((e) => (
            <DropdownMenuRadioItem key={e} value={e}>
              {effortLabel(e)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
