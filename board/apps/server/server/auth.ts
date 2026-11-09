import { timingSafeEqual } from "node:crypto";

export type Listener = "local" | "public";
export type User = { id: string; email: string; agent: boolean };
type AuthConfig = {
  team: string; aud: string; allowed: string[]; agentToken: string; agentOwner: string;
  devLocalUser: string; host: string; fetch?: typeof globalThis.fetch; now?: () => number;
};

export function normalizeTeam(team: string): string {
  const name = team.trim().replace(/^https:\/\//i, "").replace(/\/+$/, "");
  return name.includes(".") ? name : `${name}.cloudflareaccess.com`;
}
export function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Authorization 의 Bearer 값. 인증 방식 이름은 대소문자를 가리지 않아요(RFC 9110). Bearer 가 아니면 null */
export function bearerValue(req: Request): string | null {
  const m = /^bearer[ 	]+(.+)$/i.exec(req.headers.get("authorization") || "");
  return m ? m[1].trim() : null;
}
/** 루프백 바인드에서 이 서버에 닿는 주소의 host 부분. ::1 이면 [::1], localhost 는 그대로, 그 밖(127.0.0.1·0.0.0.0 등)은 127.0.0.1 */
export function loopbackAuthority(host: string): string {
  const h = host.toLowerCase();
  return h === "::1" || h === "[::1]" ? "[::1]" : h === "localhost" ? "localhost" : "127.0.0.1";
}
export const isLoopbackHost = (host: string) => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host.toLowerCase());
const localAuthority = (host: string | null) => !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

export function localRequestAllowed(req: Request): boolean {
  if (!localAuthority(req.headers.get("host"))) return false;
  const site = req.headers.get("sec-fetch-site")?.toLowerCase() || "";
  const otherSite = site === "cross-site" || site === "same-site";
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (!otherSite) return true;
    // 다른 사이트에서 온 GET 은 화면 이동(링크로 보드 열기)만 허용한다. API·MCP 는 GET 이어도 상태를 바꿀 수 있어 막는다
    const path = new URL(req.url).pathname;
    return req.method === "GET" && req.headers.get("sec-fetch-mode")?.toLowerCase() === "navigate" && !path.startsWith("/api/") && path !== "/mcp";
  }
  const origin = req.headers.get("origin");
  if (origin !== null) {
    try {
      const parsed = new URL(origin);
      return parsed.protocol === "http:" && parsed.origin === origin && localAuthority(parsed.host);
    } catch { return false; }
  }
  return !otherSite;
}

export function createAuth(config: AuthConfig) {
  const team = normalizeTeam(config.team);
  const now = config.now || Date.now;
  const get = config.fetch || globalThis.fetch;
  let certs: { keys: JsonWebKey[] } | null = null;
  let certsAt = 0;
  let lastFetchAt: number | null = null;
  let fetching: Promise<boolean> | null = null;
  const keys = new Map<string, CryptoKey>();
  const b64u = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  function refresh(): Promise<boolean> {
    if (fetching) return fetching;
    lastFetchAt = now();
    fetching = (async () => {
      const response = await get(`https://${team}/cdn-cgi/access/certs`);
      if (!response.ok) return false;
      const body = await response.json() as { keys: JsonWebKey[] };
      if (!Array.isArray(body.keys)) return false;
      certs = body; certsAt = now(); keys.clear();
      return true;
    })().finally(() => { fetching = null; });
    return fetching;
  }
  async function accessKey(kid: string): Promise<CryptoKey | null> {
    const coolingDown = !fetching && lastFetchAt !== null && now() - lastFetchAt < 60_000;
    if (!certs || now() - certsAt >= 3600_000) {
      // 조회 실패 뒤 60초는 다시 받지 않는다. 만료된 키 목록은 새로 받기 전까지 그대로 쓴다
      if (!coolingDown) await refresh().catch(() => false);
      // 갱신이 계속 실패해도 오래된 키 목록은 받은 뒤 12시간까지만 쓴다(철회된 키를 무기한 믿지 않도록)
      if (!certs || now() - certsAt >= 12 * 3600_000) return null;
    } else if (!certs.keys.some(k => (k as JsonWebKey & { kid?: string }).kid === kid) &&
      (fetching || lastFetchAt === null || now() - lastFetchAt >= 60_000)) {
      if (!await refresh().catch(() => false)) return null;
    }
    if (keys.has(kid)) return keys.get(kid)!;
    const jwk = certs?.keys.find(k => (k as JsonWebKey & { kid?: string }).kid === kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    keys.set(kid, key);
    return key;
  }
  async function verifyAccessJwt(token: string): Promise<string | null> {
    try {
      const parts = token.split(".");
      if (parts.length !== 3 || parts.some(p => !p || !/^[A-Za-z0-9_-]+$/.test(p))) return null;
      const [h, p, s] = parts;
      const header = JSON.parse(new TextDecoder().decode(b64u(h)));
      const payload = JSON.parse(new TextDecoder().decode(b64u(p)));
      if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
      if (!config.aud || !(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(config.aud)) return null;
      if (payload.iss !== `https://${team}` || typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp * 1000 <= now()) return null;
      if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf * 1000 > now())) return null;
      if (typeof payload.email !== "string" || !payload.email) return null;
      const key = await accessKey(header.kid);
      if (!key || !await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(s), new TextEncoder().encode(`${h}.${p}`))) return null;
      return payload.email.toLowerCase();
    } catch { return null; }
  }
  function agent(req: Request): User | null {
    const value = bearerValue(req);
    return value !== null && config.agentToken && safeEq(value, config.agentToken)
      ? { id: "agent", email: config.agentOwner, agent: true } : null;
  }
  async function who(req: Request, listener: Listener): Promise<User | null> {
    const bearer = agent(req);
    if (bearer) return bearer;
    if (listener === "local" && config.devLocalUser && isLoopbackHost(config.host))
      return { id: config.devLocalUser, email: config.devLocalUser, agent: false };
    let jwt = req.headers.get("cf-access-jwt-assertion");
    if (!jwt) {
      const value = (req.headers.get("cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
      try { jwt = value ? decodeURIComponent(value) : null; } catch { return null; }
    }
    if (!jwt) return null;
    const email = await verifyAccessJwt(jwt);
    if (!email || ((listener === "public" || config.allowed.length > 0) && !config.allowed.includes(email))) return null;
    return { id: email, email, agent: false };
  }
  return { who, agent, verifyAccessJwt };
}

export function publicCsrfAllowed(req: Request, origin: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const supplied = req.headers.get("origin");
  return supplied !== null ? supplied === origin : req.headers.get("sec-fetch-site")?.toLowerCase() !== "cross-site";
}
// 시작 범위 주체 확인(리뷰 17)은 인증 결과(u.email)를 쓰는 마지막 관문이라 여기서 함께 내보내요
export { scopeChanged, scopeChangedEarly } from "./expect-user.ts";
