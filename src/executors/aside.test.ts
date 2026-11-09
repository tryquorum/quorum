// 단계 1(자기 맥에서 바로) 시험: Aside 계정 자동 감지. aside 는 부르지 않고 가짜 출력을 넣어요.
import { describe, expect, test } from "bun:test"
import { asideArgs, pickAsideAccount, resolveAsideAccount } from "./aside"

const acct = (id: number, o: Record<string, unknown> = {}) => ({ id, name: "n" + id, provider: "google", mode: "cloud", authStatus: "active", hasSession: true, email: "user" + id + "@example.com", ...o })

describe("Aside account auto-detect", () => {
  test("uses the current account when it is signed in", () => {
    const r = pickAsideAccount({ currentAccountId: 0, accounts: [acct(0), acct(1)] })
    expect(r).toEqual({ account: "u0", email: "user0@example.com", source: "detected", reason: null })
  })
  test("falls back to the first signed-in account when the current one is signed out", () => {
    const r = pickAsideAccount({ currentAccountId: 1, accounts: [acct(0, { hasSession: false, email: undefined }), acct(1, { hasSession: false, provider: "anonymous", mode: "local", email: undefined }), acct(2)] })
    expect(r.account).toBe("u2")
    expect(r.email).toBe("user2@example.com")
  })
  test("no signed-in account: no account and a reason that says how to sign in", () => {
    const r = pickAsideAccount({ currentAccountId: 0, accounts: [acct(0, { hasSession: false }), acct(1, { hasSession: false })] })
    expect(r.account).toBeNull()
    expect(r.reason).toContain("aside login")
  })
  test("malformed output fails closed with a reason", () => {
    for (const bad of [null, "x", { accounts: "no" }, { accounts: [{ id: "u0", hasSession: true }] }]) {
      const r = pickAsideAccount(bad)
      expect(r.account).toBeNull()
      expect(r.reason).toBeTruthy()
    }
  })
  test("ASIDE_ACCOUNT wins without running aside; detection runs once and is cached", async () => {
    let runs = 0
    const run = async () => { runs++; return { code: 0, stdout: JSON.stringify({ currentAccountId: 0, accounts: [acct(0)] }) } }
    expect(await resolveAsideAccount({ env: "u3", run, fresh: true })).toEqual({ account: "u3", email: null, source: "env", reason: null })
    expect(runs).toBe(0)
    const a = await resolveAsideAccount({ env: "", run, fresh: true })
    const b = await resolveAsideAccount({ env: "", run })
    expect(a.account).toBe("u0")
    expect(b).toEqual(a)
    expect(runs).toBe(1)
  })
  test("aside missing or failing: no account, reason mentions installing Aside", async () => {
    const r = await resolveAsideAccount({ env: "", run: async () => ({ code: 127, stdout: "" }), fresh: true })
    expect(r.account).toBeNull()
    expect(r.reason).toContain("Aside")
  })
  test("asideArgs passes the resolved account", () => {
    expect(asideArgs("hi", { account: "u2" }).slice(0, 3)).toEqual(["exec", "--account", "u2"])
  })
})
