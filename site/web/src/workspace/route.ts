// 주소(해시) ↔ 화면. 출처: board/apps/web/src/lib/document-route.ts·App.tsx 의 "#/w/<ref> 로 상세를 열어 뒤로가기로 닫기" 방식.
// Workspace 판: #/<보기>[?open=i:<id>|s:<id>] , 목표는 #/goal/<id>. 팝업이 주소에 있어서 뒤로가기로 닫히고, 주소로 다시 열려요.
import type { View } from "./ws-sidebar"

export type OpenRef = { kind: "item" | "signal"; id: string }
export type Route = { view: View; goal?: string; open?: OpenRef }
const VIEWS = ["now", "inbox", "goals", "signals", "list"] as const
const ID = /^[A-Za-z0-9_-]{1,80}$/

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "")
  const [path, query = ""] = raw.split("?")
  const p = path.split("/")
  const base: Route = p[0] === "goal" && p[1] && ID.test(p[1]) ? { view: "goals", goal: p[1] } : { view: (VIEWS as readonly string[]).includes(p[0]) ? (p[0] as View) : "now" }
  const m = /(?:^|&)open=([is]):([^&]+)/.exec(query)
  if (m && ID.test(m[2])) base.open = { kind: m[1] === "i" ? "item" : "signal", id: m[2] }
  return base
}

export function hashFor(r: Route): string {
  const path = r.goal ? "/goal/" + r.goal : "/" + r.view
  return "#" + path + (r.open ? "?open=" + (r.open.kind === "item" ? "i" : "s") + ":" + r.open.id : "")
}
