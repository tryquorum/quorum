// 방향판 디자인 토큰의 원본이에요. 웹 CSS 변수(apps/web/src/index.css)는 같은 값을 손으로 적고 css-sync 시험이 맞는지 봐요.
// 색은 sRGB hex 라 React Native 도 그대로 읽어요. 이유와 사용 규칙은 docs/internals/design-core.md 에 있어요.

export type Scheme = 'light' | 'dark'

export const color = {
  light: {
    background: '#ffffff', foreground: '#0a0a0a',
    card: '#ffffff', 'card-foreground': '#0a0a0a', popover: '#ffffff', 'popover-foreground': '#0a0a0a',
    primary: '#171717', 'primary-foreground': '#fafafa',
    secondary: '#f5f5f5', 'secondary-foreground': '#171717',
    muted: '#f5f5f5', 'muted-foreground': '#666666',
    accent: '#f5f5f5', 'accent-foreground': '#171717',
    border: '#e5e5e5', input: '#e5e5e5', control: '#858585', ring: '#171717',
    destructive: '#c00008', decide: '#c00008',
    ai: '#8e51ff', 'ai-foreground': '#6d28d9',
    running: '#0284c7', 'running-foreground': '#0369a1',
    done: '#059669', 'done-foreground': '#036b4d',
    warn: '#b45309', 'warn-foreground': '#a3480a',
    'no-area': '#858585',
    sidebar: '#fafafa', 'sidebar-foreground': '#0a0a0a', 'sidebar-primary': '#171717', 'sidebar-primary-foreground': '#fafafa',
    'sidebar-accent': '#f0f0f0', 'sidebar-accent-foreground': '#171717', 'sidebar-border': '#e5e5e5', 'sidebar-ring': '#171717',
    scrollbar: '#0a0a0a26', 'scrollbar-active': '#0a0a0a73',
    overlay: '#0a0a0a24',
  },
  dark: {
    background: '#0a0a0a', foreground: '#fafafa',
    card: '#171717', 'card-foreground': '#fafafa', popover: '#171717', 'popover-foreground': '#fafafa',
    primary: '#e5e5e5', 'primary-foreground': '#171717',
    secondary: '#262626', 'secondary-foreground': '#fafafa',
    muted: '#262626', 'muted-foreground': '#a1a1a1',
    accent: '#262626', 'accent-foreground': '#fafafa',
    border: '#ffffff1a', input: '#ffffff26', control: '#8a8a8a', ring: '#f5f5f5',
    destructive: '#ff6467', decide: '#ff6467',
    ai: '#a684ff', 'ai-foreground': '#a684ff',
    running: '#38bdf8', 'running-foreground': '#38bdf8',
    done: '#34d399', 'done-foreground': '#34d399',
    warn: '#fbbf24', 'warn-foreground': '#fbbf24',
    'no-area': '#8a8a8a',
    sidebar: '#171717', 'sidebar-foreground': '#fafafa', 'sidebar-primary': '#e5e5e5', 'sidebar-primary-foreground': '#171717',
    'sidebar-accent': '#262626', 'sidebar-accent-foreground': '#fafafa', 'sidebar-border': '#ffffff1a', 'sidebar-ring': '#f5f5f5',
    scrollbar: '#fafafa21', 'scrollbar-active': '#fafafa66',
    overlay: '#00000073',
  },
} as const satisfies Record<Scheme, Record<string, string>>

export type ColorName = keyof typeof color.light

/** 떠 있는 유리 표면은 웹 색 변수와 별도로 사용해요. */
export const glass = {
  light: { fallback: '#fffffff0', selected: '#0a0a0a14', shadow: '#000000', shadowOpacity: 0.08 },
  dark: { fallback: '#262626e6', selected: '#ffffff24', shadow: '#000000', shadowOpacity: 0.22 },
} as const

/** 글자 크기와 줄 높이(px). Tailwind 기본 단계에 2xs(11)를 더했어요. 11px 아래는 쓰지 않아요 */
export const text = {
  '2xs': [11, 16], xs: [12, 16], sm: [14, 20], base: [16, 24], lg: [18, 28], xl: [20, 28], '2xl': [24, 32], '3xl': [30, 36],
} as const

/** 줄간격 배수: 조작 글(ui)과 한국어 본문(prose) */
export const leading = { ui: 1.4, prose: 1.7 } as const
/** 간격은 4px 단위 */
export const space = { unit: 4 } as const
export const radius = { sm: 6, md: 8, lg: 10, xl: 14 } as const
export const motion = { fast: 120, base: 200, slow: 280, standard: 'cubic-bezier(0.2, 0, 0, 1)', exit: 'cubic-bezier(0.4, 0, 1, 1)' } as const
/** 겹침 순서(z-index) */
export const layer = { sticky: 10, raised: 20, dock: 40, overlay: 50, toast: 60 } as const
/** 포커스 링 두께와 간격(px) */
export const focus = { width: 2, offset: 2 } as const

