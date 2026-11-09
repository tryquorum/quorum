import { describe, expect, test } from 'bun:test'
import { getStateFromPath } from '@react-navigation/core'
import { docLink, isAuthCallback, linkingConfig, workLink } from './linking'

type Node = { routes: { name: string; params?: Record<string, unknown>; state?: Node }[] }
/** 링크가 연 화면 경로: 바깥부터 마지막(보이는) 라우트 이름과, 그 쌓기의 이름들 */
function open(url: string) {
  const state = getStateFromPath(url.replace('direction://', ''), linkingConfig as unknown as Parameters<typeof getStateFromPath>[1]) as Node | undefined
  if (!state) return null
  const tabs = state.routes[0].state as Node
  const tab = tabs.routes[0]
  const stack = (tab.state as Node).routes
  return { tab: tab.name, stack: stack.map((r) => r.name), params: stack[stack.length - 1].params }
}

describe('딥링크', () => {
  test('일 링크는 홈 쌓기에 루트를 깔고 일 상세를 열어요(콜론 든 ref 그대로)', () => {
    expect(open(workLink('item:board-1:abc'))).toEqual({ tab: 'HomeTab', stack: ['Home', 'Work'], params: { ref: 'item:board-1:abc' } })
  })
  test('문서 링크는 문서 쌓기의 문서 페이지를 열어요', () => {
    expect(open(docLink('doc:7f3a'))).toEqual({ tab: 'DocsTab', stack: ['Docs', 'Doc'], params: { ref: 'doc:7f3a' } })
  })
  test('탭 이름 링크는 그 탭 루트예요', () => {
    expect(open('direction://docs')).toMatchObject({ tab: 'DocsTab', stack: ['Docs'] })
    expect(open('direction://ai')).toMatchObject({ tab: 'AiTab', stack: ['Chat'] })
    expect(open('direction://search')).toMatchObject({ tab: 'SearchTab', stack: ['Search'] })
  })
  test('설정 링크는 탭 위 설정 쌓기를 열고, 섹션 링크는 설정 루트 위에 섹션을 쌓아요', () => {
    const settings = (url: string) => {
      const state = getStateFromPath(url.replace('direction://', ''), linkingConfig as unknown as Parameters<typeof getStateFromPath>[1]) as Node | undefined
      const top = state?.routes[state.routes.length - 1]
      return { root: state?.routes.map((r) => r.name), stack: (top?.state as Node | undefined)?.routes.map((r) => [r.name, r.params]) }
    }
    expect(settings('direction://settings')).toEqual({ root: ['Tabs', 'Settings'], stack: [['SettingsHome', undefined]] })
    expect(settings('direction://settings/ops')).toEqual({ root: ['Tabs', 'Settings'], stack: [['SettingsHome', undefined], ['SettingsSection', { section: 'ops' }]] })
  })
  test('로그인 콜백은 내비게이션에서 빠져요', () => {
    expect(isAuthCallback('direction://auth?state=x&token=y')).toBe(true)
    expect(isAuthCallback('direction://auth')).toBe(true)
    expect(isAuthCallback('direction://w/auth')).toBe(false)
    expect(isAuthCallback('direction://author')).toBe(false)
  })
})
