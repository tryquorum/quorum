// Quorum final film: synthetic scenes, drawn deterministically as draw(scene, t, dur).
// Pixel world: 480x270 art pixels scaled x4 (nearest neighbour), the landing's 4x4 Bayer dither and dark palette
// (copied from site/web/src/landing/pixel-sea.tsx and story.tsx: PALETTES.dark, BAYER, BOAT and the small sprites).
// Overlays (agent chips, alert labels, HUD, inbox, cards, the Quorum mark) are drawn at full resolution.
// Captions are not drawn here: video/final/build-timeline.mjs adds them as vid2 kinetic layers.
"use strict";
const W = 1920, H = 1080, S = 4, PW = 480, PH = 270, HZ = 150;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PAL = { sky: ["#08080a", "#0b0d16", "#10142a", "#18203c"].map(hex), sea: ["#141a33", "#0f1428", "#0b0e1d", "#07080f"].map(hex),
  moon: hex("#f4ecd2"), rim: hex("#f9f4e4"), star: hex("#c9c6b8"), glint: hex("#e9dfbd"),
  sail: hex("#f4ecd2"), hull: hex("#b9b096"), foam: hex("#c9c6b8"), mount: ["#1d2644", "#232d50", "#2b375e", "#344270"].map(hex), rock: ["#2a2f45", "#3a405a", "#4b526e"].map(hex) };
const BOAT = ["......1......", "......11.....", "......111....", "......1111...", "......11111..", "......111111.", ".....1111111.", "......1......", "1111111111111", ".11111111111.", "..111111111.."];
const SMALL = ["...1....", "...11...", "...111..", "...1111.", "...1....", "11111111", ".111111."];
const LIME = "#d9f99d", RED = "#f87171", INK = "#fafafa", MUTED = "#9ca3af", CREAM = "#f4ecd2";
const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const inout = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const out3 = (x) => 1 - Math.pow(1 - clamp(x), 3);
const backOut = (x) => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const win = (t, a, b, fi = 0.25, fo = 0.25) => clamp((t - a) / fi) * clamp((b - t) / fo);

const cv = document.getElementById("c"), ctx = cv.getContext("2d");
const off = document.createElement("canvas"); off.width = PW; off.height = PH;
const octx = off.getContext("2d");
const img = octx.createImageData(PW, PH);
const D = img.data;

// ---------- assets ----------
const LOGO_NAMES = ["codex", "claudecode", "cursor", "grokbot", "muse", "pickle", "gmail", "credit-aside", "credit-gbrain", "credit-gstack"];
const LOGOS = {};
window.ready = (async () => {
  await Promise.all(LOGO_NAMES.map(async (n) => { const im = new Image(); im.src = window.LOGO_DIR + "/" + n + ".png"; await im.decode(); LOGOS[n] = im; }));
  await Promise.all(["400 20px Geist", "600 20px Geist", "700 20px Geist", "900 20px Geist", "400 20px GeistMono", "700 20px GeistMono", "20px InstrumentSerif"].map((f) => document.fonts.load(f)));
  await document.fonts.ready;
  for (const f of ["Geist", "GeistMono", "InstrumentSerif"]) if (!document.fonts.check("20px " + f)) throw new Error("font not loaded: " + f);
  return true;
})();

const AGENTS = [
  { key: "codex", name: "Codex" }, { key: "claudecode", name: "Claude Code" }, { key: "cursor", name: "Cursor" },
  { key: "grokbot", name: "Grok Bot" }, { key: "muse", name: "Muse" }, { key: "pickle", name: "Pickle" }, { key: null, name: "your scripts" },
];
const EXTRA = ["cron job", "bot #9", "script", "agent #11", "webhook", "bot #13", "agent #14"];

