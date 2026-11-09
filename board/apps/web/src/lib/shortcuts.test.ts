import { describe, expect, test } from "bun:test"
import { BROWSER_RESERVED, SHORTCUTS, blockedSingleKey, conflicts, formatKey, formatKeys, byId, isEditable, keyId, matches, reservedOverlaps, resolveShortcut, screenOf, type Ctx, type KeyLike, type Shortcut } from "./shortcuts"

const ev = (key: string, more: Partial<KeyLike> = {}): KeyLike => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...more })
const body = { tagName: "BODY", closest: () => null }
const input = { tagName: "INPUT", closest: () => ({}) }
const editor = { tagName: "DIV", isContentEditable: true, closest: () => ({}) }
const button = { tagName: "BUTTON", closest: (s: string) => (s.includes("button") ? {} : null) }
const ctx = (more: Partial<Ctx> = {}): Ctx => ({ screen: "home", target: body, overlay: false, defaultPrevented: false, pendingG: null, now: 10_000, ...more })
const id = (e: KeyLike, c: Partial<Ctx> = {}) => resolveShortcut(e, ctx(c)).id

describe("resolveShortcut", () => {
  test("⌘K·Ctrl+K 는 입력 중·창이 열려 있어도 팔레트", () => {
    expect(id(ev("k", { metaKey: true }), { target: input })).toBe("palette.toggle")
    expect(id(ev("K", { ctrlKey: true }), { overlay: true })).toBe("palette.toggle")
    expect(id(ev("k", { metaKey: true, isComposing: true }))).toBeNull()
  })
  test("? 와 ⌘/ 는 도움말, ? 는 입력 중 아님, ⌘/ 는 입력 중에도", () => {
    expect(id(ev("?", { shiftKey: true }))).toBe("help.open")
    expect(id(ev("?", { shiftKey: true }), { target: input })).toBeNull()
    expect(id(ev("/", { metaKey: true }), { target: editor })).toBe("help.open")
    expect(id(ev("/", { ctrlKey: true }), { target: input })).toBe("help.open")
  })
  test("⌘B 는 편집기·입력칸에서는 넘기고(굵게가 먼저), 바탕에서는 사이드바", () => {
    expect(id(ev("b", { metaKey: true }))).toBe("sidebar.toggle")
    expect(id(ev("b", { metaKey: true }), { target: editor })).toBeNull()
    expect(id(ev("b", { ctrlKey: true }), { target: input })).toBeNull()
    expect(id(ev("b", { metaKey: true }), { defaultPrevented: true })).toBeNull()
  })
  test("n 은 문서 화면이면 새 문서, 그 밖은 빠른 추가", () => {
    expect(id(ev("n"), { screen: "docs" })).toBe("docs.create")
    expect(id(ev("n"), { screen: "doc" })).toBe("docs.create")
    expect(id(ev("n"), { screen: "home" })).toBe("quickAdd.open")
    expect(id(ev("N", { shiftKey: true }), { screen: "home" })).toBeNull()
    // m 은 문서 화면에서만 옮기기
    expect(id(ev("m"), { screen: "docs" })).toBe("docs.moveTo")
    expect(id(ev("m"), { screen: "doc" })).toBe("docs.moveTo")
    expect(id(ev("m"), { screen: "home" })).toBeNull()
    expect(id(ev("m"), { screen: "docs", target: input })).toBeNull()
  })
  test("한 글자는 입력 중·IME 조합·keyCode 229·누르고 있음·창 열림·수정키면 먹지 않음", () => {
    for (const k of ["n", "/", "d", "?", "g", "1"]) {
      expect(id(ev(k), { target: input })).toBeNull()
      expect(id(ev(k), { target: editor })).toBeNull()
      expect(id(ev(k, { isComposing: true }))).toBeNull()
      expect(id(ev(k, { keyCode: 229 }))).toBeNull()
      expect(id(ev(k, { repeat: true }))).toBeNull()
      expect(id(ev(k), { overlay: true })).toBeNull()
      expect(id(ev(k, { altKey: true }))).toBeNull()
    }
    expect(id(ev("/"))).toBe("dock.focus")
    expect(id(ev("d"))).toBe("theme.toggle")
  })
  test("g 다음 글자는 화면 이동, g 다음 d 는 테마가 아니라 문서로", () => {
    const first = resolveShortcut(ev("g"), ctx())
    expect(first).toEqual({ id: null, pendingG: 10_000 })
    expect(id(ev("d"), { pendingG: 10_000, now: 10_500 })).toBe("go.docs")
    expect(id(ev("h"), { pendingG: 10_000, now: 11_000 })).toBe("go.home")
    // 시간이 지나면 d 는 다시 테마
    expect(id(ev("d"), { pendingG: 10_000, now: 12_000 })).toBe("theme.toggle")
    // 이어 누르기가 아닌 글자는 그 글자의 동작
    expect(id(ev("n"), { pendingG: 10_000, now: 10_200, screen: "list" })).toBe("quickAdd.open")
    // 입력칸에 들어가면 이어 누르기가 먹지 않음
    expect(id(ev("d"), { pendingG: 10_000, now: 10_200, target: input })).toBeNull()
  })
  test("문서 목록: 1~4 보기, 고른 문서 Space·Enter·⌘↓, 버튼 위 Enter 는 버튼에", () => {
    expect(id(ev("3"), { screen: "docs" })).toBe("docs.view.columns")
    expect(id(ev("3"), { screen: "home" })).toBeNull()
    expect(id(ev(" "), { screen: "docs" })).toBe("docs.quickLook")
    expect(id(ev("Enter"), { screen: "docs" })).toBe("docs.rename")
    expect(id(ev("Enter"), { screen: "docs", target: button })).toBeNull()
    expect(id(ev("ArrowDown", { metaKey: true }), { screen: "docs", target: button })).toBe("docs.open")
    expect(id(ev("ArrowDown", { ctrlKey: true }), { screen: "docs", target: input })).toBeNull()
    expect(id(ev(" "), { screen: "doc" })).toBeNull()
  })
})

