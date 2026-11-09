import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Md } from "./md"

const sample = [
  "**지금 상태**",
  "- 참가는 승인됐어요(`approved`).",
  "",
  "1. [ ] **지금 바로:** 와이파이에 연결해요.",
  "2. [x] 빌드해요.",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "[Luma](https://luma.com/compiled-8lsr)",
  "<img src=x onerror=alert(1)><script>alert(1)</script>",
].join("\n")

test("workspace Md renders GFM: ordered lists, task checkboxes, tables and links", () => {
  const html = renderToStaticMarkup(<Md text={sample} />)
  expect(html).toContain("<ol")
  expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/)
  expect(html).toMatch(/<input[^>]*checked/)
  expect(html).toContain("<table")
  expect(html).toMatch(/<a[^>]*href="https:\/\/luma.com\/compiled-8lsr"[^>]*target="_blank"/)
  expect(html).not.toContain("1. [ ]")
})

test("workspace Md never turns agent output into live HTML", () => {
  const html = renderToStaticMarkup(<Md text={sample} />)
  expect(html).not.toContain("<script")
  expect(html).not.toMatch(/<img[^>]*onerror/)
})
