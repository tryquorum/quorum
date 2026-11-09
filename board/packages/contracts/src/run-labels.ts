// AI 실행을 사람 말로: 도구 이름, 실패 안내, 상태. 웹 실행 보기(run-view)와 iOS 대화 화면이 같은 문구를 써요.
import type { ErrorKind, Run } from "./api.ts"

export const TOOL_KO: Record<string, string> = {
  memory_search: "기억 찾기", read_file: "파일 읽기", websearch: "웹 검색", webfetch: "웹 페이지 읽기", repl: "브라우저 조작", bash: "명령 실행",
  history_search: "방문 기록 찾기", write_file: "파일 쓰기", edit_file: "파일 고치기", subagent: "보조 에이전트", ask_user_question: "질문",
}
export const toolLabel = (tool: string) => TOOL_KO[tool] ?? tool

export type ErrorGuide = { title: string; guidance: string; action: string }
export const ERROR_GUIDE: Record<ErrorKind, ErrorGuide> = {
  interrupted: { title: "서버 재시작", guidance: "서버가 다시 시작돼서 멈췄어요. 결과를 확인하고 다시 시도해 주세요", action: "결과 확인 후 다시 시도" },
  aside_offline: { title: "Aside 연결 끊김", guidance: "Aside 브라우저가 꺼져 있어요. Aside 앱을 열고 다시 시도해 주세요", action: "Aside 실행 후 다시 시도" },
  launch: { title: "Aside 실행 실패", guidance: "Aside 실행 파일을 찾지 못했어요. 설치와 권한을 확인해 주세요", action: "설치와 권한 확인" },
  auth: { title: "로그인 필요", guidance: "로그인이 풀렸어요. Aside 설정에서 다시 연결해 주세요", action: "Aside 설정에서 다시 연결" },
  rate_limit: { title: "사용 한도", guidance: "사용 한도에 걸렸어요. 잠시 뒤 다시 시도하거나 다른 모델을 골라 주세요", action: "잠시 뒤 다시 시도하거나 다른 모델 선택" },
  model: { title: "모델 사용 불가", guidance: "고른 모델을 쓸 수 없어요. 다른 모델로 다시 시도해 주세요", action: "다른 모델 선택" },
  network: { title: "연결 끊김", guidance: "연결이 끊겼어요. 인터넷을 확인하고 다시 시도해 주세요", action: "인터넷 확인 후 다시 시도" },
  unknown: { title: "실행 실패", guidance: "실행을 마치지 못했어요. 자세히를 열어 원인을 보고 다시 시도해 주세요", action: "자세히 확인 후 다시 시도" },
}
export const errorGuide = (kind: string | null | undefined): ErrorGuide => (kind && Object.hasOwn(ERROR_GUIDE, kind) ? ERROR_GUIDE[kind as ErrorKind] : ERROR_GUIDE.unknown)

export const RUN_STATUS_KO: Record<Run["status"], string> = { running: "도는 중", done: "끝남", error: "실패", stopped: "멈춤" }

/** 경과 시간: 59초, 1분 5초 */
export function elapsedLabel(run: Pick<Run, "created_at" | "finished_at">, now: number): string {
  const seconds = Math.max(0, Math.floor(((run.finished_at ?? now) - run.created_at) / 1000))
  return seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`
}

/** 도는 중인데 90초 동안 새 소식이 없음 */
export const runStalled = (run: Pick<Run, "status" | "last_activity_at" | "created_at">, now: number) =>
  run.status === "running" && now - (run.last_activity_at ?? run.created_at) > 90_000


/** 몇 분 전(웹 lib/api ago 와 같은 말) */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, (now - ts) / 1e3)
  if (s < 60) return "방금"
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return `${Math.floor(s / 86400)}일 전`
}
