import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const serverPath = resolve(import.meta.dir, "../server.ts");
const pair = await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);
const other = await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);
const jwk = {...await crypto.subtle.exportKey("jwk",pair.publicKey),kid:"test"};
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
async function jwt(payload: Record<string,unknown> = {}, header: Record<string,unknown> = {}, key = pair.privateKey) {
  const data = `${encode({alg:"RS256",kid:"test",...header})}.${encode({iss:"https://test-team.cloudflareaccess.com",aud:["test-aud"],exp:Math.floor(Date.now()/1000)+600,email:"Jun@LidgeAI.com",...payload})}`;
  return `${data}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(data))).toString("base64url")}`;
}
async function freePort(): Promise<number> {
  return new Promise((ok, fail) => { const s = createServer(); s.on("error",fail); s.listen(0,"127.0.0.1",() => { const port = (s.address() as {port:number}).port; s.close(() => ok(port)); }); });
}
let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function start(overrides: Record<string,string> = {}, samePort = false) {
  const dir = await mkdtemp(join(tmpdir(),"board-public-test-"));
  cleanup.push(() => rm(dir,{recursive:true,force:true}));
  let localPort = await freePort();
  while ([3070,3071,3090,3091].includes(localPort)) localPort = await freePort();
  let publicPort = await freePort();
  while (publicPort === localPort || [3070,3071,3090,3091].includes(publicPort)) publicPort = await freePort();
  if (samePort) publicPort = localPort;
  const preload = join(dir,"preload.ts");
  await writeFile(preload, `const original = globalThis.fetch;\nglobalThis.fetch = (input, init) => String(input) === "https://test-team.cloudflareaccess.com/cdn-cgi/access/certs" ? Promise.resolve(Response.json(${JSON.stringify({keys:[jwk]})})) : original(input, init);\n`);
  const env = {PATH: "/usr/bin:/bin", HOME: dir, PORT:String(localPort), PUBLIC_PORT:String(publicPort), HOST:"127.0.0.1", DEV_LOCAL_USER:"jun@lidgeai.com", AGENT_TOKEN:"test-token", ACCESS_TEAM:"test-team", ACCESS_AUD:"test-aud", ALLOWED_EMAILS:"jun@lidgeai.com", DB_PATH:join(dir,"board.db"), VAULT_DIR:join(dir,"vault"), ASIDE_BIN:"/usr/bin/false", GOAT_BIN:"/usr/bin/false", ASIDE_ACCOUNT:`test_${crypto.randomUUID()}`, ...overrides};
  const proc = Bun.spawn([process.execPath,"--preload",preload,serverPath],{cwd:dir,env,stdout:"pipe",stderr:"pipe"});
  cleanup.push(async () => {proc.kill(); await proc.exited;});
  const local = `http://127.0.0.1:${localPort}`, pub = `http://127.0.0.1:${publicPort}`;
  if (samePort || overrides.PUBLIC_PORT !== undefined) return {local,pub,proc,localPort,publicPort,dir};
  for (let i=0;i<100;i++) {
    try { if ((await fetch(`${local}/api/health`)).ok) return {local,pub,proc,localPort,publicPort,dir}; } catch {}
    if (proc.exitCode !== null) throw new Error(`server exited ${proc.exitCode}: ${await new Response(proc.stderr).text()}`);
    await Bun.sleep(50);
  }
  throw new Error("server startup timeout");
}
const headers = (token: string) => ({"cf-access-jwt-assertion":token});

