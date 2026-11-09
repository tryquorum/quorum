import { describe, expect, test } from "bun:test"
import { logoutKind } from "./logout"

describe("logoutKind", () => {
  test("리스너를 모르면 기다리고 로컬은 로그아웃하지 않아요", () => {
    expect(logoutKind(undefined, undefined)).toBe(null)
    expect(logoutKind("local", "google")).toBe(null)
  })
  test("공개 접속의 인증 방식에 맞는 로그아웃을 골라요", () => {
    expect(logoutKind("public", "google")).toBe("google")
    expect(logoutKind("public", "access")).toBe("access")
    expect(logoutKind("public", undefined)).toBe("access")
  })
})
