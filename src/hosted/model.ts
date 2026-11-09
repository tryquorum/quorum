// 선택: 비소유자 봇 의견을 서버의 모델 API 로 돌려요(QUORUM_GUEST_BOTS=api). OpenAI 호환 chat completions 한 번, 도구 없음.
// 이 맥의 파일·브라우저·MCP 설정에 닿는 길이 없어요(codex exec 와 다른 점). 키는 서버 환경 변수에만 있고 응답·로그에 쓰지 않아요.
export type ModelConfig = { url: string; key: string; model: string; fetch?: typeof fetch; timeoutMs?: number }

export function modelFromEnv(env: Record<string, string | undefined>): ModelConfig | null {
  const url = env.QUORUM_GUEST_MODEL_URL?.trim(), key = env.QUORUM_GUEST_MODEL_KEY?.trim(), model = env.QUORUM_GUEST_MODEL?.trim()
  return url && key && model ? { url, key, model } : null
}

/** 의견 한 번. 답이 JSON 이 아니어도 그대로 돌려주고(엔진이 읽어요), HTTP 오류·빈 답은 실패로 올려요 */
export function modelAsk(c: ModelConfig): (prompt: string) => Promise<string> {
  const get = c.fetch ?? fetch
  return async (prompt) => {
    const res = await get(c.url.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + c.key },
      body: JSON.stringify({ model: c.model, temperature: 0.2, max_tokens: 1200, messages: [
        { role: "system", content: "You are one member of a review council. You have no tools and cannot browse. Reply with exactly one JSON object as asked, nothing else." },
        { role: "user", content: prompt },
      ] }),
      signal: AbortSignal.timeout(c.timeoutMs ?? 90_000),
    })
    if (!res.ok) throw new Error("model API returned HTTP " + res.status)
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null
    const text = body?.choices?.[0]?.message?.content
    if (typeof text !== "string" || !text.trim()) throw new Error("model API returned an empty answer")
    return text
  }
}
