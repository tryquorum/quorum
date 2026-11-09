#!/usr/bin/env node
// Renders the synthetic scenes of the final film frame by frame: video/final/scenes/scenes.js in Chrome (playwright-core from vid2-gen),
// canvas PNG per frame → ffmpeg → video/final/media/sc-<id>.mp4. Durations come from the beat table in video/final/STORY.md.
// Usage: node video/final/render-scenes.mjs [--only id,id] [--stills] [--fps 30]
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const VID2 = process.env.VID2_HOME || join(process.env.HOME, "Developer/new/700_projects/vid2-gen");
const require = createRequire(join(VID2, "package.json"));
const { chromium } = require("playwright-core");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const FPS = Number(val("--fps", 30));
const STILLS = flag("--stills");
const HASH = flag("--hash");

export function beats(storyPath = join(HERE, "STORY.md")) {
  const rows = readFileSync(storyPath, "utf8").split("\n").filter((l) => /^\| \d+ \|/.test(l));
  return rows.map((l) => { const c = l.split("|").map((s) => s.trim()); return { n: Number(c[1]), at: Number(c[2]), dur: Number(c[3]), id: c[4], picture: c[5], caption: c[6] }; });
}
const SYNTH = ["hook", "boatmen", "fleet", "spin", "rocks", "mountain", "buried", "judgment", "converge", "mcp", "built", "cta"];

async function main() {
  const only = val("--only", "") ? val("--only").split(",") : null;
  const list = beats().filter((b) => SYNTH.includes(b.id) && (!only || only.includes(b.id)));
  if (!list.length) throw new Error("no scenes selected");
  const media = join(HERE, "media"), page = resolve(HERE, "../tmp/page"), stills = resolve(HERE, "../tmp/stills");
  for (const d of [media, page, stills]) mkdirSync(d, { recursive: true });
  const logoDir = process.env.QVF_LOGO_DIR || join(media, "logos");
  for (const n of ["codex", "claudecode", "cursor", "grokbot", "muse", "pickle", "gmail", "credit-aside", "credit-gbrain", "credit-gstack"])
    if (!existsSync(join(logoDir, n + ".png"))) throw new Error("missing logo " + n + ".png (see media/logos/SOURCES.md)");
  const html = readFileSync(join(HERE, "scenes/index.template.html"), "utf8")
    .replaceAll("FONTS/", pathToFileURL(join(VID2, "assets/fonts")).href + "/")
    .replace('<script src="scenes.js"></script>', '<script>window.LOGO_DIR=' + JSON.stringify(pathToFileURL(join(media, "logos")).href) + '</script><script src="' + pathToFileURL(join(HERE, "scenes/scenes.js")).href + '"></script>');
  writeFileSync(join(page, "index.html"), html);
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--force-device-scale-factor=1", "--disable-gpu", "--disable-lcd-text", "--force-color-profile=srgb", "--allow-file-access-from-files", "--font-render-hinting=none"] });
  const report = [];
  try {
    const ctxb = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const p = await ctxb.newPage();
    const errors = []; p.on("pageerror", (e) => errors.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await p.goto(pathToFileURL(join(page, "index.html")).href);
    await p.evaluate(() => window.ready);
    if (errors.length) throw new Error("page errors: " + errors.join(" | "));
    const grab = async () => Buffer.from((await p.evaluate(() => document.getElementById("c").toDataURL("image/png"))).split(",")[1], "base64");
    for (const b of list) {
      const frames = Math.round(b.dur * FPS), t0 = Date.now();
      if (STILLS || HASH) {
        const picks = STILLS ? [0, Math.floor(frames * 0.25), Math.floor(frames / 2), Math.floor(frames * 0.75), frames - 1] : [0, Math.floor(frames / 2)];
        const hashes = [];
        for (const f of picks) {
          await p.evaluate(([id, t, d]) => window.draw(id, t, d), [b.id, f / FPS, b.dur]);
          const png = await grab(); hashes.push(createHash("sha256").update(png).digest("hex").slice(0, 16));
          if (STILLS) writeFileSync(join(stills, b.id + "-" + String(f).padStart(4, "0") + ".png"), png);
        }
        report.push({ id: b.id, frames: picks, hashes });
        continue;
      }
      const out = join(media, "sc-" + b.id + ".mp4");
      const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-vcodec", "png", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
      const done = new Promise((res, rej) => { ff.on("error", rej); ff.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg exit " + c + " for " + b.id)))); });
      for (let f = 0; f < frames; f++) {
        await p.evaluate(([id, t, d]) => window.draw(id, t, d), [b.id, f / FPS, b.dur]);
        const png = await grab();
        if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
      }
      ff.stdin.end(); await done;
      if (errors.length) throw new Error("page errors during " + b.id + ": " + errors.join(" | "));
      const secs = (Date.now() - t0) / 1000;
      report.push({ id: b.id, frames, out, fps: +(frames / secs).toFixed(1), seconds: +secs.toFixed(1) });
      process.stderr.write(b.id + " " + frames + "f " + secs.toFixed(1) + "s\n");
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({ ok: true, fps: FPS, scenes: report }, null, 1));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
