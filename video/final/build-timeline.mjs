#!/usr/bin/env node
// Builds video/final/timeline.json from the beat table in video/final/STORY.md (the single source for order, durations and captions).
// Synthetic beats use media/sc-<id>.mp4 from render-scenes.mjs. Product beats use captures in captures/<name>.vid2cap; without one a beat
// gets a labelled "capture pending" card, which is allowed only without --final. Award badges (beats 13, 15) read runs.json (written in wp2).
// Usage: node video/final/build-timeline.mjs [--final] [--out timeline.json]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beats } from "./render-scenes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FINAL = process.argv.includes("--final");
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 ? process.argv[outArg + 1] : join(HERE, "timeline.json");
const LIME = "#D9F99D", INK = "#FAFAFA", CREAM = "#F4ECD2", DARK = "#0A0A0A", CANVAS = "#F3F3F4";
const EYEBROW = { landing: "QUORUM.LIDGEAI.COM", story: "THE STORY ON THE LANDING PAGE", workspace: "YOUR BOARD", council: "GSTACK · FOUR ROLES ARGUE", execute: "ASIDE · RUNS ONLY WHAT PASSED", reuse: "GBRAIN · REMEMBERS THE VERDICT", heal: "RECIPES · RECORDED RUN RMW8PHBJ41FBE4B · NOV 9" };
const SYNTH = new Set(["hook", "boatmen", "fleet", "spin", "rocks", "mountain", "buried", "judgment", "converge", "mcp", "built", "cta"]);

// product beats → capture session + where in it (event label or seconds) + playback speed; filled in wp2 after recording
const CAPTURES = existsSync(join(HERE, "captures.json")) ? JSON.parse(readFileSync(join(HERE, "captures.json"), "utf8")) : {};
const RUNS = existsSync(join(HERE, "runs.json")) ? JSON.parse(readFileSync(join(HERE, "runs.json"), "utf8")) : null;

const clean = (c) => c.replace(/\s*\((small|the site|capture)[^)]*\)\s*/g, "").replace(/^\((.*)\)$/, "").trim();
const words = (s) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));

function caption(b) {
  const text = clean(b.caption);
  if (!text || b.id === "cta") return null;
  const serif = ["hook", "boatmen", "judgment", "converge"].includes(b.id);
  const light = !SYNTH.has(b.id);
  const base = { type: "kinetic", x: 960, align: "center", letterSpacing: serif ? 0 : -1,
    enter: { style: "rise", stagger: serif ? "0.12s" : "0.09s", duration: "0.4s" }, exit: { style: "fade", duration: "0.2s" } };
  const at = { converge: "0.3s", judgment: "0.2s", hook: "0.3s", boatmen: "0.15s", built: "0.1s" }[b.id] ?? "0.15s";
  const color = light ? DARK : serif ? CREAM : INK;
  const accentWords = { judgment: ["your", "judgment."], converge: ["Quorum."], hook: ["broth."] }[b.id] ?? [];
  const tokens = text.split(/\s+/).map((w, i, all) => ({ text: w, ...(accentWords.includes(w) ? { color: LIME } : {}), ...(b.id === "judgment" && w === "your" ? { newline: true } : {}) }));
  if (light) {
    const lx = ["council", "execute", "reuse"].includes(b.id) ? 100 : 272;
    return { ...base, x: lx, align: "left", y: 150, size: 46, maxWidth: 1400, gap: 0.26, font: "sans", weight: "semibold", color: INK, states: [{ at, tokens }] };
  }
  const layout = {
    hook: { y: 260, size: 116, maxWidth: 1500 }, boatmen: { y: 215, size: 84, maxWidth: 1500 }, judgment: { y: 250, size: 96, maxWidth: 1400 },
    converge: { y: 230, size: 120, maxWidth: 1400 }, built: { y: 330, size: 56, maxWidth: 1600 },
  }[b.id] ?? (light ? { y: 104, size: 52, maxWidth: 1700 } : { y: 200, size: 64, maxWidth: 1500 });
  return { ...base, ...layout, gap: serif ? 0.2 : 0.26, font: serif ? "serif" : "sans", weight: serif ? "regular" : "semibold", color, states: [{ at, tokens }] };
}

