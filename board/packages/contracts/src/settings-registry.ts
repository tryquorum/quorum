// 설정 항목 레지스트리: 웹 설정창(#/settings)·⌘K 검색의 "설정" 묶음과 iOS 설정·검색 탭이 이 한 파일을 읽어요.
// 항목을 추가하면 웹 화면에 data-setting=<id> 앵커를 함께 둬요. 검색은 제목·동의어·섹션 이름의 부분 일치예요.
// 웹 주소(#/settings/...) 함수는 웹(apps/web/src/lib/settings-registry.ts)에 있어요.

export type SettingsSectionId = "general" | "account" | "ai" | "ops" | "connections" | "shortcuts" | "data" | "about"
export type SettingsSection = { id: SettingsSectionId; title: string; synonyms: string[] }
export type SettingItem = { id: string; title: string; section: SettingsSectionId; synonyms: string[] }

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", title: "일반", synonyms: ["general", "기본"] },
  { id: "account", title: "계정", synonyms: ["account", "profile", "로그인"] },
  { id: "ai", title: "AI", synonyms: ["인공지능", "model", "모델"] },
  { id: "ops", title: "운영 순회", synonyms: ["ops", "sweep", "운영"] },
  { id: "connections", title: "연결", synonyms: ["connections", "mcp", "integrations", "에이전트"] },
  { id: "shortcuts", title: "단축키", synonyms: ["shortcuts", "keyboard", "키보드", "hotkey"] },
  { id: "data", title: "데이터", synonyms: ["data", "storage", "저장"] },
  { id: "about", title: "정보", synonyms: ["about", "version", "버전"] },
]

export const SETTING_ITEMS: readonly SettingItem[] = [
  { id: "theme", title: "테마", section: "general", synonyms: ["theme", "dark mode", "다크 모드", "어둡게", "밝게", "light", "appearance", "화면 모드"] },
  { id: "start-view", title: "시작 화면", section: "general", synonyms: ["start", "home screen", "첫 화면", "default view", "열 때"] },
  { id: "account-email", title: "로그인 계정", section: "account", synonyms: ["email", "이메일", "me", "user", "사용자"] },
  { id: "access-path", title: "접속 경로", section: "account", synonyms: ["listener", "local", "public", "로컬", "공개", "cloudflare", "access"] },
  { id: "logout", title: "로그아웃", section: "account", synonyms: ["logout", "sign out", "log out", "나가기"] },
  { id: "default-model", title: "기본 모델", section: "ai", synonyms: ["model", "모델", "provider", "aside", "codex", "gpt", "claude"] },
  { id: "default-effort", title: "생각 수준", section: "ai", synonyms: ["effort", "reasoning", "노력", "추론"] },
  { id: "ops-schedule", title: "자동 순회 켜기·다음 시각", section: "ops", synonyms: ["ops", "sweep", "순회", "주기", "schedule", "운영", "활동 시간", "끄기"] },
  { id: "ops-model", title: "순회 모델", section: "ops", synonyms: ["ops model", "순회 모델", "sweep model", "노력", "effort"] },
  { id: "ops-runs", title: "지난 순회 결과", section: "ops", synonyms: ["runs", "history", "기록", "결과", "보고", "report", "순회"] },
  { id: "ops-prompt", title: "순회 지시문", section: "ops", synonyms: ["prompt", "지시", "내가 해야 할 모든 것", "영역", "확인할 곳", "순회"] },
  { id: "mcp-agents", title: "에이전트 연결(MCP)", section: "connections", synonyms: ["mcp", "연결", "connect", "agent", "에이전트", "claude code", "codex", "cursor", "goat", "aside", "물리기", "integration"] },
  { id: "mcp-url", title: "MCP 주소", section: "connections", synonyms: ["url", "주소", "endpoint", "mcp", "127.0.0.1", "원격", "remote"] },
  { id: "mcp-check", title: "연결 확인", section: "connections", synonyms: ["check", "test", "확인", "tools/list", "mcp"] },
  { id: "mcp-tokens", title: "연결 토큰", section: "connections", synonyms: ["token", "토큰", "bearer", "api key", "키", "secret", "폐기", "revoke"] },
  { id: "shortcut-list", title: "단축키 목록", section: "shortcuts", synonyms: ["shortcuts", "keyboard", "키보드", "단축키", "hotkey", "⌘k"] },
  { id: "data-paths", title: "DB·거울 위치", section: "data", synonyms: ["db", "database", "sqlite", "vault", "거울", "mirror", "경로", "path", "데이터"] },
  { id: "version", title: "버전·커밋", section: "about", synonyms: ["version", "commit", "버전", "커밋", "build", "정보"] },
]

export const isSettingsSection = (v: string | null | undefined): v is SettingsSectionId => SETTINGS_SECTIONS.some((s) => s.id === v)
export const sectionTitle = (id: SettingsSectionId) => SETTINGS_SECTIONS.find((s) => s.id === id)?.title ?? id

const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, " ").trim()

/** 검색어에 맞는 설정 항목. 제목·동의어가 먼저, 섹션 이름만 맞는 항목은 뒤로. iOS 는 자기 항목·섹션 이름을 넘겨요 */
export function searchSettings(
  query: string,
  limit = 8,
  items: readonly SettingItem[] = SETTING_ITEMS,
  sections: readonly SettingsSection[] = SETTINGS_SECTIONS,
): SettingItem[] {
  const q = norm(query)
  if (!q) return []
  const scored: { item: SettingItem; score: number; order: number }[] = []
  items.forEach((item, order) => {
    const section = sections.find((s) => s.id === item.section)
    const title = norm(item.title)
    let score = 0
    if (title === q) score = 4
    else if (title.includes(q)) score = 3
    else if (item.synonyms.some((s) => norm(s).includes(q))) score = 2
    else if (section && [section.title, ...section.synonyms].some((s) => norm(s).includes(q))) score = 1
    if (score) scored.push({ item, score, order })
  })
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map((s) => s.item)
}
