import React from 'react'
import { Pressable, StatusBar, useColorScheme } from 'react-native'
import { DarkTheme, DefaultTheme, NavigationContainer, useNavigation, type LinkingOptions } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack'
import { SymbolView } from 'expo-symbols'
import { boardScreens, QuickAddSheet } from '../features/board/screens'
import { docsScreens } from '../features/docs/screens'
import { aiScreens } from '../features/ai/screens'
import { searchScreens } from '../features/search/screens'
import { settingsScreens } from '../features/settings/screens'
import { getPrefs } from '../features/settings/prefs'
import { TabPill } from '../TabPill'
import { schemeColors } from '../ui/theme'
import { isAuthCallback, linkingConfig, PREFIXES } from './linking'
import type { RootParams, StackParams, StackRoute, TabParams } from './routes'
import type { ScreenDef } from './screen'
import { TABS } from './tabs'

// 내비게이션 골격(ADR-0010): 루트 쌓기(탭 묶음 + 탭 밖 화면) → 탭 → 탭마다 쌓기. 공용 상세는 모든 탭 쌓기에 같이 등록해요.
const SCREENS: ScreenDef[] = [...boardScreens, ...docsScreens, ...aiScreens, ...searchScreens, ...settingsScreens]
const DETAILS = SCREENS.filter((s) => s.detail)

const Root = createNativeStackNavigator<RootParams>()
const Tab = createBottomTabNavigator<TabParams>()
const Stack = createNativeStackNavigator<StackParams>()

function useStackOptions(): NativeStackNavigationOptions {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  // 머리 아래 그림자 선은 그리지 않아요. 뒤로 단추는 화살표만
  return {
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerStyle: { backgroundColor: c.page },
    headerLargeStyle: { backgroundColor: c.page },
    headerTintColor: c.ink,
    headerTitleStyle: { color: c.ink },
    headerLargeTitleStyle: { color: c.ink },
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: c.page },
  }
}

function makeTabStack(tab: { root: StackRoute; label: string; displayName: string }, rootOptions: NativeStackNavigationOptions = {}) {
  const root = SCREENS.find((s) => s.name === tab.root)
  function TabStack() {
    const options = useStackOptions()
    return (
      <Stack.Navigator screenOptions={options}>
        {root ? <Stack.Screen name={tab.root} component={root.component} options={{ title: tab.label, headerLargeTitle: true, ...root.options, ...rootOptions }} /> : null}
        {DETAILS.map((d) => (
          <Stack.Screen key={d.name} name={d.name} component={d.component} options={d.options} />
        ))}
      </Stack.Navigator>
    )
  }
  TabStack.displayName = tab.displayName
  return TabStack
}
// 탭 쌓기 컴포넌트는 모듈에서 한 번만 만들어요(그릴 때마다 만들면 쌓기 상태를 잃어요)
const TAB_STACKS = TABS.map((t) => ({ tab: t, component: makeTabStack({ root: t.root, label: t.label, displayName: `${t.name}Stack` }) }))

/** 설정 쌓기 루트의 뒤로: 설정은 탭 위에 올라온 화면이라 루트 쌓기에서 내려가요 */
function SettingsBack() {
  const navigation = useNavigation()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="뒤로" hitSlop={12} onPress={() => navigation.getParent()?.goBack()}>
      <SymbolView name="chevron.left" size={20} weight="semibold" tintColor={c.ink} />
    </Pressable>
  )
}
// 탭 밖 설정(홈 머리 톱니·검색 결과·오류 카드): 탭 쌓기와 같은 공용 상세를 함께 둬서 섹션·지난 순회·대화가 그 위에 쌓여요
const SettingsStack = makeTabStack({ root: 'SettingsHome', label: '설정', displayName: 'SettingsStack' }, { headerLeft: () => <SettingsBack /> })

function Tabs() {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  return (
    <Tab.Navigator
      initialRouteName={getPrefs().start}
      tabBar={(props) => <TabPill {...props} />}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.muted,
        tabBarIcon: ({ focused, color, size }) => {
          const icon = TABS.find((t) => t.name === route.name)?.icon
          return icon ? <SymbolView name={focused ? icon[1] : icon[0]} tintColor={color} size={Math.min(size, 24)} accessibilityElementsHidden importantForAccessibility="no" /> : null
        },
      })}
    >
      {TAB_STACKS.map(({ tab, component }) => (
        <Tab.Screen key={tab.name} name={tab.name} component={component} options={{ title: tab.label }} />
      ))}
    </Tab.Navigator>
  )
}

const linking: LinkingOptions<RootParams> = {
  prefixes: PREFIXES,
  filter: (url) => !isAuthCallback(url),
  config: linkingConfig as LinkingOptions<RootParams>['config'],
}

export function RootNavigator() {
  // 내비게이션은 색을 계산하므로 보통 문자열 색으로, 시스템 모양을 따라 라이트·다크(GAP-14·30)
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const c = schemeColors(scheme)
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme
  const theme = { ...base, colors: { ...base.colors, primary: c.primary, background: c.page, card: c.card, text: c.ink, border: c.line } }
  const options = useStackOptions()
  return (
    <NavigationContainer theme={theme} linking={linking}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <Root.Navigator screenOptions={{ headerShown: false }}>
        <Root.Screen name="Tabs" component={Tabs} />
        <Root.Screen name="Settings" component={SettingsStack} />
        {/* 레인 1: 빠른 추가 상세 시트(아래에서 올라오는 시트, 끌어내려 닫기) */}
        <Root.Screen name="QuickAdd" component={QuickAddSheet} options={{ ...options, headerShown: true, presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, title: '빠른 추가' }} />
      </Root.Navigator>
    </NavigationContainer>
  )
}
