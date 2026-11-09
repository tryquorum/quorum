import { test, expect } from "bun:test"
import { htmlToMarkdown } from "./html-to-markdown.ts"
test("wiki links in person notes survive html to markdown", () => {
  const md = htmlToMarkdown("<p>회의는 [[회의록 11월]] 참고, 배열 a[0] 는 그대로</p>")
  expect(md).toContain("[[회의록 11월]]")
  expect(md).toContain("a\\[0\\]")
})

