# Concept exploration (UX-CONCEPT-GEN-01)

Generator: ima2 v3.26.0 (GPT OAuth) after `ima2 status` and `ima2 serve`. Direction was partly concrete (existing
tokens and pixel scene), but section grammar and page rhythm were open, so three distinct directions were generated
(UX-IMAGE-FIRST-01, reduced to 3 per the cycle brief). Files: `concepts/A-logbook.png`, `B-stage.png`,
`C-chapters.png`. Concept art guides direction only; generated text and data in it are not used.

| | A. Ship's logbook | B. Product as stage | C. Pixel chapters |
|---|---|---|---|
| Layout family | left-aligned 12-col, mono time gutter, every section a dated log entry | centered statement over pixel sea, real app full width below, then one repeated claim/artifact row | three full-viewport pixel scenes with overlaid type, white bands between |
| Strength | proof reads as evidence; strongest provenance (time, seq) | product first; one grammar makes the page feel like one object; flag-boat sprite reads as a sailboat | most memorable; the metaphor is unmissable |
| Weakness | product appears late; long and text-heavy for 90 s | can drift into a generic SaaS row if the artifacts are fake | three scenes cost three viewports; low proof density; type over busy scenes risks contrast |
| Fit for PER-1 (90 s judge) | medium | high | medium |
| Fit with /w and /app | high (same mono labels) | high (same cards and chips) | low (game look) |

## Element ledger (synthesis)

| Token | Best variant | Rationale | Value locked |
|---|---|---|---|
| Hero grammar | B | product as stage; FE-HERO-LIGHT-CENTER authored-field variant: the pixel sea is the field, <= 3 semantic elements over it | centered statement + real /w preview below, closed on load |
| Section grammar | B | one repeated "claim + artifact" row is what makes the page one object | 12-col: claim 4 cols (sticky >= 1024), artifact 8 cols |
| Proof styling | A | mono provenance (11:31 KST, seq 15) turns cards into a log | mono label row on every proof card; one eyebrow with the recording time |
| Metaphor scene | C | the scattered fleet and the line along the moon path | kept as the single story scene (already built), not three chapters |
| Agent sprite | B | hull + triangular sail, flag at the masthead reads instantly | 18x16 sprite, 40 px flag chip, 24 px logo |
| Palette | all | none added hues; our tokens already match | tokens in DESIGN-READ |

Chosen: B with A's provenance gutter and C's scene, because the 90-second judge must see the product working
before anything else (GAP-1, GAP-3), and one grammar fixes the "assembled page" problem (GAP-5).

## Design system (locked)

Type scale (visual-hierarchy §1, ratio >= 1.25 between levels):

| Level | Use | Size | Weight |
|---|---|---|---|
| L1 | hero headline, closing statement | clamp(2.25rem, 1.15rem + 3.2vw, 4rem) | 650, -0.04em |
| L2 | section claim | clamp(1.75rem, 1rem + 1.6vw, 2.5rem) | 650, -0.03em |
| L3 | card title, step title | 1.125rem | 600 |
| L4 | body | 1rem / 1.6, max 62ch | 400 |
| L5 | caption, card body | 0.875rem / 1.5 | 400 |
| L6 | provenance label | 0.75rem mono | 400 |

Spacing rhythm: section padding-block clamp(56px, 6vw, 80px) so two sections sit 112-160 px apart at 1280
(64 px at 390); element groups 24-32 px; elements 8-16 px; claim-to-artifact 40-64 px. One container
(1160 px + gutter clamp(20px, 4vw, 40px)).

Grid: 12 columns, 24 px gap at >= 1024; claim 4, artifact 8. 768-1023: claim on top, artifact full width. < 768:
single column, artifacts may scroll horizontally only where they are row lists of cards.

Section grammars (no others allowed on the landing):
1. **Stage**: centered statement (<= 3 semantic elements) over the pixel sea, artifact full width below. Hero only.
2. **Claim + artifact**: L2 claim + <= 2 sentences (+ optional provenance label) left, one real artifact right.
   Story, Proof, Judgment, Recipes, Runs on.
3. **Statement**: centered L1 + one line + two CTAs. Closing only.

Section order: Hero (Stage) -> Story "More agents, one direction." -> Proof "The record from Seoul." (stats, critic
quotes, verdicts, Aside result, demo video) -> Judgment "Something that stands in for your judgment." (what slips +
the seven-step flow) -> Recipes "APIs that fix themselves." -> Runs on "Keep the boatmen you have." (agents over
MCP + built-on tools, one logo section) -> Statement CTA.

Motion rules: signature = story scrub; supporting = flow-step progress, one-time block entrance (opacity and
10 px, 350 ms), count-up once. Never hide content before script. Flags sway by rotation only. Reduced motion:
none of the above, final frames shown.

Components: Card = `lp-ring` 1px inset ring on bg-card, radius 16, no shadow (FE-BORDER-SHADOW-01); one floating
shadow allowed on the hero preview only. Chips: tone.ts CHIP / DECIDE / ALERT. Buttons: pill, primary = ink fill,
secondary = ring. Provenance label = L6 mono, muted.

