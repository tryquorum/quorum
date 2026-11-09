# Landing experience audit (cycle c5, 2026-11-09)

Owner skills: cxc-dev-uiux-design experience-audit.md (UX-AUDIT-01..08) and cxc-dev-frontend
visual-audit-loop.md (FE-VISUAL-AUDIT-01..03). Scope: `/` (landing). `/app` and `/w` are in scope only for
token consistency. Base commit: 8b4cfa9 (main) merged into lane/site3.

Capture command: `node docs/design/audit/cap.cjs` (Playwright 1.64 driving installed Chrome, colorScheme and reducedMotion
set per context, fonts ready, 1.2 s settle) against `bun run src/server.ts` on QUORUM_PORT=4350 with
QUORUM_BOARD_IMPORT=0 and an empty temporary state dir, so no personal board data is loaded.

## 1. Evidence inventory (UX-AUDIT-01, UX-AUDIT-08)

Sources available: rendered pages, repo source, the recorded Seoul run fixture, docs/spec.pdf, AGENTS.md hackathon rules,
integration-thread notes relayed by the user. Not available: analytics, real visitor recordings, judge feedback.

| EV | Type | Route / state | Viewport / theme | File |
|---|---|---|---|---|
| EV-1 | screenshot, full page | / default | 1280 light | before/landing__default__1280__light.png |
| EV-2 | screenshot, full page | / default | 1280 dark | before/landing__default__1280__dark.png |
| EV-3 | screenshot, full page | / default | 768 light | before/landing__default__768__light.png |
| EV-4 | screenshot, full page | / default | 768 dark | before/landing__default__768__dark.png |
| EV-5 | screenshot, full page | / default | 390 light | before/landing__default__390__light.png |
| EV-6 | screenshot, full page | / default | 390 dark | before/landing__default__390__dark.png |
| EV-7 | screenshot, full page | / reduced motion | 1280 light | before/landing__reduced__1280__light.png |
| EV-8 | measurement (probe.cjs) | / default | 1280 light | section tops/heights, eyebrows, opacity, sizes (below) |
| EV-9 | code | site/web/src/landing/demo/main.tsx:14 | — | demo opens `?open=i:seoul-ask` at >=900 px |
| EV-10 | code | site/web/src/landing/judgment.tsx (FlagBoat) | — | 3 extra mast rows, 26 px flag chip, 16 px logo |
| EV-11 | code | site/web/src/landing/landing.css:31 | — | `.lp-section { padding-block: clamp(72px,10vw,136px) }` on every section |
| EV-12 | code | site/web/src/landing/story.tsx:237 | — | sticky runway `h-[200svh] lg:h-[260svh]` |

EV-8 measured values (1280 light): 10 sections (hero 1468 px, story 2080, judgment 943, demo 648, how 1086,
agents 742, record 1163, recipes 800, built-on 629, cta 638); section padding 128 px top and bottom, so 256 px
between any two sections; 7 `.lp-eyebrow` labels (Meanwhile, The run, How it works, Bring your agents, The record,
Self-maintaining APIs, Built on) plus the story's mono proverb line; inactive story and flow steps at opacity 0.45
on #666 text (effective about #b5b5b5 on #f3f3f4, about 1.9:1); agent flag chip 28 px with a 17 px logo on a
45x48 px boat; workspace iframe 1158x700; h1 59.4 px, h2 36.5 px, body 18 px; 0 em dashes; no horizontal
overflow at 1280/768/390; no console errors.

## 2. Personas (UX-AUDIT-02)

| ID | Role and goal | Context | Expertise | Access needs | Locale | Evidence |
|---|---|---|---|---|---|---|
| PER-1 | YC / hackathon judge deciding in about 90 s what Quorum is and whether it works | Laptop 1280-1440, often split screen next to the submission form; one pass, time-boxed | Knows agents, MCP, YC RFS; no Korean | Skims; may keep reduced motion on; keyboard and trackpad | US English | User brief ("US YC judges, 90 s"); ASSUMED split screen: if wrong, 768 checks matter less |
| PER-2 | Developer who runs several agents and wants to try Quorum on their own board | Desktop and phone (link shared in chat) | High; reads code, MCP | Phone 390, sometimes dark mode | English, some Korean | ASSUMED from the GitHub CTA and MCP section; if wrong, the MCP block can shrink |
| PER-3 | Low-vision or keyboard-only visitor | Any | Varies | Contrast AA, focus visible, reduced motion, no information by motion alone | English | Included per UX-AUDIT-02 access rule |