// Side panel for split product beats: names the tool doing the work and translates the Korean UI text on screen into English.
// Times are scene seconds; every number comes from runs.json (measured on the demo server).
function panel(kind, dur, SC = 1) {
  const nodes = [], tracks = [], X = 1330, W = 500, top = 250;
  let y = top;
  const show = (key, at0) => { const at = at0 * SC; tracks.push({ node: key, prop: "opacity", keys: [{ at: at.toFixed(2) + "s", value: 0 }, { at: (at + 0.3).toFixed(2) + "s", value: 1, ease: "out" }] },
    { node: key, prop: "y", keys: [{ at: at.toFixed(2) + "s", value: nodes.find((n) => n.key === key).y + 12 }, { at: (at + 0.35).toFixed(2) + "s", value: nodes.find((n) => n.key === key).y, ease: "out" }] }); };
  const text = (key, t, at, o = {}) => { nodes.push({ kind: "text", key, text: t, font: o.font ?? "sans", weight: o.weight ?? "semibold", size: o.size ?? 28, color: o.color ?? INK, x: X + (o.dx ?? 0), y, anchorX: 0, opacity: 0 }); show(key, at); y += o.gap ?? 44; };
  const logo = { gstack: "gstackLogo", gbrain: "gbrainLogo", aside: "asideLogo" }[kind];
  if (kind === "gbrain") { nodes.push({ kind: "image", key: "logo", source: logo, x: X, y: y + 4, width: 200, height: 52, fit: "contain", anchorX: 0, opacity: 0 }); show("logo", 0.2); }
  else {
    nodes.push({ kind: "image", key: "logo", source: logo, x: X + 28, y: y + 4, width: 56, height: 56, radius: 12, opacity: 0 }); show("logo", 0.2);
    nodes.push({ kind: "text", key: "name", text: kind, font: "sans", weight: "bold", size: 44, color: INK, x: X + 72, y: y + 4, anchorX: 0, opacity: 0 }); show("name", 0.25);
  }
  y += 76;
  if (kind === "gstack") {
    text("sub", "four roles question every proposal", 0.4, { size: 24, weight: "regular", color: "#9CA3AF", gap: 56 });
    ["CEO", "Reviewer", "QA", "CSO"].forEach((r, i) => {
      const key = "r" + i, x = X + [0, 96, 250, 322][i];
      nodes.push({ kind: "text", key, text: r, font: "mono", weight: "bold", size: 26, color: "#4B5060", x, y, anchorX: 0, opacity: 0 }); show(key, 0.5);
      tracks.push({ node: key, prop: "color", keys: [{ at: ((3.9 + i * 0.12) * SC).toFixed(2) + "s", value: "#4B5060" }, { at: ((4.15 + i * 0.12) * SC).toFixed(2) + "s", value: LIME, ease: "out" }] });
    });
    y += 70;
    const V = [["pass", "Shortlist YC RFS that fit Quorum", LIME], ["hold", "Draft the Northwind reply (not sent)", "#FBBF24"], ["hold", "Note the pricing call on your board", "#FBBF24"]];
    V.forEach(([d, t, c], i) => { text("vd" + i, d.toUpperCase(), 4.5 + i * 0.25, { font: "mono", weight: "bold", size: 24, color: c, gap: 0 }); y -= 0; nodes.at(-1).x = X; text("vt" + i, t, 4.5 + i * 0.25, { size: 26, dx: 96, gap: 50 }); });
  } else if (kind === "aside") {
    text("sub", "runs only what passed", 0.4, { size: 24, weight: "regular", color: "#9CA3AF", gap: 64 });
    text("a1", "PASS · aside is reading", 0.6, { font: "mono", weight: "bold", size: 24, color: LIME, gap: 40 });
    text("a2", "ycombinator.com/rfs", 0.7, { size: 28, gap: 64 });
    text("h1", "HOLD · the reply waits for you", 1.0, { font: "mono", weight: "bold", size: 24, color: "#FBBF24", gap: 40 });
    text("h2", "Approve or Reject. Nothing sent.", 1.1, { size: 28, gap: 64 });
    text("r1", "RESULT", 2.5, { font: "mono", weight: "bold", size: 24, color: LIME, gap: 40 });
    text("r2", "11 RFS read, 4 shortlisted", 2.6, { size: 28, gap: 44 });
  } else {
    text("sub", "remembers the verdict", 0.4, { size: 24, weight: "regular", color: "#9CA3AF", gap: 64 });
    text("m1", "RECALLED", 0.6, { font: "mono", weight: "bold", size: 24, color: LIME, gap: 40 });
    text("m2", RUNS ? RUNS.memoryPage : "quorum/verdicts/…", 0.7, { font: "mono", weight: "regular", size: 22, gap: 72 });
    text("t1", "FIRST RUN", 2.6, { font: "mono", weight: "bold", size: 24, color: "#9CA3AF", gap: 40 });
    text("t2", RUNS ? RUNS.firstSeconds + " s to verdicts" : "— s", 2.7, { size: 34, weight: "bold", gap: 60 });
    text("t3", "SAME REQUEST AGAIN", 2.9, { font: "mono", weight: "bold", size: 24, color: LIME, gap: 40 });
    text("t4", RUNS ? RUNS.reuseSeconds + " s, verdicts reused" : "— s", 3.0, { size: 34, weight: "bold", color: LIME, gap: 60 });
  }
  return { type: "stage", start: "0s", end: dur + "s", nodes, tracks, events: [{ at: "0.25s", kind: "token" }] };
}

