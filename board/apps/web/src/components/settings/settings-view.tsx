import { useCallback, useEffect, useRef } from "react"
import { ChevronLeft, ChevronRight, Cpu, Database, Info, Keyboard, ListChecks, Plug, SlidersHorizontal, UserRound, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { settingsHash, WEB_SECTIONS, webSectionTitle as sectionTitle, type WebSectionId as SettingsSectionId } from "@/lib/settings-registry"
import { useSettingsInfo } from "./parts"
import { AboutSection, AccountSection, AiSection, DataSection, GeneralSection, ShortcutsSection } from "./sections"
import { OpsSection } from "./ops-section"
import { ConnectionsSection } from "./connections"
import { MembersSection } from "./members"
import { useSpaces } from "@/hooks/use-space"

/** 파일럿 멤버에게 보이는 섹션(나머지는 관리자 것). 멤버·접근은 파일럿 관리자에게만 */
const MEMBER_SECTIONS: SettingsSectionId[] = ["general", "account", "shortcuts", "about"]

const ICON: Record<SettingsSectionId, typeof Cpu> = {
  general: SlidersHorizontal, account: UserRound, members: UsersRound, ai: Cpu, ops: ListChecks, connections: Plug, shortcuts: Keyboard, data: Database, about: Info,
}

/** 설정창: 1280 은 왼쪽 섹션 목록 + 오른쪽 내용, 390 은 목록(#/settings) → 상세(#/settings/<섹션>) */
export function SettingsView({ section, item }: { section: SettingsSectionId | null; item: string | null }) {
  const mobile = useIsMobile()
  const { me } = useSpaces()
  const sections = WEB_SECTIONS.filter((s) => (me?.role === "member" ? MEMBER_SECTIONS.includes(s.id) : s.id !== "members" || me?.auth === "google"))
  const active: SettingsSectionId = section ?? "general"
  const showList = !mobile || !section
  const showDetail = !mobile || !!section
  const { info, error, retry } = useSettingsInfo()
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  // 검색에서 고른 항목: 그 줄로 스크롤하고 2초 강조 + 포커스. 항목 없이 모바일 상세로 들어오면 제목에 포커스
  const highlight = useCallback((target: string) => {
    let timer = 0
    let tries = 0
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-setting="${CSS.escape(target)}"]`)
      if (!el) { if (tries++ < 20) timer = window.setTimeout(find, 100); return }
      el.scrollIntoView({ block: "center", behavior: "smooth" })
      el.setAttribute("data-highlight", "")
      const area = el.querySelector<HTMLElement>("[data-setting-control]") ?? el
      const control = area.querySelector<HTMLElement>('[role="radio"][tabindex="0"], input, select, button:not([disabled]), a[href]')
      ;(control ?? el).focus({ preventScroll: true })
      timer = window.setTimeout(() => el.removeAttribute("data-highlight"), 2000)
    }
    find()
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    const first = firstRender.current
    firstRender.current = false
    if (item) return highlight(item)
    if (!first && mobile && section) heading.current?.focus({ preventScroll: true })
  }, [section, item, mobile, info, highlight])
  useEffect(() => {
    let cancel: (() => void) | undefined
    const on = (e: Event) => { cancel?.(); const target = (e as CustomEvent<string>).detail; if (typeof target === "string") cancel = highlight(target) }
    window.addEventListener("settings:focus", on)
    return () => { window.removeEventListener("settings:focus", on); cancel?.() }
  }, [highlight])

  const body = () => {
    if (active === "general") return <GeneralSection />
    if (active === "ai") return <AiSection />
    if (active === "ops") return <OpsSection />
    if (active === "shortcuts") return <ShortcutsSection />
    if (active === "members") return <MembersSection />
    if (!info) return error
      ? <div role="alert" className="flex items-center gap-3 rounded-xl border p-4 text-sm"><span className="flex-1">서버 설정 정보를 불러오지 못했어요</span><Button variant="outline" size="sm" onClick={retry}>다시 불러오기</Button></div>
      : <p aria-busy="true" className="text-sm text-muted-foreground">불러오는 중이에요</p>
    if (active === "account") return <AccountSection info={info} />
    if (active === "connections") return <ConnectionsSection info={info} />
    if (active === "data") return <DataSection info={info} />
    return <AboutSection info={info} />
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl gap-8 px-4 pt-6 pb-24 md:px-8">
      {showList && (
        <nav aria-label="설정 섹션" className={cn(mobile ? "w-full" : "w-48 shrink-0")}>
          {mobile
            ? <h1 tabIndex={-1} data-page-title className="mb-4 text-xl font-semibold tracking-tight outline-none">설정</h1>
            : <p className="mb-3 px-2 text-xs font-medium text-muted-foreground">설정</p>}
          <ul className={cn(mobile ? "divide-y rounded-xl border bg-card" : "space-y-0.5")}>
            {sections.map((s) => {
              const Icon = ICON[s.id]
              const current = !mobile && s.id === active
              return (
                <li key={s.id}>
                  <a href={settingsHash(s.id)} aria-current={current ? "page" : undefined}
                    className={cn("flex items-center gap-2.5 rounded-md px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      mobile ? "h-12 px-3" : "h-8 text-muted-foreground hover:bg-muted hover:text-foreground",
                      current && "bg-muted font-medium text-foreground")}>
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1">{s.title}</span>
                    {mobile && <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>
      )}
      {showDetail && (
        <section aria-labelledby="settings-heading" className="min-w-0 flex-1">
          {mobile && <a href={settingsHash()} className="mb-2 -ml-1 inline-flex items-center gap-0.5 rounded px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="size-4" aria-hidden />설정</a>}
          <h1 id="settings-heading" ref={heading} tabIndex={-1} data-page-title className="mb-4 text-xl font-semibold tracking-tight outline-none">{sectionTitle(active)}</h1>
          {body()}
        </section>
      )}
    </div>
  )
}
