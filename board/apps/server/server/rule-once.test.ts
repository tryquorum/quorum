// PR #39 리뷰 7 규칙 B: "이런 소식은 안 와도 돼/바로 알려줘"(feedback)는 규칙을 만들어요. 결과를 모른 채 다시 눌러도 같은 규칙이 두 번 생기지 않아요
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { startIsolated, type Isolated } from "./test/isolated.ts"

let s: Isolated
beforeAll(async () => { s = await startIsolated() }, 20000)
afterAll(async () => { await s?.stop() })
const local = (method: string, path: string, body?: unknown) => fetch(s.local + path, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })

test("같은 사건에 같은 feedback 을 두 번 보내도 규칙은 하나", async () => {
  const made = (await (await local("POST", "/api/signals", { kind: "info", title: "규칙 한 번 시험", source: "gmail" })).json()) as { id: string }
  expect((await local("PATCH", `/api/signals/${made.id}`, { feedback: "mute" })).status).toBe(200)
  expect((await local("PATCH", `/api/signals/${made.id}`, { feedback: "mute" })).status).toBe(200)
  const db = new Database(join(s.dir, "board.db"))
  const n = (db.query("SELECT COUNT(*) AS n FROM triage_rules WHERE source='gmail' AND kind='info' AND lane='info'").get() as { n: number }).n
  db.close()
  expect(n).toBe(1)
})

// PR #39 리뷰 8: 앱이 결과 불명 뒤 같은 키로 자동 재전송해도 되는지의 명시 증거
test("GET /api/settings 는 지키는 멱등 약속(capabilities)을 알려요", async () => {
  const s2 = (await (await local("GET", "/api/settings")).json()) as { capabilities?: string[] }
  expect(s2.capabilities).toEqual(["runClientKey", "noteOnceKey", "docCreateId"])
})

// PR #39 리뷰 9: 앱의 복구는 읽어서 확인만 해요. 그 확인에 쓰는 읽기 두 가지
test("GET /api/signals?ref 는 그 ref 의 사건만 돌려줘요(새 일 복구가 사건을 다시 만들지 않고 찾기)", async () => {
  await local("POST", "/api/signals", { kind: "info", title: "다른 사건", source: "ios", ref: "note-quote:other" })
  const made = (await (await local("POST", "/api/signals", { kind: "info", title: "찾을 사건", source: "ios", ref: "note-quote:k1" })).json()) as { id: string }
  const found = (await (await local("GET", "/api/signals?ref=" + encodeURIComponent("note-quote:k1"))).json()) as { signals: { id: string; ref: string }[] }
  expect(found.signals.map((x) => x.id)).toEqual([made.id])
  const none = (await (await local("GET", "/api/signals?ref=" + encodeURIComponent("note-quote:none"))).json()) as { signals: unknown[] }
  expect(none.signals).toEqual([])
})

test("GET /api/docs/:ref/note?onceKey 는 그 키가 이 노트에 이미 적용됐는지(onceApplied) 알려요", async () => {
  const doc = (await (await local("POST", "/api/docs", { title: "한 번 확인 " + Math.random(), md: "앞 글" })).json()) as { ref: string }
  const path = "/api/docs/" + encodeURIComponent(doc.ref)
  const before = (await (await local("GET", path + "/note?onceKey=run%3Aq1")).json()) as { onceApplied?: boolean }
  expect(before.onceApplied).toBe(false)
  expect((await local("POST", path + "/write", { mode: "append", md: "답", onceKey: "run:q1" })).status).toBe(200)
  const after = (await (await local("GET", path + "/note?onceKey=run%3Aq1")).json()) as { onceApplied?: boolean; md: string }
  expect(after.onceApplied).toBe(true)
  // 키를 묻지 않으면 필드가 없어요(예전 응답 그대로)
  expect("onceApplied" in ((await (await local("GET", path + "/note")).json()) as object)).toBe(false)
})
