import { expect, test } from "bun:test"
import { ApiError } from "./api"
import { loadDocTags, loadInLinks } from "./docs-api"

// 노트가 없어 아직 문서가 아닌 일(이슈로 들어온 회사 할 일 등)은 일 화면에서 오류가 아니라 '연결·태그 없음'이에요
const missing = () => Promise.reject(new ApiError("Document not found", 404, { error: "Document not found" }))
const broken = () => Promise.reject(new ApiError("server error", 500, {}))

test("문서가 아닌 일의 역링크는 빈 목록, 다른 실패는 그대로 오류", async () => {
  expect(await loadInLinks("item:b:1", missing)).toEqual({ edges: [], truncated: false })
  await expect(loadInLinks("item:b:1", broken)).rejects.toThrow("server error")
})

test("문서가 아닌 일의 태그는 경고 없이 빈 목록, 다른 실패는 확인 못 함", async () => {
  expect(await loadDocTags("item:b:1", async () => null, missing)).toEqual({ tags: [], uncertain: false })
  expect(await loadDocTags("item:b:1", async () => null, broken)).toEqual({ tags: null, uncertain: true })
  expect(await loadDocTags("item:b:1", async () => [{ tag: "a", by: "person" }], missing)).toEqual({ tags: [{ tag: "a", by: "person" }], uncertain: false })
})

