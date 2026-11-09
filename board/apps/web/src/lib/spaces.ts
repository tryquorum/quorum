// 공간(개인·워크스페이스) 보기와 거르기. 서버 규칙: apps/server/server/spaces.ts, 설계: docs/internals/spaces.md
import type { Board, Item, Signal, Space, SpaceId } from "@direction-board/contracts"

/** 사이드바에서 고른 공간 보기. all 은 거르지 않음 */
export type SpaceView = "all" | SpaceId
export const PERSONAL: SpaceId = "personal"

/** 옛 서버(space 를 안 줌)와 NULL 은 개인 */
export const spaceOf = (x: { space?: string | null }): SpaceId => (x.space || PERSONAL) as SpaceId

/** 할 일·목표·사건만 공간으로 거르고, 메모·글·영역·연결(보드 그림)은 그대로 둬요 */
export function filterBySpace(items: Item[], signals: Signal[], view: SpaceView): { items: Item[]; signals: Signal[] } {
  if (view === "all") return { items, signals }
  return {
    items: items.filter((i) => (i.type !== "todo" && i.type !== "goal") || spaceOf(i) === view),
    signals: signals.filter((s) => spaceOf(s) === view),
  }
}

/** 새 일을 둘 판: 워크스페이스 공간이고 회사 판이 있으면(파일럿) 회사 판, 아니면 지금 판 */
export function boardForSpace(boards: Board[], current: string | undefined, space: SpaceId): string | undefined {
  if (space === PERSONAL) return current && boards.find((b) => b.id === current)?.kind === "company" ? boards.find((b) => b.kind === "personal" && b.mine)?.id ?? current : current
  return boards.find((b) => b.kind === "company" && !b.deleted)?.id ?? current
}

export const spaceName = (spaces: Space[], id: string) => spaces.find((s) => s.id === id)?.name ?? (id === PERSONAL ? "개인" : "회사")
