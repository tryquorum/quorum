// 단축키. 출처: board/apps/web/src/lib/shortcuts.ts (방향판 2ee6e8a) 의 Key·keyMatches·composing·isEditable·blockedSingleKey·formatKey·g 이어 누르기 규칙.
// Workspace 판: 화면이 하나라 screens 는 없고, 목록을 j/k 로 고르고 바로 처리하는 키를 더했어요.
export type Key = { key: string; mod?: boolean; shift?: boolean; alt?: boolean }
export type Shortcut = { id: string; label: string; group: string; keys?: Key[]; sequence?: string[]; whileTyping: boolean; note?: string }
const k = (key: string, more: Omit<Key, "key"> = {}): Key => ({ key, ...more })

export const SHORTCUTS: readonly Shortcut[] = Object.freeze([
  { id: "palette.toggle", label: "Search and quick actions", group: "Anywhere", keys: [k("k", { mod: true })], whileTyping: true },
  { id: "help.open", label: "Keyboard shortcuts", group: "Anywhere", keys: [k("?"), k("/", { mod: true })], whileTyping: false },
  { id: "capture.focus", label: "Write something down", group: "Anywhere", keys: [k("n"), k("c")], whileTyping: false },
  { id: "capture.save", label: "Save what you wrote, as written", group: "Quick capture", keys: [k("Enter")], whileTyping: true, note: "내일 3시, 11/12 같은 날짜는 마감으로 읽어요" },
  { id: "capture.blur", label: "Leave the capture line", group: "Quick capture", keys: [k("Escape")], whileTyping: true },
  { id: "row.next", label: "Next item", group: "Now list", keys: [k("j"), k("ArrowDown")], whileTyping: false },
  { id: "row.prev", label: "Previous item", group: "Now list", keys: [k("k"), k("ArrowUp")], whileTyping: false },
  { id: "row.open", label: "Open item", group: "Now list", keys: [k("Enter"), k("o")], whileTyping: false },
  { id: "row.done", label: "Done / reviewed", group: "Now list", keys: [k("e")], whileTyping: false },
  { id: "row.approve", label: "Approve (Needs you)", group: "Now list", keys: [k("a")], whileTyping: false },
  { id: "row.reject", label: "Reject (Needs you)", group: "Now list", keys: [k("x")], whileTyping: false },
  { id: "row.ask", label: "Ask the council (Inbox)", group: "Now list", keys: [k("q")], whileTyping: false },
  { id: "go.console", label: "Council console", group: "Go to", sequence: ["g", "c"], whileTyping: false },
  { id: "go.home", label: "Landing page", group: "Go to", sequence: ["g", "h"], whileTyping: false },
  { id: "dialog.close", label: "Close dialog or menu", group: "Dialogs", keys: [k("Escape")], whileTyping: true },
])

export type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean; keyCode?: number; repeat?: boolean }
const isLetter = (key: string) => /^[a-z]$/i.test(key)
const same = (a: string, b: string) => (a.length === 1 ? a.toLowerCase() === b.toLowerCase() : a === b)
export const byId = (id: string) => { const s = SHORTCUTS.find((x) => x.id === id); if (!s) throw new Error("unknown shortcut " + id); return s }

/** 키 하나가 이벤트와 맞는지. 글자는 Shift 가 없어야 하고, ?·, 같은 기호는 Shift 를 보지 않아요 */
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
export type TargetLike = { tagName?: string; isContentEditable?: boolean; closest?: (sel: string) => unknown } | null
export function isEditable(t: TargetLike): boolean {
  if (!t) return false
  if (t.isContentEditable) return true
  if (t.tagName && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName.toUpperCase())) return true
  return !!t.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]')
}
export const SEQUENCE_MS = 1500

/** 창 하나에서 부르는 판정. ⌘K·⌘/ 는 입력 중에도, 한 글자 키는 입력칸·조합 중·열린 창에서는 먹지 않아요 */
export function resolveShortcut(e: KeyLike, c: { target: TargetLike; overlay: boolean; pendingG: number | null; now: number }): { id: string | null; pendingG: number | null } {
  const keep = c.pendingG !== null && c.now - c.pendingG <= SEQUENCE_MS ? c.pendingG : null
  if (composing(e)) return { id: null, pendingG: keep }
  if (matches(e, "palette.toggle") && !e.repeat) return { id: "palette.toggle", pendingG: null }
  if ((e.metaKey || e.ctrlKey) && matches(e, "help.open")) return { id: "help.open", pendingG: null }
  if (c.overlay) return { id: null, pendingG: null }
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isEditable(c.target)) return { id: null, pendingG: null }
  if (keep !== null) {
    const hit = SHORTCUTS.find((s) => s.sequence && s.sequence[1] === e.key.toLowerCase() && !e.shiftKey)
    if (hit) return { id: hit.id, pendingG: null }
  }
  const interactive = !!c.target?.closest?.("button,a,summary")
  for (const s of SHORTCUTS) {
    if (!s.keys || s.whileTyping || s.group === "Dialogs") continue
    if (s.id === "row.open" && interactive && e.key === "Enter") continue
    if (matches(e, s.id)) return { id: s.id, pendingG: null }
  }
  if (same(e.key, "g") && !e.shiftKey) return { id: null, pendingG: c.now }
  return { id: null, pendingG: null }
}

const MAC_NAMES: Record<string, string> = { Enter: "↵", Escape: "Esc", ArrowDown: "↓", ArrowUp: "↑" }
export function formatKey(key: Key, mac: boolean): string[] {
  const main = MAC_NAMES[key.key] ?? (key.key.length === 1 ? key.key.toUpperCase() : key.key)
  const parts = mac ? [key.mod && "⌘", key.alt && "⌥", key.shift && "⇧", main] : [key.mod && "Ctrl", key.alt && "Alt", key.shift && "Shift", main === "↵" ? "Enter" : main]
  return parts.filter((p): p is string => !!p)
}
export const formatKeys = (s: Shortcut, mac: boolean): string[][] => (s.sequence ? [s.sequence.map((x) => x.toUpperCase())] : (s.keys ?? []).map((key) => formatKey(key, mac)))
export const isMac = (platform: string) => /Mac|iPhone|iPad/.test(platform)
