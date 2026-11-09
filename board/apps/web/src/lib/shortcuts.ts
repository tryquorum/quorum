// 단축키 레지스트리: 키·범위·동작을 여기 한 곳에 적고, 처리기와 도움말 패널이 이것을 읽어요.
// owner: global = 창 하나의 디스패처(shortcut-dispatch.tsx)가 처리, local = 그 위젯이 matches() 로 판정,
// library = Tiptap·Radix·cmdk 가 처리(도움말 표시용), reserved = 다른 레인이 자리 잡아 둔 키(아직 처리기 없음).
// 순수 함수라 bun test 로 시험해요 (shortcuts.test.ts). 사용자용 표는 docs/user/shortcuts.md.

/** mod = macOS ⌘, 그 밖 Ctrl (판정은 둘 다 받아요) */
export type Key = { key: string; mod?: boolean; shift?: boolean; alt?: boolean }
export type Screen = "home" | "board" | "road" | "list" | "docs" | "doc" | "work"
export const SCREENS: Screen[] = ["home", "board", "road", "list", "docs", "doc", "work"]
export type Owner = "global" | "local" | "library" | "reserved"
export type Shortcut = {
  id: string
  label: string
  owner: Owner
  /** 묶음 이름(도움말의 제목). global 은 screens 로 어느 화면에서 듣는지 적어요 */
  group: string
  screens?: Screen[]
  /** 대신 쓸 수 있는 키들. sequence 는 이어 누르기(g 다음 d) */
  keys?: Key[]
  sequence?: string[]
  /** 입력칸·편집기 안에서도 먹는지 */
  whileTyping: boolean
  source: string
  note?: string
}

const ALL = SCREENS
const NOT_DOCS = SCREENS.filter((s) => s !== "docs" && s !== "doc")
const k = (key: string, more: Omit<Key, "key"> = {}): Key => ({ key, ...more })