const list = beats();
const sources = {
  gstackLogo: { type: "image", path: "media/logos/credit-gstack.png" },
  gbrainLogo: { type: "image", path: "media/logos/gbrain-mark.png" },
  asideLogo: { type: "image", path: "media/logos/aside-mark.png" },
};
const missing = RUNS ? [] : ["runs.json (award badge numbers from the real run)"];
const scenes = list.map((b) => {
  const scene = { id: b.id, duration: b.dur + "s", background: "#08080A", layers: [], notes: "beat " + b.n + ": " + b.picture.slice(0, 120) };
  if (SYNTH.has(b.id)) {
    const src = "sc_" + b.id; sources[src] = { type: "video", path: "media/sc-" + b.id + ".mp4", muted: true };
    if (!existsSync(join(HERE, "media/sc-" + b.id + ".mp4"))) missing.push("media/sc-" + b.id + ".mp4");
    scene.layers.push({ type: "media", source: src, fit: "cover" });
  } else {
    const cap = CAPTURES[b.id];
    const parts = cap ? (cap.parts ?? [{ in: cap.in }]).map((p) => ({ ...p, session: p.session ?? cap.session, speed: p.speed ?? cap.speed, camera: p.camera ?? cap.camera })) : [];
    if (parts.length && parts.every((p) => existsSync(join(HERE, p.session)))) {
      const win = cap.split ? { x: 100, y: 250, width: 1200, height: 675, radius: 20, shadow: true, border: true } : { x: 272, y: 214, width: 1376, height: 774, radius: 20, shadow: true, border: true }; // 16:9 so cover never crops the footage
      let t = 0;
      parts.forEach((p, k) => {
        const src = "cap_" + p.session.replace(/\W+/g, "_");
        sources[src] = { type: "capture", session: p.session };
        const end = k === parts.length - 1 ? b.dur : t + p.dur;
        scene.layers.push({ type: "media", source: src, fit: "cover", start: +t.toFixed(3), end: +end.toFixed(3), in: p.in, ...(p.speed ? { speed: p.speed } : {}), ...(p.camera ? { camera: p.camera } : {}), ...(cap.cursor ? { cursor: cap.cursor } : {}), window: win });
        t = end;
      });
    } else {
      missing.push("capture " + b.id);
      scene.layers.push({ type: "text", text: "CAPTURE PENDING · " + b.id, x: "center", y: 560, align: "center", font: "mono", weight: "bold", size: 44, color: "#9CA3AF" });
    }
    if (cap?.panel) scene.layers.push(panel(cap.panel.kind, b.dur, cap.panel.scale));
  }
  if (EYEBROW[b.id]) scene.layers.push({ type: "text", text: EYEBROW[b.id], x: ["council", "execute", "reuse"].includes(b.id) ? 100 : 272, y: 82, align: "left", font: "mono", weight: "bold", size: 22, color: LIME, animation: "fade", start: "0.05s" });
  const c = caption(b); if (c) scene.layers.push(c);
  return scene;
});
// dark → light when the product appears, light → dark for the close
const idx = (id) => scenes.findIndex((s) => s.id === id);
// v2: hard cuts only, so every cut stays on the 120 BPM grid (an overlapping transition would pull later cuts off it)

const at = (id) => list.find((b) => b.id === id).at;
const BPM = 120, BEAT = 60 / BPM;
// clicks in the captures, mapped to film time (scene start + (footage time − in) / speed); quieter when within 60 ms of a beat so they never stack on a kick
const footageToFilm = (id, footageS) => { const c = CAPTURES[id]; const p = (c.parts ?? [{ in: c.in }])[0]; return +(at(id) + (footageS - p.in) / (p.speed ?? c.speed ?? 1)).toFixed(3); };
const CLICKS = existsSync(join(HERE, "captures.json")) ? [footageToFilm("workspace", 1.855), footageToFilm("workspace", 4.702), footageToFilm("reuse", 5.087)] : [];
const onBeat = (tt) => Math.abs(tt / BEAT - Math.round(tt / BEAT)) * BEAT < 0.06;
const missingBed = !existsSync(join(HERE, "media/bed-v2.wav"));
if (missingBed) missing.push("media/bed-v2.wav (node music.mjs)");
const timeline = {
  $schema: "https://raw.githubusercontent.com/lidge-ai/vid2-gen/main/schema/timeline.v1.json",
  version: 1,
  output: { width: 1920, height: 1080, fps: 30, background: "#08080A" },
  beat: { bpm: BPM },
  sources: { ...sources, bed: { type: "audio", path: "media/bed-v2.wav" } },
  scenes,
  audio: {
    // the bed is arranged by music.mjs (buildup → roll → silent beat → drop at the convergence); vid2 masters it to −14 LUFS
    music: { source: "bed", volume: 1, fadeOut: "0.6s" },
    autoCues: false,
    cues: CLICKS.map((c) => ({ at: c, sfx: "preset:click", volume: onBeat(c) ? 0.18 : 0.4 })),
  },
};
writeFileSync(OUT, JSON.stringify(timeline, null, 1) + "\n");
const total = list.reduce((s, b) => s + b.dur, 0);
console.log(JSON.stringify({ ok: true, out: OUT, beats: list.length, authoredSeconds: +total.toFixed(2), missing }));
if (FINAL && missing.length) { console.error("PROXY ONLY: missing " + missing.join(", ")); process.exit(1); }
