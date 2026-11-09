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
const SYNTH = new Set(["hook", "boatmen", "fleet", "spin", "rocks", "mountain", "buried", "judgment", "converge", "mcp", "built", "cta"]);

// product beats → capture session + where in it (event label or seconds) + playback speed; filled in wp2 after recording
const CAPTURES = existsSync(join(HERE, "captures.json")) ? JSON.parse(readFileSync(join(HERE, "captures.json"), "utf8")) : {};
const RUNS = existsSync(join(HERE, "runs.json")) ? JSON.parse(readFileSync(join(HERE, "runs.json"), "utf8")) : null;

const clean = (c) => c.replace(/\s*\((small|the site|capture)[^)]*\)\s*/g, "").replace(/^\((.*)\)$/, "").trim();
const words = (s) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));

function caption(b) {
  const text = clean(b.caption);
  if (!text || b.id === "cta" || b.id === "landing") return null;
  const serif = ["hook", "boatmen", "judgment", "converge"].includes(b.id);
  const light = !SYNTH.has(b.id);
  const base = { type: "kinetic", x: 960, align: "center", letterSpacing: serif ? 0 : -1,
    enter: { style: "rise", stagger: serif ? "0.12s" : "0.09s", duration: "0.4s" }, exit: { style: "fade", duration: "0.2s" } };
  const at = { converge: "3.3s", judgment: "0.5s", hook: "0.7s", boatmen: "0.2s" }[b.id] ?? "0.2s";
  const color = light ? DARK : serif ? CREAM : INK;
  const accentWords = { judgment: ["your", "judgment."], converge: ["Quorum."], hook: ["broth."] }[b.id] ?? [];
  const tokens = text.split(/\s+/).map((w, i, all) => ({ text: w, ...(accentWords.includes(w) ? { color: LIME } : {}), ...(b.id === "judgment" && w === "your" ? { newline: true } : {}) }));
  const layout = {
    hook: { y: 260, size: 116, maxWidth: 1500 }, boatmen: { y: 215, size: 84, maxWidth: 1500 }, judgment: { y: 500, size: 104, maxWidth: 1300 },
    converge: { y: 250, size: 120, maxWidth: 1400 }, built: { y: 330, size: 56, maxWidth: 1600 },
  }[b.id] ?? (light ? { y: 104, size: 52, maxWidth: 1700 } : { y: 200, size: 64, maxWidth: 1500 });
  return { ...base, ...layout, gap: serif ? 0.2 : 0.26, font: serif ? "serif" : "sans", weight: serif ? "regular" : "semibold", color, states: [{ at, tokens }] };
}

function badge(kind, dur) {
  // award beats: a lit badge that names the tool doing the work (gstack's four roles / gbrain's recall), stage nodes in the top-right
  const nodes = [], tracks = [];
  const x = 1480, y = 250;
  nodes.push({ kind: "rect", key: "bg", x, y, width: 520, height: kind === "gstack" ? 176 : 150, radius: 22, fill: "#0F1117F2", stroke: "#FFFFFF22", strokeWidth: 1.5, opacity: 0 });
  nodes.push({ kind: "image", key: "logo", source: kind + "Logo", x: x - 200, y: y - 40, width: 56, height: 56, radius: 12, opacity: 0 });
  nodes.push({ kind: "text", key: "title", text: kind, font: "sans", weight: "bold", size: 40, color: INK, x: x - 150, y: y - 40, anchorX: 0, opacity: 0 });
  for (const k of ["bg", "logo", "title"]) tracks.push({ node: k, prop: "opacity", keys: [{ at: "0.3s", value: 0 }, { at: "0.6s", value: 1, ease: "out" }] });
  tracks.push({ node: "bg", prop: "scale", keys: [{ at: "0.3s", value: 0.94 }, { at: "0.6s", value: 1, ease: "spring" }] });
  if (kind === "gstack") {
    ["CEO", "Reviewer", "QA", "CSO"].forEach((r, i) => {
      const key = "r" + i, at = 1.0 + i * 1.1;
      nodes.push({ kind: "text", key, text: r, font: "mono", weight: "bold", size: 26, color: "#6B6F7C", x: x - 210 + [0, 92, 248, 314][i], y: y + 36, anchorX: 0, opacity: 0 });
      tracks.push({ node: key, prop: "opacity", keys: [{ at: "0.6s", value: 0 }, { at: "0.8s", value: 1 }] });
      tracks.push({ node: key, prop: "color", keys: [{ at: at.toFixed(2) + "s", value: "#6B6F7C" }, { at: (at + 0.25).toFixed(2) + "s", value: LIME, ease: "out" }] });
    });
  } else {
    const line1 = RUNS ? "recalled " + RUNS.memoryPage : "recalled quorum/verdicts/<run>";
    const line2 = RUNS ? "first run " + RUNS.firstSeconds + " s  →  reused " + RUNS.reuseSeconds + " s" : "first run — s  →  reused — s";
    nodes.push({ kind: "text", key: "l1", text: line1, font: "mono", weight: "regular", size: 22, color: "#C9CBD3", x: x - 210, y: y + 22, anchorX: 0, opacity: 0 });
    nodes.push({ kind: "text", key: "l2", text: line2, font: "mono", weight: "bold", size: 24, color: LIME, x: x - 210, y: y + 56, anchorX: 0, opacity: 0 });
    tracks.push({ node: "l1", prop: "opacity", keys: [{ at: "0.9s", value: 0 }, { at: "1.2s", value: 1 }] });
    tracks.push({ node: "l2", prop: "opacity", keys: [{ at: "1.6s", value: 0 }, { at: "1.9s", value: 1 }] });
  }
  return { type: "stage", start: "0s", end: dur + "s", nodes, tracks, events: [{ at: "0.6s", kind: "token" }] };
}

