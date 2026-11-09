#!/usr/bin/env node
// Checks for the final film's sources and renders. Exit 0 only when every check passes; prints one line per check.
// Usage: node video/final/check.mjs [--film path.mp4] [--max 88.5] [--min 80]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { beats } from "./render-scenes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VID2 = join(process.env.HOME, "Developer/new/700_projects/vid2-gen/bin/vid2.js");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const FILM = arg("--film", join(HERE, "../out/final-proxy.mp4"));
const MIN = Number(arg("--min", 80)), MAX = Number(arg("--max", 88.5));
let failed = 0;
const check = (name, ok, detail = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : "")); if (!ok) failed++; };
const probe = (f) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height,codec_type", "-of", "json", f]).toString());

const list = beats();
const sum = list.reduce((s, b) => s + b.dur, 0);
check("beat sum within " + MIN + "–" + MAX + " s", sum >= MIN && sum <= MAX, sum.toFixed(2) + " s");
let at = 0, cont = true; for (const b of list) { if (Math.abs(b.at - at) > 0.01) cont = false; at += b.dur; }
check("beat start times are contiguous", cont);
const clean = (c) => c.replace(/\s*\((small|the site|capture)[^)]*\)\s*/g, "").replace(/^\((.*)\)$/, "").trim();
const slow = list.map((b) => { const c = clean(b.caption); const w = c ? c.split(/\s+/).filter((x) => /[A-Za-z0-9]/.test(x)).length : 0; return { id: b.id, w, wps: w / (b.dur - 0.4) }; }).filter((x) => x.wps > 2.3 && x.id !== "cta");
check("caption pace ≤ 2.3 words/s (dur − 0.4 s entrance)", slow.length === 0, slow.map((x) => x.id + " " + x.wps.toFixed(2)).join(", "));

const SYNTH = ["hook", "boatmen", "fleet", "spin", "rocks", "mountain", "buried", "judgment", "converge", "mcp", "built", "cta"];
const bad = [];
for (const b of list.filter((x) => SYNTH.includes(x.id))) {
  const f = join(HERE, "media/sc-" + b.id + ".mp4");
  if (!existsSync(f)) { bad.push(b.id + " missing"); continue; }
  const p = probe(f), v = p.streams.find((s) => s.codec_type === "video");
  if (v.width !== 1920 || v.height !== 1080) bad.push(b.id + " " + v.width + "x" + v.height);
  if (Math.abs(Number(p.format.duration) - b.dur) > 1 / 30 + 0.001) bad.push(b.id + " dur " + p.format.duration + " vs " + b.dur);
}
check("scene clips: 1920x1080, duration = beat ± 1 frame", bad.length === 0, bad.join("; ") || SYNTH.length + " clips");

const h1 = JSON.parse(execFileSync("node", [join(HERE, "render-scenes.mjs"), "--hash", "--only", "converge,buried"]).toString());
const h2 = JSON.parse(execFileSync("node", [join(HERE, "render-scenes.mjs"), "--hash", "--only", "converge,buried"]).toString());
check("deterministic frames (two renders, same SHA-256)", JSON.stringify(h1.scenes) === JSON.stringify(h2.scenes), h1.scenes.map((s) => s.id + ":" + s.hashes.join("/")).join(" "));

const empty = mkdtempSync(join(tmpdir(), "qvf-nologo-"));
const miss = spawnSync("node", [join(HERE, "render-scenes.mjs"), "--hash", "--only", "hook"], { env: { ...process.env, QVF_LOGO_DIR: empty } });
check("missing logo fails loudly", miss.status === 1 && /missing logo/.test(miss.stderr.toString()), "exit " + miss.status);

const tmpOut = join(empty, "t.json");
const proxy = spawnSync("node", [join(HERE, "build-timeline.mjs"), "--out", tmpOut]);
const fin = spawnSync("node", [join(HERE, "build-timeline.mjs"), "--final", "--out", tmpOut]);
const capsMissing = /capture /.test(proxy.stdout.toString());
check("builder: proxy build exits 0", proxy.status === 0);
check("builder: --final refuses missing captures/runs (and passes when complete)", capsMissing ? fin.status === 1 && /PROXY ONLY/.test(fin.stderr.toString()) : fin.status === 0, capsMissing ? "captures pending → exit " + fin.status : "complete → exit " + fin.status);

const v = JSON.parse(execFileSync("node", [VID2, "validate", join(HERE, "timeline.json"), "--json"]).toString());
check("vid2 validate timeline.json", v.ok === true, v.ok ? v.data.summary.totalSeconds + " s resolved" : JSON.stringify(v.error).slice(0, 200));
check("resolved timeline within " + MIN + "–" + MAX + " s", v.ok && v.data.summary.totalSeconds >= MIN && v.data.summary.totalSeconds <= MAX);

if (existsSync(FILM)) {
  const p = probe(FILM), d = Number(p.format.duration);
  check("film duration within " + MIN + "–" + MAX + " s (hard cap 90)", d >= MIN && d <= MAX && d <= 90, d.toFixed(2) + " s " + FILM.split("/").pop());
  const man = FILM + ".render.json";
  if (existsSync(man)) { const m = JSON.parse(readFileSync(man, "utf8")); const L = m.audio?.delivered?.integrated ?? m.data?.audio?.delivered?.integrated; check("loudness −14 ± 1 LUFS", typeof L === "number" && Math.abs(L + 14) <= 1, String(L)); }
} else check("film exists", false, FILM);
console.log(failed ? "CHECK FAILED (" + failed + ")" : "ALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
