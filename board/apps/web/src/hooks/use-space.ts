// 공간 보기 상태(db:space)와 공간 목록·내 역할을 화면 어디서나 읽게 해요. App 이 값을 만들고 넣어요
import { createContext, useContext } from "react"
import type { Me, Space } from "@direction-board/contracts"
import type { SpaceView } from "@/lib/spaces"

export type SpaceCtx = { spaces: Space[]; view: SpaceView; setView: (v: SpaceView) => void; me: Me | null }
export const SpaceContext = createContext<SpaceCtx>({ spaces: [], view: "all", setView: () => {}, me: null })
export const useSpaces = () => useContext(SpaceContext)
/** 파일럿 멤버(회사 공간만). 개인 방향판(Access)은 role 이 없어 늘 관리자 */
export const useIsMember = () => useContext(SpaceContext).me?.role === "member"
