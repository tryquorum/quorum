// 딥링크(direction://). 웹 주소(#/w/<ref>, #/docs/<ref>)와 같은 모양이에요. 설계: docs/internals/mobile-ia.md 의 "딥링크".
export const PREFIXES = ['direction://']

/** 로그인 콜백(direction://auth?state&token)은 로그인 창이 받는 것이라 내비게이션이 받지 않아요 */
export const isAuthCallback = (url: string) => /^direction:\/\/auth(?:[/?#]|$)/i.test(url)

/** initialRouteName 으로 상세 아래에 탭 루트를 깔아서, 링크로 연 상세에서도 뒤로가 탭 루트로 가요 */
export const linkingConfig = {
  initialRouteName: 'Tabs' as const,
  screens: {
    Tabs: {
      screens: {
        HomeTab: { initialRouteName: 'Home' as const, screens: { Home: 'home', Work: 'w/:ref' } },
        ListTab: { initialRouteName: 'List' as const, screens: { List: 'list' } },
        DocsTab: { initialRouteName: 'Docs' as const, screens: { Docs: 'docs', Doc: 'docs/:ref' } },
        AiTab: { initialRouteName: 'Chat' as const, screens: { Chat: 'ai' } },
        SearchTab: { initialRouteName: 'Search' as const, screens: { Search: 'search' } },
      },
    },
    // 설정은 탭이 아니라 루트 쌓기의 Settings 안 쌓기예요(설정 섹션·지난 순회가 그 위에 쌓여요)
    Settings: { initialRouteName: 'SettingsHome' as const, screens: { SettingsHome: 'settings', SettingsSection: 'settings/:section' } },
  },
}

/** 공유하기 등에서 쓰는 앱 링크 */
export const workLink = (ref: string) => `direction://w/${encodeURIComponent(ref)}`
export const docLink = (ref: string) => `direction://docs/${encodeURIComponent(ref)}`