describe("public listener", () => {
  test("local listener rejects hostile hosts and browser origins while allowing local and CLI writes", async () => {
    const {local,dir} = await start();
    expect((await fetch(`${local}/api/me`,{headers:{host:"attacker.example"}})).status).toBe(403);
    expect((await fetch(`${local}/mcp`,{headers:{host:"attacker.example"}})).status).toBe(403);
    const post = (extra: Record<string,string>) => fetch(`${local}/api/boards`,{method:"POST",headers:{"content-type":"application/json",...extra},body:"{}"});
    for (const extra of [{origin:"https://evil.example"},{origin:"https://localhost:5173"},{"sec-fetch-site":"cross-site"},{"sec-fetch-site":"same-site"}]) expect((await post(extra)).status).toBe(403);
    expect((await post({})).status).toBe(400);
    expect((await post({origin:"http://localhost:5173"})).status).toBe(400);
    const get = (path: string, extra: Record<string,string>) => fetch(`${local}${path}`,{headers:extra,redirect:"manual"});
    for (const site of ["cross-site","same-site"]) {
      expect((await get("/api/ops",{"sec-fetch-site":site,"sec-fetch-mode":"no-cors"})).status).toBe(403);
      expect((await get("/api/ops",{"sec-fetch-site":site,"sec-fetch-mode":"navigate"})).status).toBe(403);
      expect((await get("/mcp",{"sec-fetch-site":site,"sec-fetch-mode":"navigate"})).status).toBe(403);
      expect((await get("/",{"sec-fetch-site":site,"sec-fetch-mode":"navigate"})).status).not.toBe(403);
    }
    expect((await get("/api/me",{"sec-fetch-site":"same-origin","sec-fetch-mode":"cors"})).status).toBe(200);
    const { Database } = await import("bun:sqlite");
    const db = new Database(join(dir,"board.db"),{readonly:true});
    expect(db.query("SELECT owner FROM ops_prompt").all()).toEqual([]);
    db.close();
  }, 15000);
  test("separates authentication and sensitive authorization from the local listener", async () => {
    const {local,pub} = await start();
    expect((await fetch(`${local}/api/me`).then(r=>r.json()) as any).email).toBe("jun@lidgeai.com");
    expect((await fetch(`${pub}/api/health`)).status).toBe(200);
    for (const path of ["/api/state","/","/api/me"]) expect((await fetch(pub+path)).status).toBe(401);
    for (const h of [{host:"localhost"},{host:"127.0.0.1"},{"x-forwarded-for":"127.0.0.1"},{"cf-connecting-ip":"127.0.0.1"},{origin:"http://localhost"},{host:"localhost","x-forwarded-for":"127.0.0.1","cf-connecting-ip":"127.0.0.1",origin:"http://localhost"}]) {
      expect((await fetch(`${pub}/api/me`,{headers:h})).status).toBe(401);
      expect((await fetch(`${pub}/mcp`,{headers:h})).status).toBe(401);
    }
    const invalid = [await jwt({}, {}, other.privateKey), await jwt({}, {alg:"none"}), await jwt({aud:"wrong"}), await jwt({exp:1}), await jwt({email:"other@example.com"})];
    for (const bad of invalid) expect((await fetch(`${pub}/api/me`,{headers:headers(bad)})).status).toBe(401);
    expect((await fetch(`${pub}/api/me`,{headers:{authorization:"Bearer wrong"}})).status).toBe(401);
    const good = await jwt();
    const me = await fetch(`${pub}/api/me`,{headers:headers(good)});
    expect(me.status).toBe(200); expect((await me.json() as any).email).toBe("jun@lidgeai.com");
    const cookie = await fetch(`${pub}/api/me`,{headers:{cookie:`CF_Authorization=${good}`}});
    expect(cookie.status).toBe(200); expect((await cookie.json() as any).email).toBe("jun@lidgeai.com");
    expect((await fetch(`${pub}/mcp`,{headers:headers(good)})).status).toBe(401);
    expect((await fetch(`${pub}/mcp`,{headers:{authorization:"Bearer test-token"}})).status).toBe(405);
    for (const path of ["/api/ops/report","/api/act"]) expect((await fetch(pub+path,{method:"POST",headers:headers(good),body:"{}"})).status).toBe(403);
    expect((await fetch(`${pub}/api/models`,{headers:headers(good)})).status).toBe(200);
    expect((await fetch(`${pub}/api/runs`,{headers:headers(good)})).status).toBe(200);
    expect((await fetch(`${local}/mcp`)).status).toBe(405);
    expect((await fetch(`${pub}/api/act`,{method:"POST",headers:{authorization:"Bearer test-token"},body:"{}"})).status).toBe(400);
    const sweep = await fetch(`${pub}/api/ops/run`,{method:"POST",headers:headers(good)});
    expect(sweep.status).not.toBe(403);
    for (const extra of [{origin:"https://evil.example"},{"sec-fetch-site":"cross-site"}]) expect((await fetch(`${pub}/api/ops/run`,{method:"POST",headers:{...headers(good),...extra}})).status).toBe(403);
    expect((await fetch(`${pub}/api/runs`,{headers:{authorization:"Bearer test-token"}})).status).toBe(403);
    const privateSignal = await fetch(`${pub}/api/signals`,{method:"POST",headers:{...headers(good),"content-type":"application/json"},body:JSON.stringify({ref:"private",kind:"info",source:"test",title:"test",private:true})});
    expect(privateSignal.status).toBe(400);
    expect((await privateSignal.json() as any).error).toContain("private signals stay on the local board");
  }, 15000);
  test("allowed non-owner cannot use Mac-owner routes", async () => {
    const {pub,dir} = await start({ALLOWED_EMAILS:"jun@lidgeai.com,other@example.com"});
    const other = headers(await jwt({email:"other@example.com"}));
    expect((await fetch(`${pub}/api/me`,{headers:other})).status).toBe(200);
    expect((await fetch(`${pub}/api/models`,{headers:other})).status).toBe(403);
    expect((await fetch(`${pub}/api/runs`,{headers:other})).status).toBe(403);
    expect((await fetch(`${pub}/api/ops`,{headers:other})).status).toBe(403);
    expect((await fetch(`${pub}/api/ops`,{method:"PUT",headers:other,body:"{}"})).status).toBe(403);
    expect((await fetch(`${pub}/api/ops/run`,{method:"POST",headers:other})).status).toBe(403);
    expect((await fetch(`${pub}/api/ops/report`,{method:"POST",headers:other,body:"{}"})).status).toBe(403);
    expect((await fetch(`${pub}/api/files/local?path=${encodeURIComponent(join(dir,"shot.png"))}`,{headers:other})).status).toBe(403);
    const { Database } = await import("bun:sqlite");
    const db = new Database(join(dir,"board.db"),{readonly:true});
    expect(db.query("SELECT owner FROM ops_prompt WHERE owner=?").get("other@example.com")).toBeNull();
    db.close();
    const state = await (await fetch(`${pub}/api/state`,{headers:other})).json() as {boards:{id:string;mine:boolean}[]};
    const board = state.boards.find(b => b.mine)!;
    const item = await (await fetch(`${pub}/api/boards/${board.id}/items`,{method:"POST",headers:{...other,"content-type":"application/json"},body:JSON.stringify({type:"todo",text:"test"})})).json() as {id:string};
    expect(item.id).toBeDefined();
    expect((await fetch(`${pub}/api/boards/${board.id}/items/${item.id}/handoff`,{method:"POST",headers:other,body:"{}"})).status).toBe(403);
  }, 15000);
  test("quick add routes work for the owner on the public listener", async () => {
    const {pub} = await start();
    const h = {...headers(await jwt()), "content-type":"application/json", "sec-fetch-site":"same-origin"};
    const state = await (await fetch(`${pub}/api/state`,{headers:h})).json() as {boards:{id:string;kind:string;mine:boolean}[]};
    const board = state.boards.find(b => b.kind === "personal" && b.mine);
    if (!board) throw new Error("personal board missing");
    const ref = encodeURIComponent(`item:${board.id}:quickadd1`);
    const item = await fetch(`${pub}/api/boards/${board.id}/items/quickadd1`,{method:"PUT",headers:h,body:JSON.stringify({type:"todo",text:"계약서 보내기",x:0,y:0,w:240,h:90,done:false,remindAt:"2026-11-08T15:00"})});
    expect(item.status).toBe(200);
    // 태그·속성만 있어도 빈 노트(expectedVersion 0)를 먼저 만들어 문서 레코드를 연다
    const note = await fetch(`${pub}/api/work/${ref}/note`,{method:"PUT",headers:h,body:JSON.stringify({html:"",text:"",md:"",expectedVersion:0})});
    expect(note.status).toBe(200);
    expect((await note.json() as {version:number}).version).toBe(1);
    const again = await fetch(`${pub}/api/work/${ref}/note`,{method:"PUT",headers:h,body:JSON.stringify({html:"",text:"",md:"",expectedVersion:0})});
    expect(again.status).toBe(409);
    const tags = await fetch(`${pub}/api/docs/${ref}/tags`,{method:"POST",headers:h,body:JSON.stringify({add:["계약"]})});
    expect(tags.status).toBe(200);
    expect((await tags.json() as {tags:string[]}).tags).toContain("계약");
    const props = await fetch(`${pub}/api/docs/${ref}/props`,{method:"POST",headers:h,body:JSON.stringify({set:{"금액":500},types:{"금액":"number"}})});
    expect(props.status).toBe(200);
    expect((await props.json() as {props:{key:string;value:unknown}[]}).props).toEqual([expect.objectContaining({key:"금액",value:500})]);
    expect((await fetch(`${pub}/api/act`,{method:"POST",headers:h,body:"{}"})).status).toBe(403);
  }, 15000);
  test("AI capture round trip on the owner public path with a fake aside, provenance kept and agents refused", async () => {
    const dir0 = await mkdtemp(join(tmpdir(),"board-capture-fake-"));
    cleanup.push(() => rm(dir0,{recursive:true,force:true}));
    const fake = join(dir0,"aside");
    // 가짜 aside: 지시문에서 실행에 묶인 act 주소를 찾아 할 일 하나와 결정 하나를 올린다
    await writeFile(fake, `#!/bin/sh
for a in "$@"; do last="$a"; done
url=$(printf '%s' "$last" | grep -o 'http://127.0.0.1:[0-9]*/api/act?run=[A-Za-z0-9-]*' | head -1)
echo "session: fake123456" >&2
printf '%s' '{"actions":[{"do":"task","title":"겜스고 구독 만료일 확인하기","note":"## 상황\\n가짜 실행기가 만든 할 일","area":"업무","tags":["구독"]},{"do":"decide","title":"겜스고 연장할지 정하기","body":"1년 연장 / 해지"}]}' > "$FAKE_DIR/act.json"
/usr/bin/curl -s -X POST "$url" -H 'content-type: application/json' --data-binary @"$FAKE_DIR/act.json" > "$FAKE_DIR/out.json"
echo "할 일 1개와 결정 1개를 올렸어요"
`, {mode: 0o755});
    const {pub,local} = await start({ASIDE_BIN: fake, FAKE_DIR: dir0});
    const h = {...headers(await jwt()), "content-type":"application/json", "sec-fetch-site":"same-origin"};
    const bearer = {authorization:"Bearer test-token","content-type":"application/json"};
    expect((await fetch(`${pub}/api/state`,{headers:h})).status).toBe(200);
    expect((await fetch(`${pub}/api/runs`,{method:"POST",headers:bearer,body:JSON.stringify({kind:"capture",prompt:"겜스고 연장",clientKey:"x"})})).status).toBe(403);
    const started = await fetch(`${pub}/api/runs`,{method:"POST",headers:h,body:JSON.stringify({kind:"capture",prompt:"겜스고 연장 어떻게 할지 처리",clientKey:"k-e2e",hints:{area:"업무"}})});
    expect(started.status).toBe(201);
    const run = await started.json() as {id:string};
    expect((await fetch(`${pub}/api/act?run=${run.id}`,{method:"POST",headers:bearer,body:JSON.stringify({actions:[{do:"decide",title:"에이전트가 끼어든 질문"}]})})).status).toBe(403);
    let view: {run:{status:string};effects:{ref:string;op:string;undoable:boolean}[]} = {run:{status:"running"},effects:[]};
    for (let i=0;i<100 && view.run.status === "running";i++) { await Bun.sleep(50); view = await (await fetch(`${pub}/api/runs/${run.id}/effects`,{headers:h})).json() as typeof view; }
    expect(view.run.status).toBe("done");
    expect(view.effects.map(e => e.op).sort()).toEqual(["created","decision"]);
    const created = view.effects.find(e => e.op === "created")!;
    const decision = view.effects.find(e => e.op === "decision")!;
    expect([created.undoable, decision.undoable]).toEqual([true, true]);
    expect((await fetch(`${local}/api/act?run=${run.id}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({actions:[{do:"decide",title:"끝난 실행의 늦은 질문"}]})})).status).toBe(409);
    expect((await fetch(`${pub}/api/runs/${run.id}/undo`,{method:"POST",headers:h,body:JSON.stringify({ref:decision.ref})})).status).toBe(200);
    const [, bid, iid] = created.ref.split(":");
    const state = await (await fetch(`${pub}/api/state`,{headers:h})).json() as {items:{id:string;capture?:string;agent?:boolean;text:string}[]};
    const item = state.items.find(x => x.id === iid)!;
    expect([item.capture, item.agent]).toEqual([run.id, true]);
    const saved = await fetch(`${pub}/api/boards/${bid}/items/${iid}`,{method:"PUT",headers:h,body:JSON.stringify({...item,text:"사람이 고친 제목",capture:"forged"})});
    expect((await saved.json() as {capture:string}).capture).toBe(run.id);
    expect((await fetch(`${pub}/api/runs/${run.id}/undo`,{method:"POST",headers:h,body:JSON.stringify({ref:created.ref})})).status).toBe(409);
  }, 20000);
  test("mobile login hands the verified Access token only to the fixed app callback", async () => {
    const {local,pub} = await start();
    const state = "s".repeat(20) + "_-AZaz09" + "x".repeat(10);
    const good = await jwt();
    const go = (base: string, query: string, extra: Record<string,string> = {}, method = "GET") =>
      fetch(`${base}/api/mobile/auth${query}`,{method,headers:extra,redirect:"manual"});
    const ok = await go(pub, `?state=${state}&redirect_uri=https%3A%2F%2Fevil.example%2F&token=forged`, headers(good));
    expect(ok.status).toBe(302);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const location = new URL(ok.headers.get("location")!);
    expect(`${location.protocol}//${location.host}${location.pathname}`).toBe("direction://auth");
    expect(location.searchParams.get("state")).toBe(state);
    expect(location.searchParams.get("token")).toBe(good);
    expect([...location.searchParams.keys()].sort()).toEqual(["state","token"]);
    // 헤더 없음, 서명이 다른 키, 만료, 허용되지 않은 이메일은 Access 로그인이 아니에요
    for (const extra of [{}, headers(await jwt({}, {}, other.privateKey)), headers(await jwt({exp:1})), headers(await jwt({email:"other@example.com"}))])
      expect((await go(pub, `?state=${state}`, extra)).status).toBe(401);
    // 쿠키만으로 인증된 요청은 넘길 토큰을 Cloudflare 가 붙인 헤더에서 얻지 못해요
    expect((await go(pub, `?state=${state}`, {cookie:`CF_Authorization=${good}`})).status).toBe(401);
    expect((await go(pub, `?state=${state}`, {authorization:"Bearer test-token"})).status).toBe(403);
    for (const bad of ["", "?state=short", `?state=${state}!`, `?state=${state}&state=${state}`, `?state=${"a".repeat(129)}`])
      expect((await go(pub, bad, headers(good))).status).toBe(400);
    expect((await go(pub, `?state=${state}`, headers(good), "POST")).status).toBe(405);
    // 로컬 리스너는 DEV_LOCAL_USER 로 들어와도, 허용 JWT 헤더가 있어도 토큰을 넘기지 않아요
    expect((await go(local, `?state=${state}`)).status).toBe(403);
    expect((await go(local, `?state=${state}`, headers(good))).status).toBe(403);
    for (const response of [ok]) expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  }, 15000);
  test("rejects a public port equal to the local port", async () => {
    const {local,proc} = await start({}, true);
    expect(await proc.exited).not.toBe(0);
    await expect(fetch(`${local}/api/health`)).rejects.toThrow();
    expect(await new Response(proc.stderr).text()).toContain("PUBLIC_PORT must be a valid port different from PORT");
  }, 15000);
  test("treats an empty PUBLIC_PORT as unset and keeps the local listener", async () => {
    const {local,proc} = await start({PUBLIC_PORT:""});
    let status = 0;
    for (let i=0;i<100 && !status;i++) { try { status = (await fetch(`${local}/api/me`)).status } catch { await Bun.sleep(50) } }
    expect(status).toBe(200);
    expect(proc.exitCode).toBeNull();
  }, 15000);
  for (const port of [" 0", "0", "65536", "1.5", "invalid"]) test(`rejects invalid public port ${JSON.stringify(port)} before binding`, async () => {
    const {local,proc} = await start({PUBLIC_PORT:port});
    expect(await proc.exited).not.toBe(0);
    await expect(fetch(`${local}/api/health`)).rejects.toThrow();
    expect(await new Response(proc.stderr).text()).toContain("PUBLIC_PORT must be a valid port different from PORT");
  }, 15000);
  for (const missing of ["ACCESS_AUD","ALLOWED_EMAILS"]) test(`does not open public port without ${missing}`, async () => {
    const {local,pub} = await start({[missing]:""});
    expect((await fetch(`${local}/api/me`)).status).toBe(200);
    await expect(fetch(`${pub}/api/health`)).rejects.toThrow();
  }, 15000);
});
