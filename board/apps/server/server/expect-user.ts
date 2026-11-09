// 시작 범위 주체 확인(PR #39 리뷰 17). 웹 빠른 추가·iOS 범위 고정 클라이언트는 쓰기 요청에 시작 범위의 로그인 주체를
// X-Direction-Expect-User 로 밝혀요. 서버가 이미 정한 지금 주체(Access 이메일·파일럿 Google 세션·Bearer 토큰 주인 — 기존 인증 함수 결과)와
// 다르면 쓰기 0건으로 409 {"error":"scope-changed"}. 헤더가 없으면(MCP·REST·운영 순회·옛 클라이언트) 지금 동작 그대로예요.
export const EXPECT_USER_HEADER = "x-direction-expect-user"

/** 읽기(GET·HEAD)는 보지 않아요. 헤더가 있는 쓰기만, 대소문자·앞뒤 공백 무시하고 비교 */
export function scopeChanged(req: Request, email: string): boolean {
  if (req.method === "GET" || req.method === "HEAD") return false
  const want = req.headers.get(EXPECT_USER_HEADER)
  if (want === null) return false
  return want.trim().toLowerCase() !== email.trim().toLowerCase()
}

/**
 * 파일럿: 본문을 받기 전(admitBody 앞)에 머리와 세션·토큰 주체만으로 판정해요(리뷰 18 P2). 본문 상한·시간 제한(413·408)보다 먼저 409 scope-changed.
 * who 는 기존 인증 함수(Bearer 면 auth.who, 아니면 pilot.user)를 그대로 불러요. 머리가 없거나 읽기·/api 밖이면 false(뒤의 관문이 그대로 봐요)
 */
export async function scopeChangedEarly(req: Request, url: URL, who: () => Promise<{ email: string } | null> | { email: string } | null): Promise<boolean> {
  if (!url.pathname.startsWith("/api/") || req.method === "GET" || req.method === "HEAD" || !req.headers.has(EXPECT_USER_HEADER)) return false
  const u = await who()
  return !!u && scopeChanged(req, u.email)
}