describe("matches·표시", () => {
  test("글자는 Shift 없이, 기호는 Shift 상관없이", () => {
    expect(matches(ev("n"), "quickAdd.open")).toBe(true)
    expect(matches(ev("N", { shiftKey: true }), "quickAdd.open")).toBe(false)
    expect(matches(ev("?", { shiftKey: true }), "help.open")).toBe(true)
    expect(matches(ev("Enter", { shiftKey: true }), "chat.send")).toBe(false)
    expect(matches(ev("Enter", { shiftKey: true }), "chat.newline")).toBe(true)
    // 예전처럼 ⌘·Ctrl+Enter 도 보내기
    expect(matches(ev("Enter", { metaKey: true }), "chat.send")).toBe(true)
    expect(matches(ev("Enter", { ctrlKey: true }), "chat.send")).toBe(true)
    expect(matches(ev("Enter", { ctrlKey: true }), "sheet.submit")).toBe(true)
  })
  test("formatKey: mac 기호와 Windows 글자", () => {
    expect(formatKey({ key: "k", mod: true }, true)).toEqual(["⌘", "K"])
    expect(formatKey({ key: "k", mod: true }, false)).toEqual(["Ctrl", "K"])
    expect(formatKey({ key: "z", mod: true, shift: true }, true)).toEqual(["⌘", "⇧", "Z"])
    expect(formatKey({ key: "Enter", mod: true }, false)).toEqual(["Ctrl", "Enter"])
    expect(formatKey({ key: "ArrowDown", mod: true }, true)).toEqual(["⌘", "↓"])
    expect(formatKeys(byId("go.docs"), true)).toEqual([["G", "D"]])
  })
  test("isEditable·blockedSingleKey", () => {
    expect(isEditable(editor)).toBe(true)
    expect(isEditable({ tagName: "SPAN", closest: (s: string) => (s.includes("contenteditable") ? {} : null) })).toBe(true)
    expect(isEditable(body)).toBe(false)
    expect(blockedSingleKey(ev("n"), body, false)).toBe(false)
    expect(blockedSingleKey(ev("n"), body, true)).toBe(true)
  })
  test("screenOf", () => {
    expect(screenOf("#/docs")).toBe("docs")
    expect(screenOf("#/docs?view=icon")).toBe("docs")
    expect(screenOf("#/docs/doc%3Aabc")).toBe("doc")
    expect(screenOf("#/w/item%3Ab%3Ai")).toBe("work")
    expect(screenOf("#/list")).toBe("list")
    expect(screenOf("")).toBe("home")
  })
})