/** 다른 레인·화면은 읽기만 해요(얼려 둠). 새 키는 이 목록에 더하고 docs/user/shortcuts.md 표를 함께 고쳐요 */
export const SHORTCUTS: readonly Readonly<Shortcut>[] = Object.freeze([
  // 어디서나
  { id: "palette.toggle", label: "검색과 빠른 실행 열기·닫기", owner: "global", group: "어디서나", screens: ALL, keys: [k("k", { mod: true })], whileTyping: true, source: "App.tsx" },
  { id: "help.open", label: "키보드 단축키 보기", owner: "global", group: "어디서나", screens: ALL, keys: [k("?"), k("/", { mod: true })], whileTyping: false, source: "shortcut-help.tsx", note: "⌘/·Ctrl+/ 는 입력 중에도 돼요" },
  { id: "sidebar.toggle", label: "사이드바 접기·펴기", owner: "global", group: "어디서나", screens: ALL, keys: [k("b", { mod: true })], whileTyping: false, source: "ui/sidebar.tsx", note: "편집기에서는 굵게가 먼저예요" },
  { id: "quickAdd.open", label: "빠른 추가(할 일, 문서 화면 밖)", owner: "global", group: "어디서나", screens: NOT_DOCS, keys: [k("n")], whileTyping: false, source: "quick-add.tsx" },
  { id: "docs.create", label: "새 문서", owner: "global", group: "문서", screens: ["docs", "doc"], keys: [k("n")], whileTyping: false, source: "doc-create.tsx" },
  { id: "docs.moveTo", label: "고른 문서·이 문서 옮기기", owner: "global", group: "문서", screens: ["docs", "doc"], keys: [k("m")], whileTyping: false, source: "doc-move.tsx", note: "독립 문서만" },
  { id: "dock.focus", label: "AI 명령창에 쓰기", owner: "global", group: "어디서나", screens: ALL, keys: [k("/")], whileTyping: false, source: "command-dock.tsx" },
  { id: "theme.toggle", label: "밝은·어두운 화면 바꾸기", owner: "global", group: "어디서나", screens: ALL, keys: [k("d")], whileTyping: false, source: "theme-provider.tsx" },
  { id: "go.home", label: "홈으로", owner: "global", group: "화면 이동", screens: ALL, sequence: ["g", "h"], whileTyping: false, source: "App.tsx" },
  { id: "go.list", label: "전체 목록으로", owner: "global", group: "화면 이동", screens: ALL, sequence: ["g", "l"], whileTyping: false, source: "App.tsx" },
  { id: "go.road", label: "로드맵으로", owner: "global", group: "화면 이동", screens: ALL, sequence: ["g", "r"], whileTyping: false, source: "App.tsx" },
  { id: "go.docs", label: "문서로", owner: "global", group: "화면 이동", screens: ALL, sequence: ["g", "d"], whileTyping: false, source: "App.tsx" },
  { id: "go.ops", label: "운영 순회 설정으로", owner: "global", group: "화면 이동", screens: ALL, sequence: ["g", "o"], whileTyping: false, source: "App.tsx", note: "설정 › 운영 순회(#/settings/ops)" },
  { id: "go.board", label: "보드로", owner: "global", group: "화면 이동", screens: ALL, sequence: ["g", "b"], whileTyping: false, source: "App.tsx" },
  // 문서 목록
  { id: "docs.view.icon", label: "아이콘 보기", owner: "global", group: "문서 목록", screens: ["docs"], keys: [k("1")], whileTyping: false, source: "docs-view.tsx", note: "⌘·Ctrl+숫자는 브라우저 탭 전환이라 쓰지 않아요" },
  { id: "docs.view.list", label: "목록 보기", owner: "global", group: "문서 목록", screens: ["docs"], keys: [k("2")], whileTyping: false, source: "docs-view.tsx" },
  { id: "docs.view.columns", label: "열 보기", owner: "global", group: "문서 목록", screens: ["docs"], keys: [k("3")], whileTyping: false, source: "docs-view.tsx" },
  { id: "docs.view.gallery", label: "갤러리 보기", owner: "global", group: "문서 목록", screens: ["docs"], keys: [k("4")], whileTyping: false, source: "docs-view.tsx" },
  { id: "docs.quickLook", label: "고른 문서 빠른 미리보기", owner: "global", group: "문서 목록", screens: ["docs"], keys: [k(" ")], whileTyping: false, source: "docs-view.tsx" },
  { id: "docs.rename", label: "고른 문서 제목 바꾸기", owner: "global", group: "문서 목록", screens: ["docs"], keys: [k("Enter")], whileTyping: false, source: "docs-view.tsx" },
  { id: "docs.open", label: "고른 문서 열기", owner: "global", group: "문서 목록", screens: ["docs"], keys: [k("ArrowDown", { mod: true })], whileTyping: false, source: "docs-view.tsx", note: "더블클릭도 돼요" },
  { id: "docs.move", label: "고르기 옮기기", owner: "local", group: "문서 목록", keys: [k("ArrowUp"), k("ArrowDown"), k("ArrowLeft"), k("ArrowRight")], whileTyping: false, source: "docs-views/*.tsx" },
  { id: "docs.edge", label: "처음·끝 문서", owner: "local", group: "문서 목록", keys: [k("Home"), k("End")], whileTyping: false, source: "docs-views/*.tsx" },
  // 빠른 미리보기
  { id: "quickLook.close", label: "닫기(Esc 도 돼요)", owner: "local", group: "빠른 미리보기", keys: [k(" ")], whileTyping: false, source: "docs-views/quick-look.tsx" },
  { id: "quickLook.next", label: "다음 문서", owner: "local", group: "빠른 미리보기", keys: [k("ArrowRight"), k("ArrowDown")], whileTyping: false, source: "docs-views/quick-look.tsx" },
  { id: "quickLook.prev", label: "앞 문서", owner: "local", group: "빠른 미리보기", keys: [k("ArrowLeft"), k("ArrowUp")], whileTyping: false, source: "docs-views/quick-look.tsx" },
  // 입력칸
  { id: "field.commit", label: "제목 칸 저장", owner: "local", group: "입력칸", keys: [k("Enter")], whileTyping: true, source: "docs-views/doc-bits.tsx, document-metadata.tsx" },
  { id: "field.cancel", label: "제목 칸 취소", owner: "local", group: "입력칸", keys: [k("Escape")], whileTyping: true, source: "docs-views/doc-bits.tsx" },
  { id: "sheet.submitTitle", label: "제목에서 바로 만들기", owner: "local", group: "빠른 추가·새 문서", keys: [k("Enter")], whileTyping: true, source: "quick-add-sheet.tsx, doc-create.tsx" },
  { id: "sheet.submit", label: "만들기(어느 칸에서나)", owner: "local", group: "빠른 추가·새 문서", keys: [k("Enter", { mod: true })], whileTyping: true, source: "quick-add-sheet.tsx, doc-create.tsx" },
  { id: "sheet.tag", label: "태그 칩으로", owner: "local", group: "빠른 추가·새 문서", keys: [k("Enter"), k(",")], whileTyping: true, source: "quick-add-sheet.tsx, doc-create.tsx" },
  { id: "quickAdd.ai", label: "AI로 정리해서 올리기", owner: "local", group: "빠른 추가 한 줄", keys: [k("Enter", { mod: true })], whileTyping: true, source: "quick-add.tsx", note: "홈·전체 목록 맨 위 한 줄에서. Enter 는 그대로 바로 추가" },
  { id: "sheet.ai", label: "AI로 정리해서 올리기", owner: "local", group: "빠른 추가·새 문서", keys: [k("Enter", { mod: true, shift: true })], whileTyping: true, source: "quick-add-sheet.tsx", note: "빠른 추가 시트에서. ⌘↵ 는 사람이 쓴 그대로 추가" },
  { id: "settings.open", label: "설정 열기", owner: "global", group: "어디서나", screens: ALL, keys: [k(",", { mod: true })], whileTyping: true, source: "App.tsx", note: "설정창(#/settings). 사이드바 계정 옆 톱니나 계정 메뉴에서도 열어요" },
  { id: "chat.send", label: "보내기", owner: "local", group: "AI 대화", keys: [k("Enter"), k("Enter", { mod: true })], whileTyping: true, source: "chat-pane.tsx, command-dock.tsx" },
  { id: "chat.newline", label: "줄바꿈", owner: "local", group: "AI 대화", keys: [k("Enter", { shift: true })], whileTyping: true, source: "chat-pane.tsx, command-dock.tsx" },
  { id: "dock.collapse", label: "명령창 접기", owner: "local", group: "AI 대화", keys: [k("Escape")], whileTyping: true, source: "command-dock.tsx" },
  { id: "ops.save", label: "순회 지시문 저장", owner: "local", group: "운영 순회", keys: [k("s", { mod: true })], whileTyping: true, source: "ops/prompt-editor.tsx", note: "설정 › 운영 순회의 지시문(영역 카드·원문)에서. 브라우저의 페이지 저장 대신 지시문을 저장해요" },
  { id: "editor.ask", label: "고른 부분 AI에게 묻기 보내기·닫기", owner: "local", group: "노트 편집기", keys: [k("Enter"), k("Escape")], whileTyping: true, source: "note-editor.tsx" },
  // 라이브러리
  { id: "editor.bold", label: "굵게", owner: "library", group: "노트 편집기", keys: [k("b", { mod: true })], whileTyping: true, source: "Tiptap StarterKit" },
  { id: "editor.italic", label: "기울임", owner: "library", group: "노트 편집기", keys: [k("i", { mod: true })], whileTyping: true, source: "Tiptap StarterKit" },
  { id: "editor.underline", label: "밑줄", owner: "library", group: "노트 편집기", keys: [k("u", { mod: true })], whileTyping: true, source: "Tiptap StarterKit" },
  { id: "editor.code", label: "코드", owner: "library", group: "노트 편집기", keys: [k("e", { mod: true })], whileTyping: true, source: "Tiptap StarterKit" },
  { id: "editor.undo", label: "되돌리기", owner: "library", group: "노트 편집기", keys: [k("z", { mod: true })], whileTyping: true, source: "Tiptap StarterKit" },
  { id: "editor.redo", label: "다시 하기", owner: "library", group: "노트 편집기", keys: [k("z", { mod: true, shift: true })], whileTyping: true, source: "Tiptap StarterKit" },
  { id: "dialog.close", label: "창·메뉴 닫기", owner: "library", group: "창과 메뉴", keys: [k("Escape")], whileTyping: true, source: "Radix" },
  { id: "palette.pick", label: "팔레트 고르기·실행", owner: "library", group: "창과 메뉴", keys: [k("ArrowUp"), k("ArrowDown"), k("Enter")], whileTyping: true, source: "cmdk" },
] satisfies Shortcut[])