// ---------- pixel world ----------
function put(x, y, c, a = 1) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= PW || y >= PH) return;
  if (a < 1 && BAYER[(y & 3) * 4 + (x & 3)] > a) return;
  const i = (y * PW + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255;
}
const mountainTop = (x) => { const peak = 62, px = 70, x1 = 170; if (x > x1) return Infinity; return x <= px ? peak + ((px - x) / px) * (HZ - peak) * 0.55 : peak + ((x - px) / (x1 - px)) * (HZ - peak); };
function world(t, o) {
  clampCam();
  const moonX = o.moonX ?? 372, moonY = o.moonY ?? 54, moonR = 13, dim = o.dim ?? 1;
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const i = (y * PW + x) * 4, th = BAYER[(y & 3) * 4 + (x & 3)];
    let c;
    const mt = o.mountain ? mountainTop(x) : Infinity;
    if (y >= mt && y < HZ + 1) {
      const lit = x > 70 ? 1.2 : 0.5;
      c = PAL.mount[Math.min(3, Math.max(0, Math.floor(((y - mt) / (HZ - 62)) * 2.2 + lit * th + (x > 70 ? 0.4 : 0))))];
      if (Math.abs(y - mt) < 1.2 && x > 66 && x < 120) c = PAL.mount[3];
    } else if (y < HZ) {
      c = PAL.sky[Math.min(3, Math.floor((y / HZ) * 3 + th))];
      if (hash(x * 13 + y * 7) > 0.9965 && y < HZ - 20) { const tw = Math.sin(t * 2 + x) * 0.5 + 0.5; if (tw > 0.3) c = PAL.star; }
    } else {
      const sy = (y - HZ) / (PH - HZ);
      const wave = Math.sin(x * 0.18 + y * 1.3 - t * 1.6) * 0.08;
      c = PAL.sea[Math.min(3, Math.max(0, Math.floor((sy * 0.85 + 0.1 + wave) * 3 + th)))];
      const band = moonR * (0.3 + sy * 0.8), offx = Math.sin(y * 0.9 + t * 2) * 1.5;
      if (o.glint !== false && Math.abs(x - moonX - offx) < band * 0.8 && th < 0.11 - sy * 0.06 && (y + Math.floor(t * 3)) % 3 !== 0) c = [c[0] + (PAL.glint[0] - c[0]) * 0.55, c[1] + (PAL.glint[1] - c[1]) * 0.55, c[2] + (PAL.glint[2] - c[2]) * 0.55];
    }
    D[i] = c[0] * dim; D[i + 1] = c[1] * dim; D[i + 2] = c[2] * dim; D[i + 3] = 255;
  }
  for (let y = -moonR; y <= moonR; y++) for (let x = -moonR; x <= moonR; x++) if (x * x + y * y <= moonR * moonR) {
    const c = x * x + y * y > (moonR - 1.2) ** 2 && x + y < 0 ? PAL.rim : PAL.moon; put(moonX + x, moonY + y, c.map((v) => v * dim));
  }
}
function reef(cx, cy, k) {
  // jagged rocks rising out of the sea, with foam
  const rocks = [[0, 0, 13, 18], [-13, 4, 9, 11], [12, 3, 10, 13], [24, 6, 6, 6], [-24, 7, 6, 5]];
  for (const [dx, dy, w, h] of rocks) {
    const hh = Math.round(h * k);
    for (let y = 0; y < hh; y++) for (let x = -w; x <= w; x++) {
      const edge = Math.abs(x) / w; if (y > hh * (1 - edge * 0.9) + (hash(x + dx) * 2)) continue;
      put(cx + dx + x, cy + dy - y, PAL.rock[Math.min(2, Math.floor((1 - y / (hh + 1)) * 2 + BAYER[((cy - y) & 3) * 4 + ((cx + x) & 3)] + (x > 0 ? 0.6 : 0)))]);
    }
    for (let x = -w - 2; x <= w + 2; x++) if (hash(x * 3 + dx) > 0.4) put(cx + dx + x, cy + dy + 1, PAL.foam);
  }
}
function boat(x, y, t, i, spr = SMALL, a = 1, sc = 1, tilt = 0) {
  const sw = spr[0].length, sh = spr.length, bob = Math.sin(t * 1.6 + i) * 0.6;
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) {
    if (spr[yy][xx] !== "1") continue;
    const sail = yy < sh - (spr === BOAT ? 3 : 2);
    for (let a1 = 0; a1 < sc; a1++) for (let b1 = 0; b1 < sc; b1++)
      put(x + (xx - sw / 2) * sc + a1 + tilt * (sh - yy) * 0.25, y + (yy - sh) * sc + b1 + bob, sail ? PAL.sail : PAL.hull, a);
  }
}
function wake(x, y, ang, t, i) {
  for (let k = 1; k < 7; k++) { const wx = x - Math.cos(ang) * k * 2.2, wy = y + 1 - Math.sin(ang) * k * 1.2; if ((k + Math.floor(t * 8) + i) % 2) put(wx, wy, PAL.foam, 0.8 - k * 0.1); }
}