describe("레지스트리", () => {
  test("id 는 하나씩, 키나 이어 누르기 중 하나는 있음", () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length)
    for (const s of SHORTCUTS) expect(!!s.keys?.length || !!s.sequence?.length).toBe(true)
  })
  test("겹치는 화면에서 같은 키를 두 번 쓰지 않음", () => {
    expect(conflicts()).toEqual([])
  })
  test("충돌 검사는 실제로 잡아냄: 입력 중에도 먹는 ⌘B 는 편집기 굵게와 충돌", () => {
    const bad: Shortcut[] = SHORTCUTS.map((s) => (s.id === "sidebar.toggle" ? { ...s, whileTyping: true } : s))
    expect(conflicts(bad)).toContainEqual(["sidebar.toggle", "editor.bold"])
    const twice: Shortcut[] = [...SHORTCUTS, { ...byId("theme.toggle"), id: "x.other", screens: ["docs"] }]
    expect(conflicts(twice)).toContainEqual(["theme.toggle", "x.other"])
  })
  test("예약 키 겹침은 없음(work/ai-capture 의 자리는 처리기로 바뀜)", () => {
    expect(reservedOverlaps()).toEqual([])
  })
  test("AI로 올리기: 한 줄 ⌘↵, 시트는 ⌘⇧↵ 이고 시트 ⌘↵(사람 추가)와 섞이지 않음", () => {
    expect(byId("quickAdd.ai").owner).toBe("local")
    expect(matches(ev("Enter", { metaKey: true }), "quickAdd.ai")).toBe(true)
    expect(matches(ev("Enter", { ctrlKey: true, shiftKey: true }), "sheet.ai")).toBe(true)
    expect(matches(ev("Enter", { metaKey: true, shiftKey: true }), "sheet.submit")).toBe(false)
    expect(matches(ev("Enter", { metaKey: true }), "sheet.ai")).toBe(false)
  })
  test("⌘,·Ctrl+, 는 설정 열기(settings.open): 입력 중·창이 열려 있어도, 누르고 있으면 아님, 목록은 얼려 둠", () => {
    expect(byId("settings.open").owner).toBe("global")
    expect(id(ev(",", { metaKey: true }), { target: input })).toBe("settings.open")
    expect(id(ev(",", { ctrlKey: true }), { overlay: true })).toBe("settings.open")
    expect(id(ev(",", { metaKey: true, repeat: true }))).toBeNull()
    expect(id(ev(","))).toBeNull()
    const live = SHORTCUTS.filter((s) => s.owner !== "reserved" && s.id !== "settings.open").flatMap((s) => (s.keys ?? []).map(keyId))
    expect(live).not.toContain(keyId({ key: ",", mod: true }))
    expect(Object.isFrozen(SHORTCUTS)).toBe(true)
  })
  test("사용자 표(docs/user/shortcuts.md)에 모든 단축키가 같은 키로 있음", async () => {
    const table = await Bun.file(new URL("../../../../docs/user/shortcuts.md", import.meta.url)).text()
    for (const s of SHORTCUTS) {
      const row = table.split("\n").find((l) => l.includes("`" + s.id + "`"))
      expect(row, s.id).toBeDefined()
      expect(row).toContain(formatKeys(s, false).map((x) => x.join(s.sequence ? " 다음 " : "+")).join(" / "))
    }
  })
  test("브라우저 예약 키를 쓰지 않음", () => {
    const used = SHORTCUTS.filter((s) => s.owner === "global" || s.owner === "local").flatMap((s) => (s.keys ?? []).map(keyId))
    for (const r of BROWSER_RESERVED) expect(used).not.toContain(keyId(r))
  })
})