## 3. Journeys (UX-AUDIT-03)

PER-1 (primary):

| Stage | Screen | Intent | Expected response | Current friction | Exit risk |
|---|---|---|---|---|---|
| First run | hero | "What is this?" in 5 s | One sentence + the product, visibly working | Headline clear; the workspace below opens with a dialog covering the board (EV-1, EV-9) | Medium: reads as a form, not a board |
| Core task: understand the problem | story | Get the "too many cooks" point | Scene + 3 short lines | Strong scene; 260svh pinned runway feels long; inactive steps unreadable (EV-8) | Low-medium |
| Core task: see proof | record, demo video | Believe it ran for real | Real verdicts and real result | Proof is split across four places (story counts, demo video, record, recipes) and arrives after 7000 px | High: judge leaves before proof |
| Core task: how it fits my agents | agents | Will it work with Codex/Claude? | Recognisable logos, honest MCP scope | Logos at 17 px read as dots; boats look like chairs (EV-10) | Medium |
| Leaving | CTA | Next step | One CTA, repo link | Fine | Low |
| Navigation | nav | Jump to proof | Anchors match sections | Nav lists "How it works / The record / Recipes", no anchor to the story or agents | Low |
| Errors, settings, input, waiting, help | — | N/A on a landing page, except the demo's read-only refusal message (works) | — | — | — |

PER-2: same stages plus mobile; at 390 the preview is edge-to-edge and usable, but the page is 13,240 px long (EV-5).
PER-3: inactive step text fails 1.4.3 (EV-8); motion carries no information that is not also in text (story steps are text).

## 4. Ideal state (UX-AUDIT-04)

