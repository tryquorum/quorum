import { useCallback, useEffect, useState } from "react"
import { KeyRound, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ago, api } from "@/lib/api"
import { TOKEN_ENV } from "@direction-board/contracts/mcp-snippets"
import type { McpToken, McpTokenCreated, McpTokenList, SettingsInfo } from "@direction-board/contracts/settings"
import { CodeBlock, SettingRow } from "./parts"

/** 연결 토큰: 에이전트마다 하나. 원문은 만들 때 한 번만 보여요(docs/internals/mcp-tokens.md) */
export function TokensRow({ info }: { info: SettingsInfo }) {
  const allowed = info.macOwner && !info.me.agent
  const [tokens, setTokens] = useState<McpToken[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<McpTokenCreated | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setTokens((await api<McpTokenList>("/api/mcp-tokens")).tokens); setLoadError(false) }
    catch { setLoadError(true) }
  }, [])
  useEffect(() => { if (allowed) void load() }, [allowed, load])
  useEffect(() => { if (!confirming) return; const t = setTimeout(() => setConfirming(null), 4000); return () => clearTimeout(t) }, [confirming])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const made = await api<McpTokenCreated>("/api/mcp-tokens", { method: "POST", body: JSON.stringify({ name }) })
      setCreated(made)
      setName("")
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : "만들지 못했어요") }
    finally { setBusy(false) }
  }
  const revoke = async (t: McpToken) => {
    if (confirming !== t.id) { setConfirming(t.id); return }
    setConfirming(null)
    try {
      await api(`/api/mcp-tokens/${t.id}`, { method: "DELETE" })
      if (created?.token.id === t.id) setCreated(null)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : "폐기하지 못했어요") }
  }
  const active = tokens?.filter((t) => t.revokedAt === null) ?? []
  const revoked = tokens?.filter((t) => t.revokedAt !== null) ?? []

  return (
    <SettingRow id="mcp-tokens" label="연결 토큰" stack info={<>
      <p>에이전트마다 하나씩 만들고, 그 에이전트를 끊을 때 폐기해요. 원문은 만들 때 한 번만 보여요. 서버는 해시만 저장해요.</p>
      <p>토큰은 /mcp 에만 통하고 다른 API 에는 쓰이지 않아요. 원격으로 붙일 때는 Cloudflare Access 서비스 토큰도 함께 필요해요.</p>
    </>}>
      {!allowed ? <p className="text-sm text-muted-foreground">맥 주인만 토큰을 만들고 폐기할 수 있어요</p> : (
        <div className="space-y-3">
          <form onSubmit={(e) => void create(e)} className="flex flex-wrap gap-2">
            <Input aria-label="토큰 이름" placeholder="이름 (예: 노트북 Codex)" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="h-8 max-w-xs flex-1" />
            <Button type="submit" size="sm" disabled={!name.trim() || busy}><KeyRound />만들기</Button>
          </form>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {created && (
            <div role="status" className="space-y-2 rounded-lg border border-warn/40 bg-warn/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium"><TriangleAlert className="size-4 text-warn-foreground" aria-hidden />"{created.token.name}" 토큰은 지금만 보여요. 복사해 두세요</p>
              <CodeBlock label="셸에 넣기" code={`export ${TOKEN_ENV}=${created.secret}`} />
              <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => setCreated(null)}>다 복사했어요</Button></div>
            </div>
          )}
          {loadError ? <p className="text-sm text-muted-foreground">목록을 불러오지 못했어요 <Button variant="link" size="sm" onClick={() => void load()}>다시</Button></p>
            : tokens === null ? <p className="text-sm text-muted-foreground">불러오는 중이에요</p>
            : active.length === 0 ? <p className="text-sm text-muted-foreground">아직 만든 토큰이 없어요</p>
            : (
              <ul className="divide-y rounded-lg border">
                {active.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.name}</span>
                      <span className="block text-xs text-muted-foreground"><code className="font-mono">{t.prefix}…</code> · 만듦 {ago(t.createdAt)} · {t.lastUsedAt ? `마지막 사용 ${ago(t.lastUsedAt)}` : "아직 안 씀"}</span>
                    </span>
                    <Button variant={confirming === t.id ? "destructive" : "ghost"} size="sm" aria-label={`${t.name} 토큰 폐기`} onClick={() => void revoke(t)}>{confirming === t.id ? "한 번 더 누르면 폐기" : "폐기"}</Button>
                  </li>
                ))}
              </ul>
            )}
          {revoked.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">폐기한 토큰 {revoked.length}개</summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {revoked.map((t) => <li key={t.id}>{t.name} · <code className="font-mono">{t.prefix}…</code> · 폐기 {ago(t.revokedAt ?? t.createdAt)}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </SettingRow>
  )
}
