import { useCallback, useEffect, useRef, useState } from "react"
import { makeRunner, newLife } from "@/hooks/use-data"
import { ApiError, api, type Run } from "@/lib/api"

export type RunWatch = {
  unread: number
  permission: NotificationPermission | "unsupported"
  enabled: boolean
  enableNotifications: () => Promise<void>
  disableNotifications: () => void
  clearUnread: () => void
}
const permission = (): NotificationPermission | "unsupported" => typeof Notification === "undefined" ? "unsupported" : Notification.permission
const readEnabled = () => {
  try { return localStorage.getItem("db:notifications") === "on" && permission() === "granted" } catch { return false }
}
const saveEnabled = (value: boolean) => {
  try { localStorage.setItem("db:notifications", value ? "on" : "off") } catch { /* 저장 불가 */ }
}

export function useRunWatch(): RunWatch {
  const [unread, setUnread] = useState(0)
  const [permissionState, setPermissionState] = useState(permission)
  const [enabled, setEnabled] = useState(readEnabled)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const clearUnread = useCallback(() => setUnread(0), [])
  const disableNotifications = useCallback(() => {
    enabledRef.current = false
    setEnabled(false)
    saveEnabled(false)
  }, [])
  const enableNotifications = useCallback(async () => {
    if (typeof Notification === "undefined") { setPermissionState("unsupported"); return }
    try {
      const next = await Notification.requestPermission()
      setPermissionState(next)
      const on = next === "granted"
      enabledRef.current = on
      setEnabled(on)
      saveEnabled(on)
    } catch { disableNotifications(); setPermissionState(permission()) }
  }, [disableNotifications])
  useEffect(() => {
    const life = newLife("runwatch")
    let previous: Map<string, Run["status"]> | null = null
    let running = false
    // 파일럿 멤버처럼 AI 실행을 못 쓰는 사람(403)은 더 묻지 않아요
    let forbidden = false
    const notified = new Set<string>()
    const runner = makeRunner(life, async () => {
      try {
        const { runs } = await api<{ runs: Run[] }>("/api/runs", { signal: AbortSignal.timeout(10000) })
        if (!life.alive) return
        const chats = runs.filter((run) => run.kind === "chat")
        const next = new Map(chats.map((run) => [run.id, run.status]))
        if (previous) for (const run of chats) {
          if (previous.get(run.id) !== "running" || (run.status !== "done" && run.status !== "error") || notified.has(run.id)) continue
          notified.add(run.id)
          if (!document.hidden) continue
          setUnread((n) => n + 1)
          if (enabledRef.current && permission() === "granted") {
            try { new Notification("방향판", { body: run.status === "done" ? "맡긴 일이 끝났어요" : "맡긴 일을 마치지 못했어요", tag: `direction-board:${run.id}` }) } catch { /* 제목 배지는 유지 */ }
          }
        }
        previous = next
        running = chats.some((run) => run.status === "running")
      } catch (e) { if (e instanceof ApiError && e.status === 403) forbidden = true /* 그 밖에는 마지막 성공 snapshot 유지 */ }
    }, (r) => { if (!forbidden) r.schedule(running ? 2000 : 5000) })
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        clearUnread()
        const next = permission()
        setPermissionState(next)
        if (next !== "granted") disableNotifications()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    void runner.run()
    return () => { life.alive = false; runner.dispose(); document.removeEventListener("visibilitychange", onVisibility) }
  }, [clearUnread, disableNotifications])
  return { unread, permission: permissionState, enabled, enableNotifications, disableNotifications, clearUnread }
}