const list = beats();
const sources = {
  gstackLogo: { type: "image", path: "media/logos/credit-gstack.png" },
  gbrainLogo: { type: "image", path: "media/logos/gbrain-mark.png" },
};
const missing = RUNS ? [] : ["runs.json (award badge numbers from the real run)"];
const scenes = list.map((b) => {
  const scene = { id: b.id, duration: b.dur + "s", background: SYNTH.has(b.id) ? "#08080A" : CANVAS, layers: [], notes: "beat " + b.n + ": " + b.picture.slice(0, 120) };
  if (SYNTH.has(b.id)) {
    const src = "sc_" + b.id; sources[src] = { type: "video", path: "media/sc-" + b.id + ".mp4", muted: true };
    if (!existsSync(join(HERE, "media/sc-" + b.id + ".mp4"))) missing.push("media/sc-" + b.id + ".mp4");
    scene.layers.push({ type: "media", source: src, fit: "cover" });
  } else {
    const cap = CAPTURES[b.id];
    if (cap && existsSync(join(HERE, cap.session))) {
      const src = "cap_" + b.id; sources[src] = cap.kind === "video" ? { type: "video", path: cap.session, muted: true } : { type: "capture", session: cap.session };
      scene.layers.push({ type: "media", source: src, fit: "cover", ...(cap.in ? { in: cap.in } : {}), ...(cap.speed ? { speed: cap.speed } : {}), ...(cap.camera ? { camera: cap.camera } : {}), ...(cap.cursor ? { cursor: cap.cursor } : {}),
        window: cap.window ?? { x: 264, y: 176, width: 1392, height: 870, radius: 20, shadow: true, border: true } });
    } else {
      missing.push("capture " + b.id);
      scene.layers.push({ type: "text", text: "CAPTURE PENDING · " + b.id, x: "center", y: 560, align: "center", font: "mono", weight: "bold", size: 44, color: "#9CA3AF" });
    }
    if (b.id === "council") scene.layers.push(badge("gstack", b.dur));
    if (b.id === "reuse") scene.layers.push(badge("gbrain", b.dur));
  }
  const c = caption(b); if (c) scene.layers.push(c);
  return scene;
});
// dark → light when the product appears, light → dark for the close
const idx = (id) => scenes.findIndex((s) => s.id === id);
scenes[idx("landing")].transition = { type: "fadewhite", duration: "0.4s" };
scenes[idx("mcp")].transition = { type: "fade", duration: "0.3s" };

const at = (id) => list.find((b) => b.id === id).at;
const timeline = {
  $schema: "https://raw.githubusercontent.com/lidge-ai/vid2-gen/main/schema/timeline.v1.json",
  version: 1,
  output: { width: 1920, height: 1080, fps: 30, background: "#08080A" },
  beat: { bpm: 112 },
  sources,
  scenes,
  audio: {
    music: { synth: { preset: "launch", key: "Am", sections: [{ at: 0, energy: "intro" }, { at: at("fleet"), energy: "build" }, { at: at("judgment"), energy: "break" }, { at: +(at("converge") + 3.3).toFixed(2), energy: "drop" }, { at: at("built"), energy: "outro" }] }, volume: 0.75, fadeOut: "1.5s" },
    autoCues: true,
    cues: [{ at: +(at("rocks") + 1.5).toFixed(2), sfx: "preset:impact", volume: 0.6 }, { at: +(at("judgment") + 0.5).toFixed(2), sfx: "preset:shimmer", volume: 0.5 }, { at: +(at("converge") + 1.95).toFixed(2), sfx: "preset:riser", anchor: "start", volume: 0.6 }, { at: +(at("converge") + 3.3).toFixed(2), sfx: "preset:impact" }],
  },
};
writeFileSync(OUT, JSON.stringify(timeline, null, 1) + "\n");
const total = list.reduce((s, b) => s + b.dur, 0);
console.log(JSON.stringify({ ok: true, out: OUT, beats: list.length, authoredSeconds: +total.toFixed(2), missing }));
if (FINAL && missing.length) { console.error("PROXY ONLY: missing " + missing.join(", ")); process.exit(1); }