export const byId = (id: string) => {
  const s = SHORTCUTS.find((x) => x.id === id)
  if (!s) throw new Error("모르는 단축키 " + id)
  return s
}

/** 키 이벤트의 필요한 부분(시험에서 가짜로 만들기 쉽게) */
export type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean; keyCode?: number; repeat?: boolean }
const isLetter = (key: string) => /^[a-z]$/i.test(key)
const same = (a: string, b: string) => (a.length === 1 ? a.toLowerCase() === b.toLowerCase() : a === b)

/** 키 하나가 이벤트와 맞는지. 글자는 Shift 가 없어야 하고, ?·, 같은 기호는 Shift 를 보지 않아요(배열마다 Shift 여부가 달라서) */
export function keyMatches(e: KeyLike, want: Key): boolean {
  if (!same(want.key, e.key)) return false
  const mod = e.metaKey || e.ctrlKey
  if (!!want.mod !== mod || !!want.alt !== e.altKey) return false
  if (want.shift !== undefined) return want.shift === e.shiftKey
  return isLetter(want.key) || want.key.length > 1 ? !e.shiftKey : true
}
export const matches = (e: KeyLike, id: string) => (byId(id).keys ?? []).some((key) => keyMatches(e, key))

/** IME 조합 중(Safari 는 첫 키가 keyCode 229) */
export const composing = (e: KeyLike) => !!e.isComposing || e.keyCode === 229