// ---------- the fleet (one continuous story time T across fleet → spin → rocks → mountain → converge) ----------
const SPAWN = [250, 205];
const ORBITS = [[300, 224, 13], [338, 196, 10], [262, 246, 9]];
const REEF = [432, 218];
const FLEET = Array.from({ length: 14 }, (_, i) => {
  const kind = [0, 1, 2, 3, 0, 1, 2, 0, 3, 2, 0, 3, 1, 0][i]; // 0 orbit, 1 reef, 2 mountain, 3 scatter
  return { i, kind, spawn: 0.25 + i * 0.3, ang: hash(i + 11) * Math.PI * 2, speed: 9 + hash(i + 23) * 8, orbit: ORBITS[Math.max(0, [0, 4, 7, 10, 13].indexOf(i)) % 3], phase: hash(i + 31) * 6.28,
    label: i < 7 ? AGENTS[i] : { key: null, name: EXTRA[i - 7] } };
});
function boatPos(b, T) {
  const age = T - b.spawn; if (age < 0) return null;
  const k = out3(age / 1.6);
  if (b.kind === 0) {
    const [ox, oy, r] = b.orbit, a = b.phase + age * 2.3;
    const tx = ox + Math.cos(a) * r * 1.6, ty = oy + Math.sin(a) * r * 0.55;
    return { x: lerp(SPAWN[0], tx, k), y: lerp(SPAWN[1], ty, k), ang: a + Math.PI / 2 };
  }
  if (b.kind === 1) {
    const hit = 10.6 - (b.i % 2) * 0.0 + (b.i === 12 ? 1.4 : 0); // story time of impact
    const p = clamp((T - b.spawn) / (hit - b.spawn));
    const x = lerp(SPAWN[0], REEF[0] - 10, inout(p) * 0.4 + p * 0.6), y = lerp(SPAWN[1], REEF[1] + 4, p);
    return { x, y, ang: 0.1, crashed: T >= hit, crashAt: hit };
  }
  if (b.kind === 2) {
    const along = age * (8 + (b.i % 3) * 1.5);
    let x = SPAWN[0] - along * 1.3, y = lerp(SPAWN[1], 160, clamp(along / 40));
    if (x < 168) { const up = (168 - x); x = 168 - up * 0.9; y = Math.min(y, mountainTop(x) + 1); }
    return { x: Math.max(x, 64), y: Math.max(y, 64), ang: Math.PI, climbing: x < 168 };
  }
  let x = SPAWN[0] + Math.cos(b.ang) * b.speed * age * 1.5, y = SPAWN[1] + Math.sin(b.ang) * b.speed * age * 0.5;
  const bx = 200, bw = 270, by = 160, bh = 98;
  x = bx + Math.abs(((x - bx) % (2 * bw) + 2 * bw) % (2 * bw) - bw) * 1; y = by + Math.abs(((y - by) % (2 * bh) + 2 * bh) % (2 * bh) - bh) * 1;
  return { x, y, ang: b.ang };
}
function drawFleet(T, opts = {}) {
  const out = [];
  for (const b of FLEET) {
    const p = boatPos(b, T); if (!p) continue;
    const a = clamp((T - b.spawn) / 0.25) * (opts.alpha ?? 1);
    if (!p.climbing && !p.crashed) wake(p.x, p.y, p.ang, T, b.i);
    boat(p.x, p.y, T, b.i, b.i === 0 ? BOAT : SMALL, a, 1, p.crashed ? 3 : 0);
    out.push({ b, p });
  }
  return out;
}

// ---------- camera: art-pixel region → screen ----------
let CAM = { cx: PW / 2, cy: PH / 2, z: 1 };
function clampCam() { const hw = W / (2 * S * CAM.z), hh = H / (2 * S * CAM.z); CAM.cx = clamp(CAM.cx, hw, PW - hw); CAM.cy = clamp(CAM.cy, hh, PH - hh); }
const toScreen = (x, y) => [(x - CAM.cx) * S * CAM.z + W / 2, (y - CAM.cy) * S * CAM.z + H / 2];
function blitWorld(shake = 0) {
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const z = S * CAM.z, sx = W / 2 - CAM.cx * z + shake * Math.sin(shake * 97), sy = H / 2 - CAM.cy * z + shake * Math.cos(shake * 71);
  ctx.drawImage(off, Math.round(sx), Math.round(sy), PW * z, PH * z);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
}
function topShade(a = 0.85, h = 420) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(8,8,10," + a + ")"); g.addColorStop(1, "rgba(8,8,10,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, h);
}
function vignette(color, a) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, color.replace("A", a)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function fade(a) { if (a > 0) { ctx.fillStyle = "rgba(0,0,0," + clamp(a) + ")"; ctx.fillRect(0, 0, W, H); } }

