// 창 하나의 keydown 디스패처. 어떤 단축키인지는 lib/shortcuts.ts 의 resolveShortcut 이 정하고,
// 화면은 useShortcut(id, 처리기) 로 처리기만 둬요. 같은 id 에 처리기가 여럿이면 나중에 붙은 것(더 안쪽 화면)이 먹어요.
// 처리기가 false 를 돌려주면 처리하지 않은 것으로 보고 브라우저 기본 동작을 막지 않아요.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { resolveShortcut, screenOf } from "@/lib/shortcuts"
import { ShortcutHelp } from "@/components/shortcut-help"

type Handler = (e: KeyboardEvent) => boolean | void
type Api = { register: (id: string, handler: { current: Handler }) => () => void; openHelp: () => void }
const Ctx = createContext<Api | null>(null)

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const handlers = useRef(new Map<string, { current: Handler }[]>())
  const pendingG = useRef<number | null>(null)
  const [help, setHelp] = useState(false)
  const register = useCallback<Api["register"]>((id, handler) => {
    const list = handlers.current.get(id) ?? []
    handlers.current.set(id, [...list, handler])
    return () => handlers.current.set(id, (handlers.current.get(id) ?? []).filter((h) => h !== handler))
  }, [])
  const openHelp = useCallback(() => setHelp(true), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      const overlay = !!document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')
      const r = resolveShortcut(e, { screen: screenOf(location.hash), target, overlay, defaultPrevented: e.defaultPrevented, pendingG: pendingG.current, now: Date.now() })
      pendingG.current = r.pendingG
      if (!r.id) return
      if (r.id === "help.open") { e.preventDefault(); setHelp(true); return }
      const list = handlers.current.get(r.id)
      const top = list?.[list.length - 1]
      if (!top || top.current(e) === false) return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const value = useMemo(() => ({ register, openHelp }), [register, openHelp])
  return <Ctx.Provider value={value}>{children}<ShortcutHelp open={help} onOpenChange={setHelp} /></Ctx.Provider>
}

/** 단축키 id 에 처리기를 붙여요. enabled=false 면 붙이지 않아요 */
export function useShortcut(id: string, handler: Handler, enabled = true) {
  const api = useContext(Ctx)
  const ref = useRef(handler)
  useEffect(() => { ref.current = handler })
  useEffect(() => (api && enabled ? api.register(id, ref) : undefined), [api, id, enabled])
}
/** 단축키 도움말 열기(키보드 아이콘·팔레트) */
export function useShortcutHelp() {
  return useContext(Ctx)?.openHelp ?? (() => {})
}