/** 편집 대상: input·textarea·select·contenteditable. DOM 이 없어도 시험할 수 있게 모양으로 봐요 */
export type TargetLike = { tagName?: string; isContentEditable?: boolean; closest?: (sel: string) => unknown } | null
export function isEditable(t: TargetLike): boolean {
  if (!t) return false
  if (t.isContentEditable) return true
  if (t.tagName && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName.toUpperCase())) return true
  return !!t.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]')
}
const interactive = (t: TargetLike) => !!t?.closest?.("button,a,summary")

/** 한 글자 단축키를 막을 때: 수정키, 조합 중, 누르고 있음, 편집 대상, 열린 창·메뉴 */
export function blockedSingleKey(e: KeyLike, target: TargetLike, overlay: boolean): boolean {
  return e.metaKey || e.ctrlKey || e.altKey || composing(e) || !!e.repeat || isEditable(target) || overlay
}

export const SEQUENCE_MS = 1500
export type Ctx = {
  screen: Screen
  target: TargetLike
  /** 열린 dialog·alertdialog·menu */
  overlay: boolean
  defaultPrevented: boolean
  /** g 를 누른 시각(이어 누르기 대기), 없으면 null */
  pendingG: number | null
  now: number
}
export type Resolved = { id: string | null; pendingG: number | null }

/**
 * 창 하나의 디스패처가 부르는 판정. 위에서부터:
 * ⌘K·⌘,·⌘/(입력 중에도) → ⌘B(편집 대상·이미 처리된 키면 넘김) → ⌘↓(문서 목록) → 열린 창·메뉴면 그만 →
 * 한 글자 차단 → g 다음 글자 → ? n / d g 1~4 → 고른 문서 Space·Enter
 */
export function resolveShortcut(e: KeyLike, c: Ctx): Resolved {
  const keep = c.pendingG !== null && c.now - c.pendingG <= SEQUENCE_MS ? c.pendingG : null
  const done = (id: string | null, pendingG: number | null = null): Resolved => ({ id, pendingG })
  const on = (id: string) => { const s = byId(id); return !s.screens || s.screens.includes(c.screen) }
  if (composing(e)) return done(null, keep)
  if (matches(e, "palette.toggle") && !e.repeat) return done("palette.toggle")
  // ⌘,·Ctrl+, 는 입력 중에도, 팔레트·창이 열려 있어도 설정으로(App 이 팔레트를 닫고 이동)
  if (matches(e, "settings.open") && !e.repeat) return done("settings.open")
  if ((e.metaKey || e.ctrlKey) && matches(e, "help.open")) return done("help.open")
  if (matches(e, "sidebar.toggle")) return done(isEditable(c.target) || c.defaultPrevented ? null : "sidebar.toggle")
  if (matches(e, "docs.open") && on("docs.open") && !isEditable(c.target) && !c.overlay && !c.defaultPrevented) return done("docs.open")
  if (c.overlay || c.defaultPrevented) return done(null)
  if (blockedSingleKey(e, c.target, false)) return done(null, e.metaKey || e.ctrlKey || e.altKey ? null : keep)
  if (keep !== null) {
    const hit = SHORTCUTS.find((s) => s.sequence && s.sequence[1] === e.key.toLowerCase() && !e.shiftKey)
    if (hit) return done(hit.id)
  }
  for (const id of ["help.open", "docs.create", "docs.moveTo", "quickAdd.open", "dock.focus", "theme.toggle", "docs.view.icon", "docs.view.list", "docs.view.columns", "docs.view.gallery"]) {
    if (on(id) && matches(e, id)) return done(id)
  }
  if (same(e.key, "g") && !e.shiftKey) return done(null, c.now)
  if (!interactive(c.target) && on("docs.quickLook") && matches(e, "docs.quickLook")) return done("docs.quickLook")
  if (!interactive(c.target) && on("docs.rename") && matches(e, "docs.rename")) return done("docs.rename")
  return done(null)
}

