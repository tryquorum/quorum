// 웹 설정창 주소(#/settings/<섹션>?item=<항목>). 섹션·항목 목록과 검색은 계약 패키지(@direction-board/contracts/settings-registry)에 있어요.
// 웹에만 있는 것(파일럿 관리자의 멤버·접근 섹션, 일반 › 공간)은 여기서 더해요. iOS 설정 목록에는 나오지 않아요.
import { isSettingsSection, SETTING_ITEMS, SETTINGS_SECTIONS, type SettingItem, type SettingsSection, type SettingsSectionId } from "@direction-board/contracts/settings-registry"

export type WebSectionId = SettingsSectionId | "members"
export type WebSection = { id: WebSectionId; title: string; synonyms: string[] }
export type WebItem = { id: string; title: string; section: WebSectionId; synonyms: string[] }

const MEMBERS: WebSection = { id: "members", title: "멤버·접근", synonyms: ["members", "access", "허용", "멤버", "관리자", "admin", "도메인", "audit", "감사"] }
/** 웹 설정 섹션: 계정 다음에 멤버·접근(파일럿 관리자에게만 보여요) */
export const WEB_SECTIONS: readonly WebSection[] = SETTINGS_SECTIONS.flatMap((s): WebSection[] => (s.id === "account" ? [s, MEMBERS] : [s]))
export const WEB_ITEMS: readonly WebItem[] = [
  ...SETTING_ITEMS,
  { id: "spaces", title: "공간", section: "general", synonyms: ["space", "workspace", "워크스페이스", "회사", "개인", "공간 이름"] },
  { id: "access-rules", title: "허용 목록", section: "members", synonyms: ["allow", "허용", "도메인", "이메일", "domain", "email"] },
  { id: "access-members", title: "멤버", section: "members", synonyms: ["member", "role", "관리자", "역할", "비활성", "disable"] },
  { id: "access-audit", title: "감사 기록", section: "members", synonyms: ["audit", "log", "기록", "감사"] },
]
export const isWebSection = (v: string | null | undefined): v is WebSectionId => v === "members" || isSettingsSection(v)
export const webSectionTitle = (id: WebSectionId) => WEB_SECTIONS.find((s) => s.id === id)?.title ?? id
/** ⌘K 검색에 넘길 공용 모양(공용 검색 함수는 섹션 id 를 이름 찾기에만 써요) */
export const webSearchLists = () => ({ items: WEB_ITEMS as readonly SettingItem[], sections: WEB_SECTIONS as readonly SettingsSection[] })

/** 설정 주소. 항목이 있으면 그 항목을 강조해요: #/settings/connections?item=mcp-tokens */
export const settingsHash = (section?: WebSectionId | null, item?: string | null) =>
  `#/settings${section ? `/${section}` : ""}${item ? `?item=${encodeURIComponent(item)}` : ""}`

export function parseSettingsHash(hash: string): { section: WebSectionId | null; item: string | null } | null {
  const h = hash.replace(/^#\/?/, "")
  if (h !== "settings" && !h.startsWith("settings/") && !h.startsWith("settings?")) return null
  const [path, query = ""] = h.split("?")
  const raw = path.split("/")[1] ?? null
  const item = new URLSearchParams(query).get("item")
  return { section: isWebSection(raw) ? raw : null, item: item && WEB_ITEMS.some((i) => i.id === item) ? item : null }
}

/** 옛 주소: 운영 화면(#/ops)은 설정 › 운영 순회로 옮겼어요. 옛 링크·북마크·g o 를 그 자리로 보내요 */
export function legacySettingsHash(hash: string): string | null {
  return /^#?\/?ops(?:[?/].*)?$/.test(hash) ? settingsHash("ops") : null
}
