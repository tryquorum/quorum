// 라우트 이름과 인자의 원본. 레인 1~3 은 여기 있는 이름으로 자기 폴더의 screens.tsx 에 화면을 등록해요.
// 새 라우트가 꼭 필요하면 한 줄을 더하고 PR 설명 맨 위에 적어요(devlog/_plan/261107_ios_parity/000_roadmap.md).
import type { NavigatorScreenParams } from '@react-navigation/native'
import type { SettingsSectionId } from '@direction-board/contracts/settings-registry'

/** 웹 설정창과 같은 섹션 이름(packages/contracts/src/settings-registry.ts) */
export type { SettingsSectionId }

/** 탭 쌓기의 루트 화면 */
export type TabRootParams = {
  Home: undefined
  List: undefined
  /** 레인 2: tag 를 주면 그 태그로 걸러 보여요(문서 페이지의 태그를 누를 때) */
  Docs: { tag?: string } | undefined
  Chat: undefined
  /** 레인 3: 검색 탭 루트(웹 ⌘K) */
  Search: { q?: string } | undefined
  /** 설정 쌓기(루트 쌓기의 Settings)의 루트 */
  SettingsHome: undefined
}

/** 모든 탭 쌓기에 같이 등록하는 공용 상세. 어느 탭에서 열든 그 탭 안에 쌓여요 */
export type DetailParams = {
  /** 일 상세(할 일·목표·사건). ref: item:<판>:<id> | signal:<id> */
  Work: { ref: string; title?: string }
  /** 문서 페이지. ref: doc:<id> | run:<thread> | 일 ref */
  Doc: { ref: string; title?: string }
  /** 레인 1: 목표 목록(웹 사이드바 목표) */
  Goals: undefined
  /** 레인 1: 결정 칸·사건 */
  Decisions: undefined
  /** 레인 1: 보드 캔버스 */
  Board: { boardId?: string } | undefined
  /** 레인 2: 문서 계층의 한 층(null 은 맨 위) */
  DocFolder: { parent: string | null; title?: string }
  /** 레인 3: AI 대화(thread 가 없으면 새 대화, target 은 함께 보낼 일 ref, quote 는 노트에서 고른 부분 — 첫 질문에 인용으로, draft 는 입력칸에 미리 넣을 글) */
  Thread: { thread?: string; target?: string; quote?: string; draft?: string } | undefined
  /** 레인 3: 설정 섹션 */
  SettingsSection: { section: SettingsSectionId; item?: string }
  /** 레인 3: 지난 운영 순회 */
  OpsRuns: undefined
}

export type StackParams = TabRootParams & DetailParams
export type StackRoute = keyof StackParams

export type TabParams = {
  HomeTab: NavigatorScreenParams<StackParams>
  ListTab: NavigatorScreenParams<StackParams>
  DocsTab: NavigatorScreenParams<StackParams>
  AiTab: NavigatorScreenParams<StackParams>
  SearchTab: NavigatorScreenParams<StackParams>
}

/** 탭 묶음 위의 루트 쌓기 */
export type RootParams = {
  Tabs: NavigatorScreenParams<TabParams>
  /** 탭 밖에서 여는 설정(홈 머리 톱니, 검색 결과, 연결 오류 카드). 설정 섹션·지난 순회·대화가 그 안에 쌓여요 */
  Settings: NavigatorScreenParams<StackParams> | undefined
  /** 레인 1: 빠른 추가 상세 시트. text 는 한 줄에 쓰던 글 */
  QuickAdd: { text?: string } | undefined
}
