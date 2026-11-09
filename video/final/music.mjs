#!/usr/bin/env node
// Music bed for the v2 film: vid2's own synth (dist/audio/synth/engine.js synthArgs: kick, snare, hat, bass, pad, arp, riser, impact, crash)
// arranged intro → build (vid2 plays its 16th snare roll only inside "build", so a one-bar build = a one-bar roll) → drop → outro,
// then three things vid2's synth has no switch for, done in ffmpeg: a low-pass sweep over the buildup, a longer riser into the roll,
// and one silent beat right before the drop. Usage: node video/final/music.mjs [--out media/bed-v2.wav]
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VID2 = process.env.VID2_HOME || join(process.env.HOME, "Developer/new/700_projects/vid2-gen");
const { synthArgs } = await import(pathToFileURL(join(VID2, "dist/audio/synth/engine.js")).href);

export const BPM = 120, BEAT = 60 / BPM, BAR = 4 * BEAT;
export const DROP = 24.0, ROLL = DROP - 1.25 * BAR /* roll starts one bar before the silent beat */, SILENT = DROP - BEAT, OUTRO = 54.0, LENGTH = 58.0;
const SWEEP_END = ROLL, RISER_FROM = 16.0;
const i = process.argv.indexOf("--out");
const OUT = i > 0 ? process.argv[i + 1] : join(HERE, "media/bed-v2.wav");
const RAW = OUT.replace(/\.wav$/, "-raw.wav");
mkdirSync(dirname(OUT), { recursive: true });

// 1) vid2 synth: sections drive every instrument gate; the roll lives only in "build"
const sections = [{ at: 0, energy: "intro" }, { at: ROLL, energy: "build" }, { at: DROP, energy: "drop" }, { at: OUTRO, energy: "outro" }];
execFileSync("ffmpeg", synthArgs({ preset: "launch", key: "Am", bpm: BPM, durationS: LENGTH, sections, seed: 7 }, RAW), { stdio: "inherit" });

// 2) arrangement: sweep, riser, silent beat, outro fade
const cmds = [];
for (let t = 0; t < SWEEP_END - 1e-9; t += 0.1) {
  const k = t / SWEEP_END, f = Math.round(350 * Math.pow(9000 / 350, k * k));
  cmds.push(t.toFixed(2) + " lowpass f " + f);
}
cmds.push(SWEEP_END.toFixed(2) + " lowpass f 20000");
const riser = "(0.5*(2*random(0)-1)+0.5*sin(2*PI*(220*t+38*t*t)))*pow(max(0,min(1,(t-" + RISER_FROM + ")/" + (SILENT - RISER_FROM) + ")),2)*between(t," + RISER_FROM + "," + SILENT + ")";
// gain envelope, sample accurate (amultiply): quiet filtered buildup rising into the roll, an exact silent beat, full level from the drop
const pre = "if(lt(t," + ROLL + "),0.40+0.25*pow(t/" + ROLL + ",2),0.38+0.30*(t-" + ROLL + ")/" + (SILENT - ROLL) + ")";
const gain = "if(lt(t," + (SILENT - 0.004) + ")," + pre + ",if(lt(t," + SILENT + ")," + pre + "*(" + SILENT + "-t)/0.004,if(lt(t," + DROP + "),0,1)))";
const graph = [
  "[0:a]asendcmd=c='" + cmds.join(";") + "',lowpass=f=350:p=2[swept]",
  "aevalsrc=exprs='" + riser + "':s=48000:d=" + LENGTH + ",highpass=f=1200,lowpass=f=9000,volume=0.30,aformat=channel_layouts=stereo[rise]",
  "aevalsrc=exprs='" + gain + "|" + gain + "':s=48000:d=" + LENGTH + "[gain]",
  "[swept][rise]amix=inputs=2:normalize=0:duration=first[mix]",
  "[mix][gain]amultiply,afade=t=out:st=" + (LENGTH - 1.5) + ":d=1.5[out]",
];
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", RAW, "-filter_complex", graph.join(";"), "-map", "[out]", "-c:a", "pcm_s24le", "-ar", "48000", "-y", OUT], { stdio: "inherit" });
console.log(JSON.stringify({ ok: true, out: OUT, bpm: BPM, drop: DROP, roll: [ROLL, SILENT], silentBeat: [SILENT, DROP], length: LENGTH }));
