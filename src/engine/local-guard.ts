// 이 맥 안에서 온 요청만 받아요. 다른 웹사이트가 사용자 브라우저를 시켜 localhost:4317 에 POST 해서
// 유료 aside exec 를 돌리는 일(CSRF·DNS rebinding)을 막아요.
// 출처: board/apps/server/server/auth.ts 의 localAuthority·localRequestAllowed (방향판 2ee6e8a) — 거의 그대로예요.
// 바꾼 점: Quorum 은 화면 이동 GET 예외가 필요 없어서 /api·/mcp 에만 걸고, 정적 파일은 검사하지 않아요.
const localAuthority = (host: string | null) => !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)

export function localRequestAllowed(req: Request): boolean {
  if (!localAuthority(req.headers.get("host"))) return false
  const site = req.headers.get("sec-fetch-site")?.toLowerCase() || ""
  const otherSite = site === "cross-site" || site === "same-site"
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return !otherSite
  const origin = req.headers.get("origin")
  if (origin !== null) {
    try {
      const parsed = new URL(origin)
      return parsed.protocol === "http:" && parsed.origin === origin && localAuthority(parsed.host)
    } catch { return false }
  }
  return !otherSite
}
