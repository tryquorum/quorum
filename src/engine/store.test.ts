import { describe, expect, test } from "bun:test";
import { Store } from "./store";
import type { QuorumEvent } from "../contract";

function ev(runId: string, seq: number, overrides: Partial<QuorumEvent> = {}): QuorumEvent {
  return {
    runId,
    seq,
    at: new Date(Date.UTC(2026, 10, 9, 1, 0, seq)).toISOString(),
    mode: "live",
    type: "proposal",
    actor: "bot:ceo",
    text: `event ${seq}`,
    ...overrides,
  };
}

describe("Store", () => {
  test("round-trips a run with 3 events including nested data", () => {
    const store = new Store(":memory:");
    store.createRun({
      runId: "run-1",
      request: "summarize the inbox",
      mode: "live",
      startedAt: "2026-11-09T01:00:00.000Z",
    });
    const nested = {
      proposalId: "p1",
      tags: ["a", "b"],
      meta: { nested: { deep: true }, count: 2 },
    };
    store.appendEvent(ev("run-1", 0, { type: "run.start", data: undefined }));
    store.appendEvent(ev("run-1", 1, { type: "proposal", data: nested }));
    store.appendEvent(ev("run-1", 2, { type: "verdict", data: { decision: "pass" } }));

    const run = store.getRun("run-1");
    expect(run).toEqual({
      runId: "run-1",
      request: "summarize the inbox",
      mode: "live",
      startedAt: "2026-11-09T01:00:00.000Z",
      status: "running",
    });

    const events = store.getEvents("run-1");
    expect(events.length).toBe(3);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect("data" in events[0]).toBe(false);
    expect(events[1].data).toEqual(nested);
    expect(events[2].data).toEqual({ decision: "pass" });
    store.close();
  });

  test("afterSeq filters events strictly greater than the given seq", () => {
    const store = new Store(":memory:");
    store.createRun({ runId: "r", request: "q", mode: "live", startedAt: "2026-11-09T01:00:00.000Z" });
    store.appendEvent(ev("r", 0));
    store.appendEvent(ev("r", 1));
    store.appendEvent(ev("r", 2));

    expect(store.getEvents("r", 0).map((e) => e.seq)).toEqual([1, 2]);
    expect(store.getEvents("r", 1).map((e) => e.seq)).toEqual([2]);
    expect(store.getEvents("r", 2)).toEqual([]);
    expect(store.getEvents("r", -1).map((e) => e.seq)).toEqual([0, 1, 2]);
    store.close();
  });

  test("listRuns orders by started_at DESC and honors the limit", () => {
    const store = new Store(":memory:");
    store.createRun({ runId: "old", request: "a", mode: "live", startedAt: "2026-11-09T01:00:00.000Z" });
    store.createRun({ runId: "mid", request: "b", mode: "replay", startedAt: "2026-11-09T02:00:00.000Z", replayOf: "old" });
    store.createRun({ runId: "new", request: "c", mode: "live", startedAt: "2026-11-09T03:00:00.000Z" });

    const all = store.listRuns();
    expect(all.map((r) => r.runId)).toEqual(["new", "mid", "old"]);
    expect(store.listRuns(2).map((r) => r.runId)).toEqual(["new", "mid"]);
    expect(store.listRuns(0)).toEqual([]);
    expect(store.getRun("old")).toEqual({
      runId: "old",
      request: "a",
      mode: "live",
      startedAt: "2026-11-09T01:00:00.000Z",
      status: "running",
    });
    store.close();
  });

  test("finishRun changes the stored status and getRun reflects it", () => {
    const store = new Store(":memory:");
    store.createRun({ runId: "r", request: "q", mode: "live", startedAt: "2026-11-09T01:00:00.000Z" });
    expect(store.getRun("r")!.status).toBe("running");
    store.finishRun("r", "done");
    expect(store.getRun("r")!.status).toBe("done");
    store.finishRun("r", "error");
    expect(store.getRun("r")!.status).toBe("error");
    store.close();
  });

  test("getRun returns null for an unknown id", () => {
    const store = new Store(":memory:");
    expect(store.getRun("nope")).toBeNull();
    store.close();
  });

  test("events from two runs do not mix", () => {
    const store = new Store(":memory:");
    store.createRun({ runId: "a", request: "qa", mode: "live", startedAt: "2026-11-09T01:00:00.000Z" });
    store.createRun({ runId: "b", request: "qb", mode: "live", startedAt: "2026-11-09T02:00:00.000Z" });
    store.appendEvent(ev("a", 0, { text: "a0" }));
    store.appendEvent(ev("a", 1, { text: "a1" }));
    store.appendEvent(ev("b", 0, { text: "b0" }));

    expect(store.getEvents("a").map((e) => e.text)).toEqual(["a0", "a1"]);
    expect(store.getEvents("b").map((e) => e.text)).toEqual(["b0"]);
    store.close();
  });

  test("replayOf round-trips through getRun", () => {
    const store = new Store(":memory:");
    store.createRun({
      runId: "replay-1",
      request: "rerun",
      mode: "replay",
      startedAt: "2026-11-09T04:00:00.000Z",
      replayOf: "run-1",
    });
    const run = store.getRun("replay-1");
    expect(run).toEqual({
      runId: "replay-1",
      request: "rerun",
      mode: "replay",
      startedAt: "2026-11-09T04:00:00.000Z",
      status: "running",
      replayOf: "run-1",
    });
    expect("replayOf" in run!).toBe(true);
    store.close();
  });
});
