import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initOps, startOpsScheduler } from "./ops.ts";

test("scheduler runs only the configured Mac owner's enabled row", async () => {
  const db = new Database(":memory:");
  initOps(db);
  db.exec("CREATE TABLE runs(id TEXT, owner TEXT, kind TEXT, status TEXT); CREATE TABLE signals(owner TEXT, status TEXT, ref TEXT, title TEXT, lane TEXT, updated_at INTEGER)");
  const insert = db.query("INSERT INTO ops_prompt(owner,text,enabled,every_min,active_from,active_to,updated_at) VALUES (?, 'test', 1, 120, 0, 24, 0)");
  insert.run("owner@example.com");
  insert.run("other@example.com");
  const started: string[] = [];
  const deps = {ingest:()=>({}), personalBoard:()=>null, readItem:()=>null, putItem:()=>{}, port:1234,
    startRun:async (owner:string) => {started.push(owner); return {id:"run"};}};
  const originalTimeout = globalThis.setTimeout, originalInterval = globalThis.setInterval;
  let tick: (() => Promise<void>) | undefined;
  try {
    globalThis.setTimeout = ((fn: () => Promise<void>) => { tick = fn; return 0; }) as unknown as typeof setTimeout;
    globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
    startOpsScheduler(db, deps, "owner@example.com");
    expect(tick).toBeDefined();
    await tick!();
    expect(started).toEqual(["owner@example.com"]);
    expect(db.query("SELECT last_run_id FROM ops_prompt WHERE owner=?").get("other@example.com")).toEqual({last_run_id:null});
  } finally {
    globalThis.setTimeout = originalTimeout;
    globalThis.setInterval = originalInterval;
    db.close();
  }
});
