// 검색(웹 ⌘K, iOS 검색 탭)의 할 일·목표·사건 결과. 고르기·정렬·자르기 규칙을 두 앱이 같이 써요.
// 화면 묶음·명령·설정·문서는 화면마다 다르게 그려서 각 앱에 있어요.
import type { Board, Item, Signal } from "./api.ts"
import { compareWorkOrder } from "./order.ts"

export type PaletteEntry = { id: string; ref: string; label: string; hint: string; keywords: string[] }
export type WorkEntry = PaletteEntry & { kind: "todo" | "goal"; done: boolean }
export type EventEntry = PaletteEntry & { open: boolean }

/** 검색어가 있을 때 묶음마다 보이는 최대 수, 없을 때(안 끝난 일·열린 사건) 수 */
export const PALETTE_LIMIT = 30
export const PALETTE_DEFAULT_LIMIT = 8

/** 소문자로 바꾼 검색어 q 가 이름이나 키워드에 들어 있으면 참. 빈 검색어는 모두 */
export const paletteMatch = (r: Pick<PaletteEntry, "label" | "keywords">, q: string) =>
  !q || r.label.toLocaleLowerCase().includes(q) || r.keywords.some((k) => !!k && k.toLocaleLowerCase().includes(q))

/** 지워지지 않은 할 일·목표를 공용 정렬(compareWorkOrder)로. ref 는 item:<판>:<id> */
export function workEntries(items: Item[], boards: Board[]): WorkEntry[] {
  const boardName = new Map(boards.map((b) => [b.id, b.name]))
  return items
    .filter((i) => !i.deleted && (i.type === "todo" || i.type === "goal"))
    .sort((a, b) => compareWorkOrder(a, b))
    .map((i) => {
      const goal = i.type === "goal"
      const board = boardName.get(i.boardId)
      return {
        id: "item:" + i.boardId + ":" + i.id,
        ref: "item:" + i.boardId + ":" + i.id,
        label: (i.text || "제목 없는 일").split("\n")[0],
        hint: [board, goal ? "목표" : "할 일", i.done ? "끝냄" : ""].filter(Boolean).join(" · "),
        keywords: [board || "", goal ? "목표" : "할 일 미리알림", i.area || ""],
        kind: goal ? "goal" : "todo",
        done: !!i.done,
      }
    })
}

/** 사건: 열린 것 먼저, 그 안에서 최근 바뀐 순. ref 는 사건이 가리키는 일(meta.work)이 있으면 그 일, 없으면 signal:<id> */
export function eventEntries(signals: Signal[]): EventEntry[] {
  return [...signals]
    .sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open") || Number(b.updated_at ?? 0) - Number(a.updated_at ?? 0))
    .map((s) => {
      const work = s.meta && typeof s.meta.work === "string" && s.meta.work ? s.meta.work : "signal:" + s.id
      return {
        id: "signal:" + s.id,
        ref: work,
        label: s.title || "제목 없는 사건",
        hint: [s.source, s.status === "open" ? "" : "끝남"].filter(Boolean).join(" · "),
        keywords: ["사건", s.source, s.area || "", s.body || ""],
        open: s.status === "open",
      }
    })
}

/** 검색어가 있으면 맞는 것 30개, 없으면 안 끝난 일 8개 */
export const pickWork = <T extends WorkEntry>(entries: T[], q: string): T[] =>
  q ? entries.filter((r) => paletteMatch(r, q)).slice(0, PALETTE_LIMIT) : entries.filter((r) => !r.done).slice(0, PALETTE_DEFAULT_LIMIT)

/** 검색어가 있으면 맞는 것 30개, 없으면 열린 사건 8개 */
export const pickEvents = <T extends EventEntry>(entries: T[], q: string): T[] =>
  q ? entries.filter((r) => paletteMatch(r, q)).slice(0, PALETTE_LIMIT) : entries.filter((r) => r.open).slice(0, PALETTE_DEFAULT_LIMIT)
