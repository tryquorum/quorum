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

## Beat sheet (85.3 s)

| # | t (s) | dur | id | picture | caption |
|---|---|---|---|---|---|
| 1 | 0.0 | 4.3 | hook | night pixel sea, empty, moon | Too many cooks spoil the broth. |
| 2 | 4.3 | 5.0 | boatmen | one boat on the moon path | In Korea: too many boatmen steer the ship up a mountain. (small: 사공이 많으면 배가 산으로 간다 · 船頭多くして船山に登る) |
| 3 | 9.3 | 6.4 | fleet | boats multiply 1→14, each tagged by an agent (Codex, Claude Code, Cursor, Grok Bot, Muse, Pickle, your scripts); HUD agents/directions counter | Now everyone has agents. (small label: your agents — examples) |
| 4 | 15.7 | 3.2 | spin | boats orbit in place; red mono labels SAME TASK · 4TH TIME, RE-PROPOSED WHAT YOU REJECTED | Some spin in circles. |
| 5 | 18.9 | 3.2 | rocks | a boat runs at a reef; SENT THE EMAIL, PAID THE INVOICE, POSTED IT PUBLICLY | Some row onto the rocks. |
| 6 | 22.1 | 3.2 | mountain | boats climb the mountain; A RESULT NOBODY ASKED FOR | Some sail up a mountain. |
| 7 | 25.3 | 5.4 | buried | rebuilt inbox (vector, fictional): agent noise rows pile in; "Re: pilot pricing — can we start Monday?" and "Action needed: confirm your demo slot" slide under | And the email that mattered sinks. |
| 8 | 30.7 | 4.6 | judgment | dark, serif, accent on "your judgment" | You need something that stands in for your judgment. |
| 9 | 35.3 | 4.4 | converge | chaos peak → pixel dissolve → agent cards slide, overlap and shrink to the centre (1.6 s in-out) → one card: quorum + one boat | Meet Quorum. |
| 10 | 39.7 | 3.0 | landing | capture: landing hero + pixel sea | (the site headline) |
| 11 | 42.7 | 4.5 | story | capture: landing story scrub, boats → CEO REV QA CSO → one direction | Your agents propose. The council argues first. |
| 12 | 47.2 | 6.0 | workspace | capture /w: click a line → summary popup with "gbrain remembers" → Send to agent | Pick a line on your board. Send it to the council. |
| 13 | 53.2 | 7.0 | council | capture: CEO · Reviewer · QA · CSO critiques → pass / hold / reject | gstack's CEO, Reviewer, QA and CSO question every proposal. |
| 14 | 60.2 | 4.5 | execute | capture: passed work runs in Aside; the send is held | Only what passes runs. Risky sends wait for you. |
| 15 | 64.7 | 4.0 | reuse | capture: same request → verdicts reused from gbrain (+ the measured time) | gbrain remembers your call. Next time it's instant. |
| 16 | 68.7 | 4.3 | heal | terminal capture: recipe v2 404 → Aside → v3 PASS | APIs that break get repaired: recipe v3. |
| 17 | 73.0 | 3.6 | mcp | rebuilt: agent chips → quorum_propose over MCP | Bring the agents you already use — over MCP. |
| 18 | 76.6 | 4.2 | built | logos: Aside · gbrain · gstack · Direction Board · Codex | Built on Aside, gbrain, gstack, Direction Board and Codex. |
| 19 | 80.8 | 4.5 | cta | wordmark, one boat sails the moon path | quorum.lidgeai.com · github.com/tryquorum/quorum |

Caption pace rule: ≤ 2.3 words per second including a 0.4 s entrance (A-audit r2). Captured Korean UI text gets an English caption.

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

(filled in wp2)