// ---------- overlay widgets ----------
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function text(s, x, y, font, color, align = "left", base = "middle") { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y); return ctx.measureText(s).width; }
function chip(x, y, label, a, sc = 1) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = clamp(a); ctx.translate(x, y); ctx.scale(sc, sc);
  ctx.font = "600 24px Geist"; const tw = ctx.measureText(label.name).width;
  const iw = label.key ? 34 : 0, w = tw + iw + (label.key ? 34 : 28), h = 46;
  rr(-w / 2, -h / 2, w, h, 23); ctx.fillStyle = "rgba(11,14,29,0.88)"; ctx.fill(); ctx.strokeStyle = "rgba(244,236,210,0.28)"; ctx.lineWidth = 1.5; ctx.stroke();
  let tx = -w / 2 + 14;
  if (label.key) { ctx.save(); rr(tx, -15, 30, 30, 7); ctx.clip(); ctx.drawImage(LOGOS[label.key], tx, -15, 30, 30); ctx.restore(); tx += 38; }
  text(label.name, tx, 1, "600 24px Geist", label.key ? INK : "#c9c6b8");
  ctx.restore();
}
function chipW(label, sc = 1) { ctx.font = "600 24px Geist"; return (ctx.measureText(label.name).width + (label.key ? 72 : 28)) * sc; }
function layoutChips(list) {
  // list: {x, y, label, a, sc}; greedy: lower chips win, upper ones move up until clear
  const placed = [];
  list.sort((p, q) => q.y - p.y);
  for (const c of list) {
    const w = chipW(c.label, c.sc), h = 50 * c.sc;
    let y = c.y, guard = 0;
    while (guard++ < 12 && placed.some((o) => Math.abs(o.x - c.x) < (o.w + w) / 2 + 6 && Math.abs(o.y - y) < (o.h + h) / 2 + 4)) y -= 18;
    placed.push({ x: c.x, y, w, h });
    if (Math.abs(y - c.y) > 2) { ctx.save(); ctx.globalAlpha = 0.35 * clamp(c.a); ctx.strokeStyle = "#c9c6b8"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(c.x, y + h / 2); ctx.lineTo(c.x, c.y + h / 2); ctx.stroke(); ctx.restore(); }
    chip(c.x, y, c.label, c.a, c.sc);
  }
}
function alert(x, y, s, a, sc = 1, color = RED) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = clamp(a); ctx.translate(x, y); ctx.scale(sc, sc);
  ctx.font = "700 24px GeistMono"; const w = ctx.measureText(s).width + 32;
  rr(-w / 2, -22, w, 44, 6); ctx.fillStyle = "rgba(42,12,16,0.92)"; ctx.fill(); ctx.strokeStyle = color + "aa"; ctx.lineWidth = 2; ctx.stroke();
  text(s, 0, 1, "700 24px GeistMono", color, "center"); ctx.restore();
}
function hud(lines, a = 1, color = "#c9c6b8") {
  ctx.save(); ctx.globalAlpha = a; let y = 64;
  for (const l of lines) { const hi = l.startsWith("!"); text(hi ? l.slice(1) : l, 72, y, "700 22px GeistMono", hi ? LIME : color); y += 34; }
  ctx.restore();
}
function tag(s, x, y, a = 1, align = "right") { ctx.save(); ctx.globalAlpha = a; text(s, x, y, "400 22px GeistMono", "#8b8a83", align); ctx.restore(); }
const pad2 = (n) => String(Math.max(0, Math.round(n))).padStart(2, "0");
// the Quorum mark: 21 seats in a hemicycle and a lime centre (site/favicon.svg, viewBox 32)
const SEATS = [[9, 25], [11.05, 20.05], [16, 18], [20.95, 20.05], [23, 25], [5.5, 25], [6.91, 19.75], [10.75, 15.91], [16, 14.5], [21.25, 15.91], [25.09, 19.75], [26.5, 25], [2, 25], [3.07, 19.64], [6.1, 15.1], [10.64, 12.07], [16, 11], [21.36, 12.07], [25.9, 15.1], [28.93, 19.64], [30, 25]];
function mark(cx, cy, size, seatA = 1, coreA = 1) {
  const k = size / 32;
  ctx.fillStyle = INK; ctx.globalAlpha = seatA;
  for (const [x, y] of SEATS) { ctx.beginPath(); ctx.arc(cx + (x - 16) * k, cy + (y - 18) * k, 1.35 * k, 0, 7); ctx.fill(); }
  ctx.globalAlpha = coreA; ctx.fillStyle = LIME; ctx.beginPath(); ctx.arc(cx, cy + 7 * k, 2.4 * k, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
}

// ---------- scenes ----------
const SCENES = {};
SCENES.hook = (t, d) => {
  CAM = { cx: 240, cy: 135, z: 1 }; world(t, { moonX: 446, moonY: 30 }); blitWorld(); topShade(0.6, 360);
  fade(1 - clamp(t / 0.9)); fade(clamp((t - d + 0.25) / 0.25) * 0.0);
};
SCENES.boatmen = (t, d) => {
  const z = lerp(1.0, 1.12, t / d); CAM = { cx: lerp(250, 262, t / d), cy: 150, z }; world(t + 4.3, { moonX: 446, moonY: 30 });
  const bx = 240 + t * 4.2; wake(bx, 205, 0, t, 0); boat(bx, 205, t, 0, BOAT, 1, 2);
  blitWorld(); topShade(0.75, 420);
  const a = clamp((t - 1.6) / 0.5);
  ctx.save(); ctx.globalAlpha = a; text("사공이 많으면 배가 산으로 간다", W / 2, 352, "500 34px 'Apple SD Gothic Neo'", "#c9c6b8", "center");
  ctx.globalAlpha = clamp((t - 2.1) / 0.5); text("Korea  ·  Japan:  船頭多くして船山に登る", W / 2, 404, "400 26px 'Hiragino Sans', GeistMono", "#8b8a83", "center"); ctx.restore();
};
function fleetScene(T, t, d, cam, extra) {
  CAM = cam; world(T + 9, { mountain: true, moonX: 420 }); if (extra?.reefK) reef(REEF[0], REEF[1], extra.reefK);
  if (T > 2) for (const [ox, oy, r] of ORBITS) for (let k = 0; k < 64; k++) { const a = (k / 64) * 6.283; if ((k + Math.floor(T * 6)) % 3) put(ox + Math.cos(a) * r * 1.6, oy + Math.sin(a) * r * 0.55 + 1, PAL.foam, clamp((T - 2) / 2) * 0.55); }
  const placed = drawFleet(T); const crash = extra?.shake ?? 0; blitWorld(crash); topShade(0.8, 400);
  return placed;
}
SCENES.fleet = (t, d) => {
  const T = t; const z = lerp(1.25, 1.0, inout(t / d));
  const placed = fleetScene(T, t, d, { cx: lerp(250, 270, t / d), cy: lerp(190, 165, inout(t / d)), z });
  layoutChips(placed.map(({ b, p }) => { const [sx, sy] = toScreen(p.x, p.y - 10); return { x: sx, y: sy - 18, label: b.label, a: clamp((T - b.spawn - 0.05) / 0.2), sc: backOut((T - b.spawn) / 0.35) * (b.i < 7 ? 1 : 0.8) }; }));
  const n = placed.length, dirs = new Set(placed.map(({ b }) => b.kind === 3 ? 10 + Math.floor((b.ang / 6.283) * 6) : b.kind)).size;
  hud(["AGENTS      " + pad2(n), "DIRECTIONS  " + pad2(dirs), "PROGRESS    --"], clamp(t / 0.4));
  tag("your agents — examples", W - 72, H - 56, clamp((t - 1) / 0.4));
};
SCENES.spin = (t, d) => {
  const T = 5.9 + t; const z = 1.75;
  const placed = fleetScene(T, t, d, { cx: lerp(296, 304, t / d), cy: 214, z });
  layoutChips(placed.filter(({ b }) => b.kind === 0 || b.kind === 3).map(({ b, p }) => { const [sx, sy] = toScreen(p.x, p.y - 10); return { x: sx, y: sy - 26, label: b.label, a: 1, sc: 0.92 }; }));
  const L = [["SAME TASK · 4TH TIME", 560, 520, 0.35], ["RE-PROPOSED WHAT YOU REJECTED", 1300, 300, 0.85], ["BUSY · 0 DONE", 1120, 860, 1.35]];
  for (const [s, x, y, at] of L) alert(x, y, s, clamp((t - at) / 0.15), backOut((t - at) / 0.3));
  hud(["AGENTS      14", "DIRECTIONS  09", "PROGRESS    0%"]);
};
SCENES.rocks = (t, d) => {
  const T = 9.1 + t; const hit = 10.6 - 9.1;
  const shake = t > hit && t < hit + 0.35 ? (1 - (t - hit) / 0.35) * 14 : 0;
  const placed = fleetScene(T, t, d, { cx: lerp(392, 402, t / d), cy: 206, z: 1.8 }, { reefK: 1, shake });
  layoutChips(placed.filter(({ b }) => b.kind === 1).map(({ b, p }) => { const [sx, sy] = toScreen(p.x, p.y - 10); return { x: sx, y: sy - 26, label: b.label, a: 1, sc: 0.92 }; }));
  if (t > hit) vignette("rgba(248,113,113,A)", 0.55 * (1 - clamp((t - hit) / 0.9)) + 0.15);
  const L = [["SENT THE EMAIL", 640, 500, hit + 0.1], ["PAID THE INVOICE", 1300, 560, hit + 0.4], ["POSTED IT PUBLICLY", 860, 860, hit + 0.7]];
  for (const [s, x, y, at] of L) alert(x, y, s, clamp((t - at) / 0.12), backOut((t - at) / 0.3));
  hud(["AGENTS      14", "DIRECTIONS  09", "INCIDENTS   " + pad2(t > hit ? 1 + Math.floor((t - hit) / 0.3) : 0)]);
};
SCENES.mountain = (t, d) => {
  const T = 12.3 + t;
  const placed = fleetScene(T, t, d, { cx: lerp(120, 112, t / d), cy: lerp(140, 128, t / d), z: 1.7 });
  layoutChips(placed.filter(({ b }) => b.kind === 2).map(({ b, p }) => { const [sx, sy] = toScreen(p.x, p.y - 10); return { x: sx, y: sy - 26, label: b.label, a: 1, sc: 0.92 }; }));
  alert(1250, 560, "A RESULT NOBODY ASKED FOR", clamp((t - 0.9) / 0.15), backOut((t - 0.9) / 0.3));
  alert(720, 820, "SHIPPED ANYWAY", clamp((t - 1.5) / 0.15), backOut((t - 1.5) / 0.3), "#fbbf24");
  hud(["AGENTS      14", "DIRECTIONS  09", "ALTITUDE    " + Math.round(40 + t * 90) + " M"]);
};
const NOISE = [["codex", "Codex", "PR #212 opened: refactor utils"], ["cursor", "Cursor", "14 files changed"], ["grokbot", "Grok Bot", "Draft reply ready for review"], ["muse", "Muse", "Your daily digest"],
  ["pickle", "Pickle", "Booking confirmed"], ["claudecode", "Claude Code", "Tests passed (again)"], ["codex", "Codex", "PR #213 opened"], ["grokbot", "Grok Bot", "3 new drafts"],
  ["muse", "Muse", "Weekly summary is ready"], ["cursor", "Cursor", "Agent finished a task"], ["pickle", "Pickle", "Price alert"], ["claudecode", "Claude Code", "Re-ran the same task"],
  ["codex", "Codex", "PR #214 opened"], ["muse", "Muse", "Reminder: reminders"], ["grokbot", "Grok Bot", "Summary of summaries"], ["cursor", "Cursor", "12 suggestions"]];
SCENES.buried = (t, d) => {
  CAM = { cx: 240, cy: 160, z: 1.05 }; world(t + 20, { dim: 0.55 }); blitWorld(); topShade(0.85, 420);
  const cx = 1920 / 2, cw = 1080, x0 = cx - cw / 2, y0 = 370, ch = 650, rowH = 74, head = 76;
  const enter = out3(t / 0.5);
  ctx.save(); ctx.globalAlpha = enter; ctx.translate(0, (1 - enter) * 40);
  rr(x0, y0, cw, ch, 22); ctx.fillStyle = "rgba(15,17,23,0.96)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.drawImage(LOGOS.gmail, x0 + 28, y0 + 22, 36, 36); text("Inbox", x0 + 78, y0 + 41, "600 28px Geist", INK);
  const arrivals = NOISE.map((_, k) => 1.35 + k * 0.17);
  const arrived = arrivals.filter((a) => t >= a).length;
  text("example · unread " + (2 + arrived), x0 + cw - 28, y0 + 41, "400 22px GeistMono", "#8b8a83", "right");
  ctx.beginPath(); ctx.rect(x0, y0 + head, cw, ch - head - 2); ctx.clip();
  // rows: index 0 is the newest; the two that matter start at the top
  const rows = [];
  for (let k = NOISE.length - 1; k >= 0; k--) if (t >= arrivals[k]) rows.push({ noise: NOISE[k], at: arrivals[k] });
  rows.push({ vip: 0 }, { vip: 1 }, { old: ["Ops weekly", "Notes from Monday"] }, { old: ["Billing", "Your receipt"] }, { old: ["Team", "Lunch on Thursday?"] });
  let y = y0 + head;
  rows.forEach((r, idx) => {
    const slide = r.at !== undefined ? out3((t - r.at) / 0.18) : 1;
    const h = rowH * slide, yy = y; y += h;
    if (r.old) { text(r.old[0], x0 + 76, yy + rowH / 2, "600 24px Geist", "#8b8f9c"); text(r.old[1], x0 + 330, yy + rowH / 2, "400 24px Geist", "#6b6f7c"); }
    else if (r.vip !== undefined) {
      const [who, subj, tg, col] = r.vip === 0 ? ["Northwind · Dana Park", "Re: pilot pricing — can we start Monday?", "SALES LEAD", LIME] : ["c0mpiled-17", "Action needed: confirm your demo slot", "IMPORTANT", "#fbbf24"];
      const pulse = 0.07 + 0.06 * Math.max(0, Math.sin(t * 6)) * clamp((t - 1.3) / 0.3); ctx.fillStyle = "rgba(217,249,157," + pulse + ")"; ctx.fillRect(x0, yy, cw, rowH);
      ctx.fillStyle = col; ctx.fillRect(x0, yy + 8, 4, rowH - 16);
      text(who, x0 + 32, yy + rowH / 2, "700 24px Geist", INK); text(subj, x0 + 330, yy + rowH / 2, "600 24px Geist", INK);
      ctx.font = "700 18px GeistMono"; const tw = ctx.measureText(tg).width + 20; rr(x0 + cw - 32 - tw, yy + rowH / 2 - 15, tw, 30, 6); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
      text(tg, x0 + cw - 32 - tw / 2, yy + rowH / 2 + 1, "700 18px GeistMono", col, "center");
    } else {
      const [k, who, subj] = r.noise;
      ctx.globalAlpha = enter * clamp((t - r.at) / 0.12);
      ctx.drawImage(LOGOS[k], x0 + 32, yy + rowH / 2 - 15, 30, 30);
      text(who, x0 + 76, yy + rowH / 2, "600 24px Geist", "#c9cbd3"); text(subj, x0 + 330, yy + rowH / 2, "400 24px Geist", "#8b8f9c");
      text("now", x0 + cw - 32, yy + rowH / 2, "400 20px GeistMono", "#6b6f7c", "right"); ctx.globalAlpha = enter;
    }
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(x0 + 24, yy + h - 1, cw - 48, 1);
  });
  ctx.restore();
  // the bottom edge of the card swallows the rows
  const g = ctx.createLinearGradient(0, y0 + ch - 120, 0, y0 + ch); g.addColorStop(0, "rgba(15,17,23,0)"); g.addColorStop(1, "rgba(15,17,23,0.95)");
  ctx.fillStyle = g; ctx.globalAlpha = enter; ctx.fillRect(x0 + 2, y0 + ch - 120, cw - 4, 118); ctx.globalAlpha = 1;
};
// v2: the judgment line holds the frame; on the snare roll (2.0 s) the agents' cards appear scattered and drift inward, accelerating;
// on the silent beat (4.0–4.5 s) they freeze, almost touching. The drop is the first frame of "converge".
const CARDS = AGENTS.map((a, k) => ({ a, x: [330, 1590, 470, 1450, 840, 1200, 660][k], y: [560, 520, 900, 930, 470, 760, 760][k] }));
const SEAT_OF = [2, 7, 8, 9, 16, 15, 17];
const MARK = { cx: W / 2, cy: 660, size: 300 };
const seatXY = (n) => { const k = MARK.size / 32, s = SEATS[SEAT_OF[n]]; return [MARK.cx + (s[0] - 16) * k, MARK.cy + (s[1] - 18) * k]; };
const GATHER = 0.82; // share of the path covered when the music stops
function card(c, x, y, sc, a) {
  if (sc <= 0.02 || a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(sc, sc);
  rr(-170, -52, 340, 104, 18); ctx.fillStyle = "rgba(15,17,23,0.97)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1.5; ctx.stroke();
  if (c.a.key) { ctx.save(); rr(-148, -26, 52, 52, 12); ctx.clip(); ctx.drawImage(LOGOS[c.a.key], -148, -26, 52, 52); ctx.restore(); }
  text(c.a.name, -80, -10, "600 28px Geist", INK); text("proposing…", -80, 22, "400 20px GeistMono", MUTED);
  ctx.restore();
}
SCENES.judgment = (t, d) => {
  const hang = t >= 4.0;
  CAM = { cx: 240, cy: 140, z: 1 + 0.02 * clamp(t / 4) }; world(t + 30, { dim: 0.6, moonX: 446, moonY: 30 }); blitWorld();
  ctx.fillStyle = "rgba(8,8,10,0.45)"; ctx.fillRect(0, 0, W, H);
  fade(1 - clamp(t / 0.4));
  const p = Math.pow(clamp((Math.min(t, 4.0) - 2.0) / 2.0), 2.2) * GATHER;
  CARDS.forEach((c, n) => {
    const appear = out3((t - 2.0 - n * 0.06) / 0.3);
    const [tx, ty] = seatXY(n);
    card(c, lerp(c.x, tx, p), lerp(c.y, ty, p), lerp(1, 0.62, p), appear);
  });
  if (hang) { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(0, 0, W, H); }
  hud(["AGENTS      14", "DIRECTIONS  " + pad2(lerp(9, 2, p / GATHER)), hang ? "…" : ""], clamp((t - 2) / 0.3));
};
SCENES.converge = (t, d) => {
  // the drop: cards snap into their seats, the other seats pop in, the lime core lands
  const punch = 1 + 0.035 * Math.exp(-t * 9);
  CAM = { cx: 240, cy: 140, z: 1 }; world(t + 40, { dim: 0.45, moonX: 446, moonY: 30 }); blitWorld();
  ctx.fillStyle = "rgba(8,8,10,0.55)"; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W / 2, MARK.cy); ctx.scale(punch, punch); ctx.translate(-W / 2, -MARK.cy);
  const k = MARK.size / 32, snap = out3(t / 0.12);
  CARDS.forEach((c, n) => {
    const [tx, ty] = seatXY(n);
    const x = lerp(lerp(c.x, tx, GATHER), tx, snap), y = lerp(lerp(c.y, ty, GATHER), ty, snap);
    card(c, x, y, lerp(0.62, 0, snap), 1);
    ctx.globalAlpha = snap; ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x, y, 1.35 * k, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  });
  ctx.fillStyle = INK; SEATS.forEach(([sx, sy], n) => { if (SEAT_OF.includes(n)) return; const a = backOut((t - 0.04 - hash(n) * 0.22) / 0.18); if (a <= 0) return; ctx.globalAlpha = clamp(a); ctx.beginPath(); ctx.arc(MARK.cx + (sx - 16) * k, MARK.cy + (sy - 18) * k, 1.35 * k * a, 0, 7); ctx.fill(); });
  const core = backOut(t / 0.25); ctx.globalAlpha = 1; ctx.fillStyle = LIME; ctx.beginPath(); ctx.arc(MARK.cx, MARK.cy + 7 * k, Math.max(0, 2.4 * k * core), 0, 7); ctx.fill();
  const gg = ctx.createRadialGradient(MARK.cx, MARK.cy + 7 * k, 0, MARK.cx, MARK.cy + 7 * k, 220); gg.addColorStop(0, "rgba(217,249,157," + (0.45 * Math.exp(-t * 1.5) + 0.15) + ")"); gg.addColorStop(1, "rgba(217,249,157,0)");
  ctx.fillStyle = gg; ctx.fillRect(MARK.cx - 260, MARK.cy - 200, 520, 520);
  ctx.globalAlpha = clamp((t - 0.3) / 0.3); text("quorum", MARK.cx, MARK.cy + 250, "700 76px Geist", INK, "center"); ctx.globalAlpha = 1;
  ctx.restore();
  // flash on the downbeat
  if (t < 0.18) { ctx.fillStyle = "rgba(244,236,210," + (0.42 * (1 - t / 0.18)) + ")"; ctx.fillRect(0, 0, W, H); }
  hud(["AGENTS      14", "!DIRECTION   01", "!ONE COUNCIL"], 1);
};
SCENES.mcp = (t, d) => {
  CAM = { cx: 240, cy: 140, z: 1 }; world(t + 50, { dim: 0.4 }); blitWorld(); ctx.fillStyle = "rgba(8,8,10,0.55)"; ctx.fillRect(0, 0, W, H);
  const tx = 820, ty = 420, tw = 900, th = 330;
  const list = AGENTS.slice(0, 6);
  list.forEach((a, n) => {
    const y = 420 + n * 66, at = n * 0.08, x = 430;
    const ap = out3((t - at) / 0.3);
    ctx.save(); ctx.globalAlpha = ap * 0.5; ctx.strokeStyle = "#c9c6b8"; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 120, y); ctx.bezierCurveTo(680, y, 700, ty + th / 2, tx, ty + th / 2); ctx.stroke(); ctx.restore();
    chip(x, y, a, ap, 1);
  });
  tag("examples · any MCP client", 430, 850, clamp((t - 0.4) / 0.3), "center");
  const ap = out3((t - 0.2) / 0.35);
  ctx.save(); ctx.globalAlpha = ap; rr(tx, ty, tw, th, 18); ctx.fillStyle = "rgba(15,17,23,0.97)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.stroke();
  for (let k = 0; k < 3; k++) { ctx.fillStyle = ["#ff5f57", "#febc2e", "#28c840"][k]; ctx.beginPath(); ctx.arc(tx + 30 + k * 22, ty + 28, 7, 0, 7); ctx.fill(); }
  text("POST /mcp", tx + tw - 26, ty + 28, "400 20px GeistMono", MUTED, "right");
  const L = [["→ tools/call  quorum_propose", INK, 0.45], ['  { "request": "Reply to Northwind about pricing" }', "#c9c6b8", 0.9], ["← council convened · CEO · Reviewer · QA · CSO", LIME, 2.1]];
  L.forEach(([s, col, at], n) => { const chars = Math.floor(clamp((t - at) / 0.022 / s.length) * s.length); text(s.slice(0, chars), tx + 34, ty + 100 + n * 64, "400 27px GeistMono", col); });
  ctx.restore();
  mark(tx + tw - 80, ty + th - 64, 64, ap, ap);
};
SCENES.built = (t, d) => {
  CAM = { cx: 240, cy: 140, z: 1 }; world(t + 60, { dim: 0.4 }); blitWorld(); ctx.fillStyle = "rgba(8,8,10,0.6)"; ctx.fillRect(0, 0, W, H);
  const items = [["credit-aside", null, "browser work"], ["credit-gbrain", null, "remembers verdicts"], ["credit-gstack", "gstack", "the four roles"], [null, "Direction Board", "your board"], ["codex", "Codex", "code work"]];
  const cw = 300, ch = 170, gap = 28, x0 = W / 2 - (items.length * cw + (items.length - 1) * gap) / 2, y0 = 470;
  items.forEach(([logo, name, role], n) => {
    const at = 0.15 + n * 0.12, a = out3((t - at) / 0.35), x = x0 + n * (cw + gap), y = y0 + (1 - a) * 24;
    ctx.save(); ctx.globalAlpha = a; rr(x, y, cw, ch, 18); ctx.fillStyle = "#f3f3f4"; ctx.fill();
    if (logo === "credit-aside") ctx.drawImage(LOGOS[logo], x + cw / 2 - 90, y + 38, 180, 180 * LOGOS[logo].height / LOGOS[logo].width);
    else if (logo === "credit-gbrain") { const h = 56, w = h * LOGOS[logo].width / LOGOS[logo].height; ctx.drawImage(LOGOS[logo], x + cw / 2 - w / 2, y + 36, w, h); }
    else if (logo) { ctx.save(); rr(x + cw / 2 - 90, y + 34, 60, 60, 13); ctx.clip(); ctx.drawImage(LOGOS[logo], x + cw / 2 - 90, y + 34, 60, 60); ctx.restore(); text(name, x + cw / 2 - 18, y + 65, "700 34px Geist", "#0a0a0a"); }
    else { // Direction Board: wordmark + the sail
      text(name, x + cw / 2, y + 65, "700 32px Geist", "#0a0a0a", "center");
    }
    text(role, x + cw / 2, y + ch - 34, "400 20px GeistMono", "#55565e", "center");
    ctx.restore();
  });
};
SCENES.cta = (t, d) => {
  CAM = { cx: 240, cy: 150, z: 1 }; world(t + 70, {});
  const bx = 120 + t * 14; wake(bx, 214, 0, t, 0); boat(bx, 214, t, 0, BOAT, 1, 2);
  blitWorld(); topShade(0.7, 560);
  const a = out3((t - 0.1) / 0.5);
  ctx.save(); ctx.globalAlpha = a;
  mark(W / 2 - 250, 330, 150, 1, 1);
  text("quorum", W / 2 - 150, 318, "700 128px Geist", INK);
  ctx.globalAlpha = out3((t - 0.6) / 0.4); text("quorum.lidgeai.com", W / 2, 520, "600 52px Geist", LIME, "center");
  ctx.globalAlpha = out3((t - 0.9) / 0.4); text("github.com/tryquorum/quorum  ·  open source", W / 2, 590, "400 30px GeistMono", "#c9c6b8", "center");
  ctx.restore();
  fade(clamp((t - d + 0.45) / 0.45) * 0.97);
};

window.SCENE_IDS = Object.keys(SCENES);
window.draw = (id, t, d) => {
  const f = SCENES[id]; if (!f) throw new Error("unknown scene " + id);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false; ctx.fillStyle = "#08080a"; ctx.fillRect(0, 0, W, H);
  f(t, d);
  ctx.imageSmoothingEnabled = true;
  if (cv.width !== 1920 || cv.height !== 1080) throw new Error("canvas size changed");
  return true;
};
