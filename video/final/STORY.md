# Quorum — final submission film (lane/video-final)

The source of truth for the final film. `build-timeline.mjs` reads its beat numbers from here by hand; change the table first, then the builder.
Made with [vid2-gen](https://github.com/lidge-ai/vid2-gen) 0.6.0. English, 1920x1080, 30 fps, about 85 s, captions as narration (no voice-over),
synthesized music bed, −14 LUFS. Replaces the 61 s film in `video/timeline.json` (kept for history).

## Claim and proof

- Claim: more agents make more mess; Quorum stands in for your judgment, so only work worth doing runs.
- Proof shot: a line on the board → Send to agent → gstack's CEO, Reviewer, QA and CSO question each proposal → verdicts → Aside runs what passed,
  the risky send waits for you → the same request later reuses the verdict from gbrain.

## Message

1. "Too many cooks spoil the broth." Judges know it; it opens the film.
2. Korea says it with a boat: 사공이 많으면 배가 산으로 간다, "too many boatmen steer the ship up a mountain". Japan has the same saying
   (船頭多くして船山に登る), so it reads as common sense rather than a pun. The landing page already draws a pixel boat, so the film does too.
3. What the saying describes: when everyone rows their own way the boat spins in place or runs onto rocks; a meeting with no convergence
   produces no progress, a meaningless compromise, or something nobody wanted. With agents: (1) spinning: busy work, the same task again,
   yesterday's rejected idea; (2) rocks: an email, a payment or a public post that should never have gone out; (3) the mountain: a result nobody asked for.
   Meanwhile the thing that mattered is missed: an important email, a sales lead.
4. "You need something that stands in for your judgment." Quorum: gstack roles argue first, only what passes runs in Aside or Codex,
   gbrain remembers your call, the direction lives on your board.

## Beat sheet v2 (58.0 s at 120 BPM — beat 0.5 s, bar 2.0 s; drop at 24.0 s; v1 85.3 s sheet is in STORY-v1.md)

User feedback on v1: "1.5배 하고 비트 드랍이 없어." Every cut sits on a beat, every cut after the drop on a bar; hard cuts only.
Music (`music.mjs`): low-pass-swept buildup 0–21.5, riser 16–23.5, one-bar snare roll 21.5–23.5, one silent beat 23.5–24.0, kick+bass+impact
drop at 24.0 on the convergence, outro 54–58. Captures play at 1.5x (story scrub 3x, terminal 4x) with the waits cut by in-points.

| # | t (s) | dur | id | picture | caption |
|---|---|---|---|---|---|
| 1 | 0.0 | 3.5 | hook | night pixel sea, empty, moon | Too many cooks spoil the broth. |
| 2 | 3.5 | 3.5 | boatmen | one boat on the moon path | Too many boatmen? Up a mountain. (small, Korean original: 사공이 많으면 배가 산으로 간다 · 船頭多くして船山に登る) |
| 3 | 7.0 | 3.0 | fleet | boats multiply 1→14 with agent tags (examples), HUD counter | Now everyone has agents. (small label: your agents — examples) |
| 4 | 10.0 | 2.0 | spin | boats orbit in place, red labels | Some just spin. |
| 5 | 12.0 | 2.0 | rocks | a boat hits the reef, red labels | Some hit rocks. |
| 6 | 14.0 | 2.0 | mountain | boats climb the mountain | Some climb mountains. |
| 7 | 16.0 | 3.5 | buried | rebuilt inbox (fictional): the lead and the important mail sink under agent noise | The email that mattered sinks. |
| 8 | 19.5 | 4.5 | judgment | night; from 2.0 s (roll) the agent cards gather inward, frozen on the silent beat | You need something that stands in for your judgment. |
| 9 | 24.0 | 2.0 | converge | DROP: cards snap into the Quorum seats, lime core lands | Meet Quorum. |
| 10 | 26.0 | 4.0 | landing | capture: landing hero, then the story section (boats → CEO REV QA CSO → one direction) | Agents propose. The council argues first. |
| 11 | 30.0 | 4.0 | workspace | capture /w: click a task → popup with gbrain remembers → Send to agent | Pick a task. Send it to the council. |
| 12 | 34.0 | 4.0 | council | capture: CEO · Reviewer · QA · CSO critiques → pass / hold; panel lights the four roles (Gstack award beat) | gstack's four roles question every proposal. |
| 13 | 38.0 | 4.0 | execute | capture: Aside reads the public page; the reply is held | Only what passes runs. Sends wait for you. |
| 14 | 42.0 | 4.0 | reuse | capture: same request → verdicts reused; panel 35 s → 0.9 s (Gbrain award beat) | gbrain remembers your call, and reuses it. |
| 15 | 46.0 | 2.0 | heal | recorded terminal run rmw8phbj41fbe4b: v2 404 → Aside → v3 | APIs repair themselves. |
| 16 | 48.0 | 4.0 | mcp | rebuilt: agent chips → quorum_propose over MCP | Bring your own agents — over MCP. |
| 17 | 52.0 | 2.0 | built | logos: Aside · gbrain · gstack · Direction Board · Codex | Built on |
| 18 | 54.0 | 4.0 | cta | wordmark, one boat sails the moon path | quorum.lidgeai.com · github.com/tryquorum/quorum |

Award beats: the form lists the Gbrain / Gstack award, so beat 13 (gstack's four roles arguing, real run) and beat 15 (gbrain recalling a stored verdict, real run) are the clearest shots in the film; gbrain also appears in beat 12's popup ("gbrain remembers").

Caption pace rule: words / (dur − 0.4) ≤ 2.3 for every caption (A-audit wp1); checked by video/final/check.mjs. gstack is the source of the four roles (src/engine/roles.ts criteria come from gstack SKILL.md); there is no separate gstack process, and the film never claims one. Captured Korean UI text gets an English caption.

## Facts register

| On screen | Backed by |
|---|---|
| CEO, Reviewer, QA, CSO question every proposal | `src/engine/roles.ts` CRITICS (ceo, reviewer, qa, cso) and `critiquePrompt` |
| pass / hold / reject; risky sends wait for you | `src/engine/rules.ts` (OUTBOUND, HOLD_RISKS) |
| runs in Aside or Codex | `src/executors/aside.ts` browserTask, `src/executors/codex.ts` codeTask |
| gbrain remembers your call; reuse | `src/executors/gbrain.ts` (quorum/verdicts/<runId>), `src/engine/dedup.ts` threshold 0.82 |
| recipe v3 self-repair | `src/recipes/runner.ts`; recorded run rmw8phbj41fbe4b (video/README.md) |
| over MCP | `src/engine/mcp.ts` quorum_propose, shown only with QUORUM_MCP_PROPOSE=1 (`src/server.ts`) |
| Grok Bot, Muse, Pickle, Codex, Claude Code, Cursor | examples of agents people use (docs.x.ai/grok-bot, about.fb.com Muse 2026-09, YC Pickle W25); no integration is claimed |
| the inbox | rebuilt vector UI with fictional senders; not a real account |

## Look

- Colour script: 1–9 night (pixel-sea dark palette: sky #08080a→#18203c, moon #f4ecd2, boats #020204 on the water, ink #fafafa); alerts red #f87171 mono caps;
  Quorum accent = site dark `--signal` #d9f99d. 10–16 light product footage inside a window card on #f3f3f4 (site canvas). 17–19 back to night for the close.
- Type: proverb and judgment lines in Instrument Serif (quote voice, as goat-anywhere's serif headlines); captions and product copy in Geist
  (the site's font, weight 600–640, tight tracking); labels and HUD in Geist Mono caps.
- Motion (from goat-anywhere, captured 2026-11-09): counter HUD climbs while icons multiply and red labels pop; chaos peaks ~4 s; dissolve to particles
  ~0.5 s; scattered cards slide, overlap and shrink to one point over ~1.6 s in-out with no rotation; cross-fade into one calm card with a lime dot.
- Sound: synth bed 112 BPM; impacts on beat 8 (judgment) and beat 9 (Meet Quorum); autoCues for pops/whooshes; −14 LUFS.

## Assets

- Pixel scenes: `video/tools/pixel-scenes.ts` renders beats 1–9 and 19 from the landing's own palette and Bayer dither (`site/web/src/landing/pixel-sea.tsx`, `story.tsx`).
- Agent logos: official pages read through Aside, files in `video/final/media/logos/` (gitignored) with `SOURCES.md`. Codex uses `site/logos/openai.svg`
  (OpenAI publishes no Codex mark). Credits reuse `site/logos/`.

## Capture plan

- After `git merge origin/main`, run a separate demo server from this worktree with `video/final/demo-env.sh`: fresh state dir, port 4331, no Direction Board
  (import off, URL unreachable, no token), recipes DB and gbrain brain inside `video/tmp/`, Aside on for the one real run, MCP propose on.
- Seed fictional items (no real people or addresses) through `/api/ws/items` and `/api/ws/signals`; the request names only public sources.
- Filming constraints: no inbox or personal tab visible while Aside runs; review every captured frame before it goes into the cut.
- One real council run (paid Aside), one reuse run with the identical request; record run ids and timings below.

## Runs used

Recorded 2026-11-09 on an isolated demo server (`video/final/demo-env.sh`: port 4331, fresh state dir, Direction Board unreachable, its own empty gbrain brain
outside the repo, Aside account u0 on). Board data is fictional (`video/final/seed.ts`); the request reads only the public page ycombinator.com/rfs.
Numbers come from `/api/runs/<id>/events` via `video/final/runs.json`.

| Run | What happened | Measured |
|---|---|---|
| rmw8so82i1b6857 (first) | gbrain: nothing similar. 3 proposals; CEO, Reviewer, QA and CSO critiqued each (12 critiques). Verdicts: pass 1 (shortlist YC RFS, Aside), hold 2 (draft the Northwind reply: outbound, people decide; board note: keep 2 · cut 2 tie). Aside read the RFS page (11 items) and shortlisted 4. gbrain saved quorum/verdicts/rmw8so82i1b6857. | verdicts at 35.2 s, Aside result at 78.8 s |
| rmw8ssbpf4d4ade (same request) | gbrain: 1 similar verdict, 100 % → reused; no bots asked; same pass 1 · hold 2; Aside ran the passed item again. | verdicts at 0.9 s, Aside result at 25.9 s |
| rmw8phbj41fbe4b (recipe, recorded earlier, lane/video) | luma-blasts v2 get-posts 404 → http 401 → Aside → v3 REPAIRED (7 items). Shown as a recording, labelled with its run id. | — |

The bots answer in Korean; the English side panels translate what is on screen. Nothing was sent: the reply stayed on hold.

## Reproduce

Captures (`captures/*.vid2cap`), `media/`, `../tmp/` and `../out/` are gitignored. `vid2` = `node ~/Developer/new/700_projects/vid2-gen/bin/vid2.js` (0.6.0).

```bash
mkdir -p ~/.cache/quorum-video-demo/gbrain-home-film && video/final/gbrain-demo.sh init --pglite   # empty demo brain outside the repo
QVF_STATE=$PWD/video/tmp/state-new; set -a; source video/final/demo-env.sh; set +a; bun run src/server.ts   # port 4331
bun video/final/seed.ts                                    # fictional board
cd video/final/captures
vid2 capture web --url http://127.0.0.1:4331/  --steps ../flows/landing.steps.json --size 1440x900 --scale 1.5 --browser chrome -o landing
vid2 capture web --url http://127.0.0.1:4331/  --steps ../flows/story.steps.json   --size 1440x900 --scale 1.5 --browser chrome -o story
vid2 capture web --url http://127.0.0.1:4331/w --steps ../flows/council.steps.json --size 1440x900 --scale 1.5 --browser chrome --record-text -o council   # paid Aside run
vid2 capture web --url http://127.0.0.1:4331/w --steps ../flows/reuse.steps.json   --size 1440x900 --scale 1.5 --browser chrome --record-text -o reuse
cp -R <lane/video>/video/recipe4.vid2cap .                 # recorded recipe run
cd .. && node render-scenes.mjs && node build-timeline.mjs --final
vid2 render timeline.json -o ../out/quorum-final.mp4 --hw-accel if-possible
vid2 qa ../out/quorum-final.mp4 --timeline timeline.json --expect-audio && node check.mjs --film ../out/quorum-final.mp4
```

`captures.json` holds the in-points for these specific recordings and `runs.json` the measured numbers; a new recording needs both updated
(`runs.json` from `/api/runs/<id>/events`).
