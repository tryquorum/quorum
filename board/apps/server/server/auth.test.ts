import { describe, expect, test } from "bun:test";
import { createAuth, normalizeTeam } from "./auth.ts";

const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid: "test" };
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
async function token(payload: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = pair.privateKey) {
  const content = `${encode({ alg: "RS256", kid: "test", ...header })}.${encode({ iss: "https://test-team.cloudflareaccess.com", aud: ["test-aud"], exp: now + 600, email: "Jun@LidgeAI.com", ...payload })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(content));
  return `${content}.${Buffer.from(sig).toString("base64url")}`;
}
const auth = createAuth({ team: "test-team", aud: "test-aud", allowed: ["jun@lidgeai.com"], agentToken: "test-token", agentOwner: "jun@lidgeai.com", devLocalUser: "jun@lidgeai.com", host: "127.0.0.1", fetch: async () => Response.json({ keys: [jwk] }) });

describe("Access JWT", () => {
  test("normalizes team names", () => {
    expect(normalizeTeam("test-team")).toBe("test-team.cloudflareaccess.com");
    expect(normalizeTeam("https://example.com///")).toBe("example.com");
  });
  test("accepts signed claims and normalizes email", async () => {
    expect(await auth.verifyAccessJwt(await token())).toBe("jun@lidgeai.com");
    expect((await auth.who(new Request("http://localhost", { headers: { "cf-access-jwt-assertion": await token() } }), "public"))?.email).toBe("jun@lidgeai.com");
  });
  test("rejects invalid claims, algorithms, signatures and email outside allowlist", async () => {
    const invalid = [await token({}, {alg:"none"}), await token({}, {alg:"HS256"}), await token({}, {}, other.privateKey), await token({aud:"wrong"}), await token({iss:"https://wrong"}), await token({exp:now-1}), await token({exp:null}), await token({nbf:now+120})];
    for (const jwt of invalid) expect(await auth.verifyAccessJwt(jwt)).toBeNull();
    const outsider = await token({email:"other@example.com"});
    expect(await auth.who(new Request("http://localhost", {headers:{"cf-access-jwt-assertion":outsider}}), "public")).toBeNull();
  });
  test("fails closed on JWKS errors and an empty public allowlist", async () => {
    const config = {team:"test-team", aud:"test-aud", allowed:[] as string[], agentToken:"", agentOwner:"jun@lidgeai.com", devLocalUser:"", host:"127.0.0.1"};
    const signed = await token();
    const failing = createAuth({...config, fetch: async () => { throw new Error("network failure"); }});
    expect(await failing.verifyAccessJwt(signed)).toBeNull();
    const empty = createAuth({...config, fetch: async () => Response.json({keys:[jwk]})});
    expect(await empty.who(new Request("http://localhost",{headers:{"cf-access-jwt-assertion":signed}}),"public")).toBeNull();
  });
  test("refreshes unknown keys after cooldown and shares concurrent JWKS refreshes", async () => {
    // 갱신이 계속 실패하면 오래된 키 목록은 12시간까지만 쓴다
    {
      let clock = now * 1000, up = true;
      const cfg = {team:"test-team", aud:"test-aud", allowed:["jun@lidgeai.com"], agentToken:"", agentOwner:"jun@lidgeai.com", devLocalUser:"", host:"127.0.0.1"};
      const stale = createAuth({...cfg, now:()=>clock, fetch:async () => { if (!up) throw new Error("down"); return Response.json({keys:[jwk]}); }});
      const signed = await token({exp:now+86400});
      expect(await stale.verifyAccessJwt(signed)).toBe("jun@lidgeai.com");
      up = false; clock += 2 * 3600_000;
      expect(await stale.verifyAccessJwt(signed)).toBe("jun@lidgeai.com");
      clock += 10 * 3600_000;
      expect(await stale.verifyAccessJwt(signed)).toBeNull();
    }
    // (아래 시험과 별개) 첫 조회가 실패하면 60초 동안 다시 받지 않는다
    {
      let clock = now * 1000, fetches = 0, up = false;
      const cfg = {team:"test-team", aud:"test-aud", allowed:["jun@lidgeai.com"], agentToken:"", agentOwner:"jun@lidgeai.com", devLocalUser:"", host:"127.0.0.1"};
      const flaky = createAuth({...cfg, now:()=>clock, fetch:async () => { fetches++; if (!up) throw new Error("down"); return Response.json({keys:[jwk]}); }});
      const signed = await token();
      expect(await flaky.verifyAccessJwt(signed)).toBeNull();
      expect(await flaky.verifyAccessJwt(signed)).toBeNull();
      expect(fetches).toBe(1);
      up = true; clock += 60_000;
      expect(await flaky.verifyAccessJwt(signed)).toBe("jun@lidgeai.com");
      expect(fetches).toBe(2);
    }
    let clock = now * 1000, fetches = 0;
    let published = [jwk];
    const rotated = {...await crypto.subtle.exportKey("jwk",other.publicKey),kid:"rotated"};
    const config = {team:"test-team", aud:"test-aud", allowed:["jun@lidgeai.com"], agentToken:"", agentOwner:"jun@lidgeai.com", devLocalUser:"", host:"127.0.0.1"};
    const instance = createAuth({...config, now:()=>clock, fetch:async () => { fetches++; await Promise.resolve(); return Response.json({keys:published}); }});
    const oldToken = await token({exp:now+7200});
    const newToken = await token({exp:now+7200},{kid:"rotated"},other.privateKey);
    expect(await Promise.all([instance.verifyAccessJwt(oldToken),instance.verifyAccessJwt(oldToken)])).toEqual(["jun@lidgeai.com","jun@lidgeai.com"]);
    expect(fetches).toBe(1);
    published = [rotated];
    expect(await Promise.all([instance.verifyAccessJwt(newToken),instance.verifyAccessJwt(newToken)])).toEqual([null,null]);
    expect(fetches).toBe(1);
    clock += 60_000;
    expect(await Promise.all([instance.verifyAccessJwt(newToken),instance.verifyAccessJwt(newToken)])).toEqual(["jun@lidgeai.com","jun@lidgeai.com"]);
    expect(fetches).toBe(2);
    clock += 3600_000;
    expect(await Promise.all([instance.verifyAccessJwt(newToken),instance.verifyAccessJwt(newToken)])).toEqual(["jun@lidgeai.com","jun@lidgeai.com"]);
    expect(fetches).toBe(3);
  });
  test("does not grant public access from loopback headers or missing allowlist", async () => {
    const request = new Request("http://localhost", {headers:{host:"localhost", "x-forwarded-for":"127.0.0.1"}});
    expect(await auth.who(request, "public")).toBeNull();
    expect((await auth.who(request, "local"))?.email).toBe("jun@lidgeai.com");
  });
});
