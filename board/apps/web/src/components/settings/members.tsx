// 설정 › 멤버·접근(파일럿 관리자) 과 설정 › 일반 › 공간 이름. 서버: apps/server/server/access.ts, spaces.ts
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"
import type { AccessResponse, Space } from "@direction-board/contracts"
import { Button } from "@/components/ui/button"
import { useSpaces } from "@/hooks/use-space"
import { ago, api, ApiError } from "@/lib/api"
import { Group, SettingRow } from "./parts"

const input = "h-8 min-w-0 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "저장하지 못했어요")

/** 워크스페이스 이름 바꾸기·추가(관리자). 이름은 사이드바 공간 고르기와 칩에 나와요 */
export function SpacesRow() {
  const { spaces, me } = useSpaces()
  const [names, setNames] = useState<Record<string, string>>({})
  const [fresh, setFresh] = useState("")
  if (me?.role === "member") return null
  const ws = spaces.filter((s) => s.kind === "workspace")
  const rename = async (s: Space) => {
    const name = (names[s.id] ?? s.name).trim()
    if (!name || name === s.name) return
    try { await api(`/api/spaces/${s.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); toast.success("이름을 바꿨어요", { description: name }) } catch (e) { fail(e) }
  }
  const add = async () => {
    const name = fresh.trim()
    if (!name) return
    try { await api("/api/spaces", { method: "POST", body: JSON.stringify({ name }) }); setFresh(""); toast.success("공간을 만들었어요", { description: name }) } catch (e) { fail(e) }
  }
  return (
    <SettingRow id="spaces" label="공간" stack info={<p>할 일마다 개인 또는 회사(워크스페이스) 공간이 있어요. 사이드바 머리에서 공간을 골라 보고, 빠른 추가·일 화면에서 공간을 정해요. 바꾼 이름은 다른 탭에도 곧 반영돼요.</p>}>
      <div className="flex flex-col gap-2">
        {ws.map((s) => (
          <form key={s.id} className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void rename(s) }}>
            <input aria-label={`${s.name} 이름`} className={input} value={names[s.id] ?? s.name} maxLength={40} onChange={(e) => setNames((v) => ({ ...v, [s.id]: e.target.value }))} />
            <Button type="submit" size="sm" variant="outline" disabled={(names[s.id] ?? s.name).trim() === s.name}>저장</Button>
          </form>
        ))}
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <input aria-label="새 공간 이름" placeholder="새 공간 이름" className={input} value={fresh} maxLength={40} onChange={(e) => setFresh(e.target.value)} />
          <Button type="submit" size="sm" variant="outline" disabled={!fresh.trim()}>추가</Button>
        </form>
      </div>
    </SettingRow>
  )
}

const ACTION_KO: Record<string, string> = { "rule.add": "허용 추가", "rule.remove": "허용 삭제", "member.update": "멤버 변경", login: "로그인", seed: "처음 설정" }

/** 허용 이메일·도메인, 멤버 역할·비활성, 감사 기록 */
export function MembersSection() {
  const { me } = useSpaces()
  const [data, setData] = useState<AccessResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState("")
  const load = useCallback(async () => {
    try { setData(await api<AccessResponse>("/api/access")); setError(null) } catch (e) { setError(e instanceof ApiError ? e.message : "불러오지 못했어요") }
  }, [])
  useEffect(() => { void load() }, [load])
  const run = async (p: Promise<AccessResponse>) => { try { setData(await p) } catch (e) { fail(e); void load() } }
  const addRule = () => {
    const v = value.trim().toLowerCase()
    if (!v) return
    void run(api<AccessResponse>("/api/access/rules", { method: "POST", body: JSON.stringify({ kind: v.includes("@") ? "email" : "domain", value: v.replace(/^@/, "") }) })).then(() => setValue(""))
  }
  const removeRule = (kind: string, v: string) => {
    if (!confirm(`${v} 허용을 지울까요? 이 규칙으로만 들어오던 사람은 다음 요청부터 막혀요.`)) return
    void run(api<AccessResponse>(`/api/access/rules?kind=${kind}&value=${encodeURIComponent(v)}`, { method: "DELETE" }))
  }
  const patch = (email: string, body: Record<string, unknown>) => void run(api<AccessResponse>(`/api/access/members/${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify(body) }))
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!data) return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  return (
    <div className="space-y-4">
      <Group>
        <SettingRow id="access-rules" label="허용 목록" stack info={<p>Google 로그인으로 들어올 수 있는 이메일과 도메인이에요. 도메인을 넣으면 그 도메인의 확인된 Google 계정은 모두 들어와요. 원본은 서버 DB 예요.</p>}>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); addRule() }}>
            <input aria-label="허용할 이메일 또는 도메인" placeholder="name@company.com 또는 company.com" className={input + " flex-1"} value={value} onChange={(e) => setValue(e.target.value)} />
            <Button type="submit" size="sm" disabled={!value.trim()}>허용</Button>
          </form>
          <ul className="divide-y rounded-lg border">
            {data.rules.map((r) => (
              <li key={r.kind + r.value} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-12 shrink-0 text-2xs text-muted-foreground">{r.kind === "domain" ? "도메인" : "이메일"}</span>
                <span className="min-w-0 flex-1 truncate">{r.kind === "domain" ? `@${r.value}` : r.value}</span>
                <span className="hidden text-2xs text-muted-foreground sm:inline">{r.addedBy === "seed" ? "처음 설정" : r.addedBy}</span>
                <Button variant="ghost" size="icon-xs" aria-label={`${r.value} 허용 지우기`} onClick={() => removeRule(r.kind, r.value)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        </SettingRow>
      </Group>
      <Group>
        <SettingRow id="access-members" label="멤버" stack info={<p>한 번이라도 들어온 사람과 미리 정한 관리자예요. 관리자는 개인 공간·운영 순회·연결·접근 관리를 써요. 비활성은 다음 요청부터 막혀요. 마지막 관리자는 강등·비활성할 수 없어요.</p>}>
          <ul className="divide-y rounded-lg border">
            {data.members.map((m) => (
              <li key={m.email} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{m.name ? `${m.name} · ` : ""}{m.email}{m.email === me?.email ? " (나)" : ""}</span>
                {!m.allowed && <span className="rounded bg-destructive/10 px-1.5 text-2xs text-destructive">허용 밖</span>}
                <span className="num text-2xs text-muted-foreground">{m.lastLoginAt ? `마지막 로그인 ${ago(m.lastLoginAt)}` : "아직 안 들어옴"}</span>
                <select aria-label={`${m.email} 역할`} value={m.role} onChange={(e) => patch(m.email, { role: e.target.value })} className="h-7 rounded-md border bg-background px-1.5 text-xs">
                  <option value="member">멤버</option><option value="admin">관리자</option>
                </select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={m.disabled} onChange={(e) => patch(m.email, { disabled: e.target.checked })} />비활성</label>
              </li>
            ))}
          </ul>
        </SettingRow>
      </Group>
      <Group>
        <SettingRow id="access-audit" label="감사 기록" stack info={<p>누가 언제 허용·역할·비활성을 바꿨는지와 로그인이 남아요(최근 100개).</p>}>
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border text-xs">
            {data.audit.map((a) => (
              <li key={a.id} className="flex gap-2 px-3 py-1.5">
                <span className="num w-28 shrink-0 text-muted-foreground">{new Date(a.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="min-w-0 flex-1 truncate">{a.actor} · {ACTION_KO[a.action] ?? a.action} · {a.target}{a.detail && a.action === "member.update" ? ` ${a.detail}` : ""}</span>
              </li>
            ))}
          </ul>
        </SettingRow>
      </Group>
    </div>
  )
}
