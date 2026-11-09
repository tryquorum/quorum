# Quorum demo video (lane/video)

Submission video for c0mpiled-17 Seoul (YC RFS Multiplayer AI + Self-Maintaining APIs), made with [vid2-gen](https://github.com/lidge-ai/vid2-gen) 0.6.0. English, 1920x1080, 30 fps, about 61 s, no voice-over, synthesized music bed.

Everything on screen is real footage from this repository's server, recorded 2026-11-09:

| Scene | Source | Run |
|---|---|---|
| request, proposals, critiques, verdicts, board gate | `vid2 capture web` of `/app` (live1) | live council `rmw8p8d6s8c4979`, 77.7 s, pass 2 · hold 1 · reject 2 |
| CEO cut / CSO escalate | frame 86.3 s of live1 (`media/cso_86.3.png`) | same run |
| memory reuse | `vid2 capture web` (reuse1), same request again | `rmw8patnef290ff`, 29.0 s, 5 verdicts reused from gbrain |
| self-healing API | `vid2 capture terminal` of `tools/recipe-stream.ts` (recipe4) | recipe `rmw8phbj41fbe4b` on b6a214b: v2 get-posts 404 → get-blasts 401 → Aside get-blasts 200 PASS → v3 (7 items) |
| title | `vid2 capture web` of the landing page (landing1) | — |

The bots answered in Korean; the English captions translate what is on screen. The Aside result that contains a personal email stays collapsed in the console and is never shown. `tools/recipe-stream.ts` prints event types, endpoints and counts only, never announcement text.

## Reproduce

Captures (`*.vid2cap`), `media/`, `tmp/` and `out/` are gitignored. With a server on port 4330 (`QUORUM_PORT=4330 QUORUM_ASIDE=1 bun run src/server.ts`):

```bash
cd video
vid2 capture web --url http://127.0.0.1:4330/app --steps flows/live.steps.json --size 1440x900 --scale 1.5 --browser chrome --record-text -o live1
vid2 capture web --url http://127.0.0.1:4330/app --steps flows/live.steps.json --size 1440x900 --scale 1.5 --browser chrome --record-text -o reuse1
vid2 capture web --url http://127.0.0.1:4330/ --steps flows/landing.steps.json --size 1440x900 --scale 1.5 --browser chrome -o landing1
(cd flows && vid2 capture terminal --tape recipe.tape -o ../recipe4)
mkdir -p media && ffmpeg -ss 86.3 -i live1.vid2cap/footage.mp4 -frames:v 1 media/cso_86.3.png
vid2 render timeline.json -o out/quorum-demo.mp4 --hw-accel if-possible
vid2 qa out/quorum-demo.mp4 --timeline timeline.json
```

Live council runs call `aside exec` (paid). In-scene times in `timeline.json` match these specific recordings; a new recording needs new `in` points.

## References used

- Recent @ycombinator launch videos on X (Theseus, Standard Physics, Aside, Trepo, ClaimKit, Hesper; read through Aside, read-only): the product or a striking visual in the first 3 s, cuts every 1.5–3 s, sentence-case captions with one accent, real UI with a typed goal and then one hard number, a 3–5 s end card with one action and a URL, music bed, no voice-over for product-UI pieces.
- goat-anywhere.vercel.app: a noisy hook (red/yellow error labels) that resolves into one calm surface.
- vid2-gen examples/vid2-launch and skills vid2-direction / vid2-timeline: caption bar, hard cuts plus a few 0.3 s fades, the launch synth preset.
