// 연결 오류 카드에 무엇을 보일지(GAP-27): 이유 한 줄, 지금 주소, 설정으로 갈지. 화면 없이 시험해요.
import { ApiError, errorMessage } from './client'

export type ConnectionHelp = { reason: string; address: string; loginFirst: boolean; offerSettings: boolean }

/** 로그인이 필요하면 로그인 안내가 먼저이고 주소를 바꾸라고 하지 않아요. 그 밖의 실패는 주소가 틀렸을 수 있으니 설정으로 가는 길을 보여요 */
export function connectionHelp(error: unknown, origin: string): ConnectionHelp {
  const loginFirst = error instanceof ApiError && error.loginRequired
  let address = origin
  try {
    address = new URL(origin).host || origin
  } catch {
    /* 주소를 읽을 수 없으면 적힌 그대로 */
  }
  return { reason: errorMessage(error), address, loginFirst, offerSettings: !loginFirst }
}
