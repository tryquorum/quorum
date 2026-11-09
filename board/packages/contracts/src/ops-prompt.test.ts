import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { checkLines, joinPrompt, replaceBody, restoreEol, splitPrompt, toLF } from "./ops-prompt.ts"

const DEFAULT = readFileSync(join(import.meta.dir, "../../../apps/server/server/ops-prompt.md"), "utf8")
const round = (s: string) => joinPrompt(splitPrompt(s), s)

describe("지시문 조각", () => {
  test("기본 지시문: 머리글, ## 묶음, ### 영역으로 나뉘고 그대로 다시 이어져요", () => {
    const parts = splitPrompt(DEFAULT)
    expect(round(DEFAULT)).toBe(DEFAULT)
    expect(parts[0]).toMatchObject({ level: 0, title: null })
    expect(parts.filter((p) => p.level === 3).map((p) => p.title)).toContain("1. opencodex (영역: opencodex)")
    expect(parts.filter((p) => p.level === 2).map((p) => p.title)).toEqual(["영역별 할 일과 확인할 곳", "나를 불러야 하는 조건 (이것만 \"지금\"이나 \"결정 대기\"로)", "하지 말 것"])
    expect(checkLines(parts.find((p) => p.title?.startsWith("1."))?.body ?? "")).toBe(5)
  })
  test("CRLF·끝 줄바꿈 없음·제목 없음·빈 글도 그대로", () => {
    for (const s of ["# 제목\r\n\r\n### 하나\r\n- a\r\n### 둘\r\n- b", "그냥 글\n둘째 줄", "", "### 첫 줄부터 영역\n- a\n"]) expect(round(s)).toBe(s)
    expect(splitPrompt("### 첫 줄부터 영역\n- a\n").map((p) => p.level)).toEqual([3])
  })
  test("코드 펜스 안의 ### 는 제목이 아니고, 닫히지 않은 펜스 뒤로는 나누지 않아요", () => {
    const s = "### 하나\n```\n### 펜스 안\n```\n### 둘\n~~~\n### 안 닫힘\n### 여전히 안\n"
    expect(round(s)).toBe(s)
    expect(splitPrompt(s).map((p) => p.title)).toEqual(["하나", "둘"])
  })
  test("한 조각 본문을 바꾸면 다른 조각은 바이트 그대로", () => {
    const parts = splitPrompt(DEFAULT)
    const i = parts.findIndex((p) => p.title?.startsWith("4."))
    const next = replaceBody(DEFAULT, i, "- 새 줄\n")
    const after = splitPrompt(next)
    expect(after.length).toBe(parts.length)
    after.forEach((p, k) => { if (k !== i) expect(next.slice(p.start, p.end)).toBe(DEFAULT.slice(parts[k].start, parts[k].end)) })
    expect(after[i].body).toBe("- 새 줄\n")
  })
  test("본문 끝 줄바꿈을 지워도(끝에 바로 써도) 다음 제목은 제 줄에 남아요", () => {
    const s = "### 하나\n- a\n\n### 둘\n- b"
    const next = replaceBody(s, 0, "- a\n\n- 새 줄")
    expect(next).toBe("### 하나\n- a\n\n- 새 줄\n### 둘\n- b")
    expect(splitPrompt(next).map((p) => p.title)).toEqual(["하나", "둘"])
    // 마지막 조각은 그대로(끝 줄바꿈을 만들지 않음)
    expect(replaceBody(s, 1, "- b2")).toBe("### 하나\n- a\n\n### 둘\n- b2")
  })
})

describe("줄바꿈", () => {
  test("CRLF 원본에서 한 글자 고치면 고친 곳 말고는 바이트 그대로", () => {
    const original = "# 제목\r\n### 하나\r\n- a\r\n- b\r\n"
    const edited = toLF(original).replace("- a", "- A")
    expect(restoreEol(edited, original)).toBe(original.replace("- a", "- A"))
  })
  test("LF 원본과 섞인 원본은 LF 그대로", () => {
    expect(restoreEol("a\nb\n", "a\nb\n")).toBe("a\nb\n")
    expect(restoreEol("a\nb\n", "a\r\nb\n")).toBe("a\nb\n")
  })
})