- IS-1 First viewport (1280x800): headline, one-line lede, two CTAs, and the top of the real workspace board visible with no dialog over it; within one more scroll the visitor sees a visible prompt naming the action to try (J first-run).
- IS-2 The visitor reaches real proof (a recorded verdict with a critic's words) within 2 screens of scroll (<= 2,000 px at 1280) and at least once more before the CTA.
- IS-3 Every section uses one of at most 3 declared section grammars from the design system; section rhythm comes from one spacing scale (section gap >= element-group gap x2, but no single gap > 160 px at 1280).
- IS-4 Agent logos render at >= 24 px, unaltered, on a chip that meets 3:1 against the logo; the boat reads as a sailboat at a glance.
- IS-5 All text present on screen meets WCAG 1.4.3 (4.5:1, large 3:1) in every state including "inactive" steps; focus visible on every control; reduced motion delivers the same content (2.3.3 advisory, 1.4.3, 2.4.7).
- IS-6 Total page height at 1280 <= 8,000 px (about 10 screens) so a 90 s skim reaches the CTA.
- IS-7 Eyebrows <= ceil(sections/3); copy has no meta narration; claims are real or labelled examples.

## 5. Gap ledger (UX-AUDIT-05)

| GAP | Persona, stage | Current (EV) | Ideal | Impact | Principles | Sev | Fix direction | Verifier |
|---|---|---|---|---|---|---|---|---|
| GAP-1 | PER-1 first run | Demo opens with the item dialog over the board at >=900 px (EV-1, EV-9) | IS-1 | Board hidden; reads as a form | J first-run, UX-STATE-01 onboarding | S2 | Start closed; pulse hint on the Seoul row and on Send to agent once open | Visual judgment: "Is the Now list fully visible and is one row marked to click?" at 1280 light/dark |
| GAP-2 | PER-3 all | Inactive steps at 0.45 opacity, about 1.9:1 (EV-8) | IS-5 | Unreadable text, WCAG 1.4.3 fail | WCAG 1.4.3 | S1 | Show inactive steps at full contrast; mark the active one with weight and a rule, not opacity | Computed contrast of every step paragraph >= 4.5:1 |
| GAP-3 | PER-1 proof | Proof starts at 7,022 px; split over 4 sections (EV-8) | IS-2 | Judge may leave before proof | visual-hierarchy §5 position | S2 | Reorder: hero, story, proof (record), how it fits; merge demo video into the proof section; drop the separate "What slips" grid into the story/judgment block | Probe: top of first critique card <= 2,000 px + hero height |
| GAP-4 | PER-1 all | 256 px between every section, 260svh story runway (EV-8, EV-11, EV-12) | IS-3, IS-6 | Page reads empty; 10,361 px tall | visual-hierarchy §4, density contrast | S3 | One spacing scale: section gap 96-112 px at 1280, 64 px at 390; story runway 180svh | Probe: max inter-section gap <= 160 px; page height <= 8,000 px |
| GAP-5 | PER-1 all | 6 different section grammars (centered, split, 3 equal cards, split-header, card rows, terminal split) and 7 eyebrows (EV-1, EV-8) | IS-3, IS-7 | Page feels assembled, not designed | layout-discipline section repetition, split-header ban, eyebrow restraint, aesthetics 3-card ban | S3 | Declare 3 grammars (Stage, Claim+Artifact, Statement); eyebrows <= 4 | Grammar audit table in DESIGN-READ; probe eyebrow count <= 4 |
| GAP-6 | PER-1/2 agents | Boat with 3-row mast looks like a chair; 17 px logo (EV-10) | IS-4 | Logos unreadable; joke reads as a bug | logo-trust-sections visual treatment | S3 | New sprite: hull + triangular sail; flag 36-40 px chip, logo 24 px, on the mast top | Probe: logo img >= 24 px; visual judgment "reads as sailboat with flag" |
| GAP-7 | PER-1 first run | Hero lede is 4 lines and 46 words at 1280 (EV-1) | IS-1 | Slower first read | FE-HERO-01 (subtext <= 20 words) | S3 | Lede <= 25 words; move the judgment sentence into the story | Word count |
| GAP-8 | PER-1 all | Nav anchors miss the story/agents; "Recipes" is a minor section (EV-1) | IS-2 | Navigation does not match the story | J navigation | S4 | Nav: Why / Proof / Agents / GitHub | DOM check of nav hrefs vs section ids |
| GAP-9 | PER-1 agents | "Built on real tools" and "Bring your agents" are two logo sections with different cards (EV-1) | IS-3 | Repetition, two logo walls | FE-MARQUEE/logo-trust one section | S4 | One "Runs on" section: built-on row + bring-your-agents row in the same grammar | Count of logo sections = 1 |
| GAP-10 | PER-2 390 | 13,240 px page at 390 (EV-5) | IS-6 | Endless scroll on phone | mobile-ux | S3 | Same reordering; fewer sections; record cards 2 visible + horizontal scroll | Probe height at 390 <= 10,000 px |

## 6. Concept-level anti-slop findings (UX-AUDIT-06)

| SLOP | Location | EV | Generic default | Why it fails here | Alternative |
|---|---|---|---|---|---|
| SLOP-1 | "What slips" three items | EV-1 | three equal cards (aesthetics 3-card ban) | Equal weight for two examples and one real fact flattens the only real proof | One list inside the story/judgment block, the real item first |
| SLOP-2 | Agents header | EV-1 | split header (big headline left, small paragraph right) | layout-discipline Split-Header Ban | Stack headline over body |
| SLOP-3 | Eyebrows on every section | EV-8 | uppercase mono eyebrow per section | Eyebrow restraint (<= 4 for 10 sections) | Keep eyebrows only where they carry provenance ("Recorded 9 Nov, 11:31 KST") |
| SLOP-4 | Section padding | EV-11 | uniform padding everywhere ("everything centered with uniform padding") | No rhythm, reads empty in captures | One scale with dense/sparse alternation |

## 7. Handoff (UX-AUDIT-07)

Fix order: GAP-2 (S1), then GAP-1, GAP-3 (S2), then GAP-4, -5, -6, -7, -10 (S3), then GAP-8, -9 (S4).
Each GAP becomes a violation row in after/ledger with the same EV ids as before evidence.



## 8. After (FE-VISUAL-AUDIT-01..03), cycle c5 head

After captures: `after/` with the same names (same command, same server flags). Measurements: probe.cjs and
a11y.cjs (computed contrast for every text node in `main` outside canvas/iframe/video/aria-hidden, both themes,
reduced motion; Tab walk from the top).

| V / GAP | Before | After | Verifier, result |
|---|---|---|---|
| GAP-1 demo opens with a dialog over the board | EV-1, EV-9 | after/landing__firstviewport__1280__light.png: Now list visible, "Start here" ring on the Seoul row; ring moves to Send to agent when the popup opens | Visual judgment "Now list fully visible, one row marked": yes (1280 light, 1024 dark, 390 light/dark) |
| GAP-2 inactive steps about 1.9:1 | EV-8 | steps no longer dimmed; titles muted ink #666 (5.2:1), current step ink + top rule | a11y.cjs: 161 text nodes, 0 below threshold in light and dark (pass) |
| GAP-3 proof at 7,022 px, split over 4 sections | EV-8 | Record is the third section, top at 2,984 px (hero 1,328 + story 1,600); critics, verdicts, Aside result and the film in one artifact column | probe: first critique card top < hero + 2,000 px (pass: about 3,050 vs 3,384) |
| GAP-4 256 px between sections, 10,361 px page | EV-8, EV-11, EV-12 | section padding clamp(32px, 6vw, 80px) = 154 px between sections at 1280; story runway 185svh | probe: max inter-section gap 154 <= 160 (pass); page 7,555 px at 1280 (<= 8,000, pass) |
| GAP-5 six grammars, seven eyebrows | EV-1, EV-8 | three grammars: Stage (hero), Claim + artifact (.lp-ca: story, record, judgment, recipes, runs on), Statement (CTA); one eyebrow (The record) | probe eyebrows = 1 (<= 4, pass); grammar table in CONCEPT.md |
| GAP-6 chair-like boat, 17 px logo | EV-10 | 17x19 sprite with mainsail and jib, flag chip 40 px, logo 24 px (Codex file 36 px because of its built-in margins), flag on bare mast above the sails | probe: logo img 26 px >= 24 (pass); visual judgment "reads as a sailboat with a flag": yes |
| GAP-7 46-word lede | EV-1 | 23 words | word count 23 <= 25 (pass) |
| GAP-8 nav anchors | EV-1 | Why / Proof / Agents / GitHub -> #story, #record, #agents | DOM hrefs match section ids (pass) |
| GAP-9 two logo sections | EV-1 | one "Runs on" section: agents over MCP + Built on list | logo sections = 1 (pass) |
| GAP-10 13,240 px at 390 | EV-5 | 9,435 px at 390 | probe <= 10,000 (pass) |
| SLOP-1 three equal cards | EV-1 | list of three, real Seoul item first, examples labelled | removed |
| SLOP-2 split header | EV-1 | stacked claim | removed |
| SLOP-3 eyebrow per section | EV-8 | one | removed |
| SLOP-4 uniform padding | EV-11 | one scale, dense artifacts against sparse claims | reduced |

Other checks at the after head: no horizontal overflow at 1280/1024/768/390 in either theme; no console errors;
focus ring visible on skip link, nav, CTAs (the wordmark uses a ring, not an outline); reduced motion page 6,874 px
with every step at full ink and the final story frame; hero lede #3f3f46 on the lightest/darkest sky dither is
about 7.9:1 (light) and #d4d4d8 on #18203c about 10.7:1 (dark).

Open: none of S1-S2. Not verified: axe-core (not installed here; contrast and focus were measured by script
instead), real Safari/iOS, the workspace preview's own focus order inside the iframe.

