export type RunErrorKind = "interrupted" | "aside_offline" | "launch" | "auth" | "rate_limit" | "model" | "network" | "unknown"
export function classifyRunError(message: string, context: { interrupted?: boolean; spawnError?: boolean } = {}): RunErrorKind {
  if (context.interrupted) return "interrupted"
  if (/profile .* is not connected to the daemon|daemon (is )?not running|ECONNREFUSED/i.test(message)) return "aside_offline"
  if (context.spawnError && /\b(ENOENT|EACCES)\b/i.test(message)) return "launch"
  if (/\b(401|403)\b.*(unauthori|forbidden|http)|http.*\b(401|403)\b|unauthorized|authentication|token expired|login/i.test(message)) return "auth"
  if (/\b429\b.*(rate.limit|quota|http)|http.*\b429\b|rate.limit|quota|usage limit/i.test(message)) return "rate_limit"
  if (/unknown model|model not found|unsupported model/i.test(message)) return "model"
  if (/ETIMEDOUT|ECONNRESET|ENOTFOUND|network|fetch failed/i.test(message)) return "network"
  return "unknown"
}
export const RUN_ERROR_MESSAGE: Record<RunErrorKind, string> = {
  interrupted: "서버가 다시 시작돼서 멈췄어요. 결과를 확인하고 다시 시도해 주세요",
  aside_offline: "Aside 브라우저가 꺼져 있어요. Aside 앱을 열고 다시 시도해 주세요",
  launch: "Aside 실행 파일을 찾지 못했어요. 설치와 권한을 확인해 주세요",
  auth: "로그인이 풀렸어요. Aside 설정에서 다시 연결해 주세요",
  rate_limit: "사용 한도에 걸렸어요. 잠시 뒤 다시 시도하거나 다른 모델을 골라 주세요",
  model: "고른 모델을 쓸 수 없어요. 다른 모델로 다시 시도해 주세요",
  network: "연결이 끊겼어요. 인터넷을 확인하고 다시 시도해 주세요",
  unknown: "실행을 마치지 못했어요. 자세히를 열어 원인을 보고 다시 시도해 주세요",
}
