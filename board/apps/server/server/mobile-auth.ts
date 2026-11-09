import type { Listener, User } from "./auth.ts";

/** 앱이 ASWebAuthenticationSession 으로 기다리는 콜백. 요청 파라미터로 바꿀 수 없어요 */
export const MOBILE_AUTH_CALLBACK = "direction://auth";
const STATE = /^[A-Za-z0-9_-]{32,128}$/;

const reject = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

/**
 * GET /api/mobile/auth: Cloudflare Access 가 로그인시킨 사람에게만, Access 가 붙인 앱 토큰을 iOS 앱 콜백으로 넘겨요.
 * 앱은 이 토큰을 cf-access-token 헤더로 보내요. 로컬 리스너·에이전트 Bearer·쿠키만 있는 요청은 넘기지 않아요.
 */
export async function mobileAuthResponse(
  req: Request, url: URL, user: User | null, listener: Listener,
  verify: (token: string) => Promise<string | null>,
): Promise<Response> {
  if (req.method !== "GET") return reject(405, "method not allowed");
  if (listener !== "public") return reject(403, "mobile login only through Cloudflare Access");
  if (!user) return reject(401, "login required (Cloudflare Access)");
  if (user.agent) return reject(403, "agent tokens cannot start a mobile login");
  const token = req.headers.get("cf-access-jwt-assertion");
  // who() 가 이 헤더로 사람을 인증했지만, 넘기는 값 자체를 다시 검증해 같은 사람인지 묶어요
  if (!token || await verify(token) !== user.email) return reject(401, "Cloudflare Access token missing");
  const states = url.searchParams.getAll("state");
  if (states.length !== 1 || !STATE.test(states[0])) return reject(400, "invalid state");
  const target = new URL(MOBILE_AUTH_CALLBACK);
  target.searchParams.set("state", states[0]);
  target.searchParams.set("token", token);
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