/** 화면 주소 → 화면 */
export function screenOf(hash: string): Screen {
  const h = hash.replace(/^#\/?/, "")
  if (/^docs\/./.test(h)) return "doc"
  if (/^docs(\?|$)/.test(h)) return "docs"
  if (h.startsWith("w/")) return "work"
  const name = h.split(/[?/]/)[0]
  return (SCREENS as string[]).includes(name) ? (name as Screen) : "home"
}

const MAC_NAMES: Record<string, string> = { Enter: "↵", Escape: "Esc", ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→", " ": "Space", Home: "Home", End: "End" }
const OTHER_NAMES: Record<string, string> = { ...MAC_NAMES, Enter: "Enter" }
/** 키 표시. mac: ⌘⇧⌥ 기호, 그 밖: Ctrl+Shift+Alt+ */
export function formatKey(key: Key, mac: boolean): string[] {
  const names = mac ? MAC_NAMES : OTHER_NAMES
  const main = names[key.key] ?? (key.key.length === 1 ? key.key.toUpperCase() : key.key)
  const parts = mac
    ? [key.mod && "⌘", key.alt && "⌥", key.shift && "⇧", main]
    : [key.mod && "Ctrl", key.alt && "Alt", key.shift && "Shift", main]
  return parts.filter((p): p is string => !!p)
}
export const formatKeys = (s: Shortcut, mac: boolean): string[][] => s.sequence ? [s.sequence.map((x) => x.toUpperCase())] : (s.keys ?? []).map((key) => formatKey(key, mac))
export const isMac = (platform: string) => /Mac|iPhone|iPad/.test(platform)

/** 키를 비교할 수 있는 문자열로 */
export const keyId = (key: Key) => [key.mod ? "mod" : "", key.alt ? "alt" : "", key.shift ? "shift" : "", key.key.length === 1 ? key.key.toLowerCase() : key.key].join("+")

/** 같은 키가 겹치는 화면에서 두 번 처리되는 쌍: global 끼리, 또는 입력 중에도 먹는 global 과 편집기(library) 키 */
export function conflicts(list: readonly Shortcut[] = SHORTCUTS): [string, string][] {
  const out: [string, string][] = []
  const live = list.filter((s) => s.owner !== "reserved")
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j]
    const keysA = (a.keys ?? []).map(keyId), keysB = (b.keys ?? []).map(keyId)
    if (!keysA.some((x) => keysB.includes(x))) continue
    if (a.owner === "global" && b.owner === "global") {
      if ((a.screens ?? []).some((s) => (b.screens ?? []).includes(s))) out.push([a.id, b.id])
    } else {
      // local 은 칸마다 따로 듣기 때문에 서로 겹쳐도 충돌이 아니에요. 입력 중에도 먹는 global 키가 편집기 키를 덮는 것만 봐요
      const g = a.owner === "global" ? a : b.owner === "global" ? b : null
      const other = g === a ? b : a
      if (g && g.whileTyping && other.owner === "library" && other.group === "노트 편집기") out.push([a.id, b.id])
    }
  }
  return out
}
/** 예약된 키와 지금 쓰는 키가 겹치는 쌍 */
export const reservedOverlaps = (list: readonly Shortcut[] = SHORTCUTS): [string, string][] =>
  list.filter((r) => r.owner === "reserved").flatMap((r) => list.filter((s) => s.owner !== "reserved" && s.group === r.group && (s.keys ?? []).some((key) => (r.keys ?? []).map(keyId).includes(keyId(key)))).map((s): [string, string] => [r.id, s.id]))

/** 브라우저·OS 가 쓰는 키(창·탭·주소창·북마크·프로필). 이 앱 단축키로 쓰지 않아요 */
export const BROWSER_RESERVED: Key[] = [
  ...["n", "t", "w", "l", "d"].map((x) => k(x, { mod: true })),
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((x) => k(x, { mod: true })),
  k("m", { mod: true, shift: true }),
]
