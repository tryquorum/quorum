// iOS 설정 항목: 웹과 같은 레지스트리(@direction-board/contracts/settings-registry)에서, 웹 전용 항목은 앱 것으로 바꿔요.
import { SETTING_ITEMS, SETTINGS_SECTIONS, type SettingItem, type SettingsSection, type SettingsSectionId } from '@direction-board/contracts/settings-registry'

/** 단축키 섹션은 앱에서 "제스처"예요(앱에는 키보드 단축키가 없어요) */
export const MOBILE_SECTIONS: readonly SettingsSection[] = SETTINGS_SECTIONS.map((s) =>
  s.id === 'shortcuts' ? { id: 'shortcuts', title: '제스처', synonyms: ['gesture', 'gestures', 'swipe', '밀기', '길게 누르기', '단축키', 'shortcuts'] } : s,
)
export const MOBILE_ITEMS: readonly SettingItem[] = [
  ...SETTING_ITEMS.filter((i) => i.id !== 'shortcut-list'),
  { id: 'server-origin', title: '서버 주소', section: 'general', synonyms: ['server', 'origin', 'url', '주소', '연결', '서버'] },
  { id: 'access-login', title: 'Cloudflare Access 로그인', section: 'account', synonyms: ['login', '로그인', 'access', 'cloudflare', '만료'] },
  { id: 'gesture-list', title: '제스처 목록', section: 'shortcuts', synonyms: ['gesture', 'swipe', '밀기', '길게 누르기', '당겨서 새로고침', '단축키'] },
]
export const mobileSectionTitle = (id: SettingsSectionId) => MOBILE_SECTIONS.find((s) => s.id === id)?.title ?? id
