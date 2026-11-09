```yaml
---
name: quorum-landing
colors:
  canvas-light: "#f3f3f4"     # landing canvas (trygoat.ai canvas, zinc-tinted)
  canvas-dark: "#08080a"      # Direction Board --background (dark), off-black, never #000
  ink-light: "#0a0a0a"        # --foreground
  ink-dark: "#fafafa"
  muted-light: "#666666"      # --muted-foreground, 5.2:1 on canvas-light
  muted-dark: "#a1a1a1"       # 7.4:1 on canvas-dark
  emphasis: "inverted neutral chip"   # tone.ts DECIDE (bg-foreground text-background), the only emphasis
  danger: "red-400 text + red-500/45 border"  # tone.ts LATE/ALERT, failures only
  pixel-light: ["#f3f3f4", "#efeff1", "#e8e8eb", "#dfe0e4"] # sky ramp, dithered
  pixel-dark: ["#08080a", "#0b0d16", "#10142a", "#18203c"]  # navy sky ramp, moon cream #f4ecd2
typography:
  heading: { fontFamily: "Geist Variable", fontSize: "clamp(2.25rem, 1.15rem + 3.2vw, 4rem)", weight: 650 }
  section: { fontFamily: "Geist Variable", fontSize: "clamp(1.75rem, 1rem + 1.6vw, 2.5rem)", weight: 650 }
  body: { fontFamily: "Geist Variable", fontSize: "1rem", lineHeight: 1.6 }
  label: { fontFamily: "Geist Mono Variable", fontSize: "0.75rem" }
iconography:
  system: "Lucide"          # inherited from Direction Board / Workspace (shared shadcn components); one layer only
  weight: "regular 1.5px"
  domain: "library-subset + pixel sprites drawn in code (boats, moon, rocks)"
---
```

Source of truth for tokens: `site/web/src/index.css` (Direction Board tokens, 2ee6e8a) and
`site/web/src/workspace/tone.ts` (one-tone emphasis rules). This file adds the landing layer only.

## Reading

Reading this as: a product landing page for US YC / hackathon judges who already run coding agents, with a
logbook-of-a-real-run language. The reference is a ship's log kept next to a working app: the page shows the real
Workspace and the real record of one council run, and a pixel night sea carries the one metaphor (too many cooks /
too many boatmen). It is not a SaaS template: no feature grid, no testimonials, no invented numbers.

Signals read (design-read.md):
1. Page kind: product landing for an AI agent tool, also the public face of a hackathon submission.
2. Vibe words from the user across cycles: "방향판처럼" (like Direction Board), trygoat.ai structure, pixel art and
   dithering, "글씨가 너무 커" (type down a step), mouse and scroll action, one direction.
3. References: trygoat.ai (goat/apps/marketing + live page), Direction Board UI, the real /w Workspace.
4. Audience: US judges, about 90 seconds, often a laptop split screen; developers who run several agents.
5. Brand assets: quorum wordmark and seat mark, Direction Board tokens, the pixel sea (pixel-sea.tsx), official tool
   and agent logos with SOURCES.md, the recorded Seoul run (live-seoul.json), the 61 s demo video.
6. Quiet constraints: real values only, examples labelled, no official-integration claims, no personal data,
   WCAG 2.2 AA contrast, reduced motion, workspace and console sources untouched except token consistency.

Do's: show the real Workspace first and make the one action to try obvious; reach a real critic quote within two
screens; one emphasis (inverted chip) per viewport; mono labels only for provenance (time, seq, run id).

Don'ts: equal three-card rows, split headers, an eyebrow on every section, opacity-dimmed text, a second logo wall,
gradients or glow, a dialog covering the product on first paint, new hues.

## Dials

```
DESIGN_VARIANCE: 5
MOTION_INTENSITY: 5
Product density profile: D3
Reasoning: a landing (LANDING bucket, scroll floor 2) whose proof is dense product evidence; variance stays
mid because the page must also read as the same family as /w and /app, and motion is one signature scrub plus
supporting reveals, never decoration.
```

Motion honesty (FE-MOTION-HONESTY-01): band 4-5 needs at least one entrance; we ship the story scrub (signature),
flow-step progress and one-time block entrances (supporting), all off under reduced motion.

## Constraints that bind the design

- Color: hue budget = neutrals + red for failure. Pixel scenes use their own 4-step ramps, which are tinted
  neutrals in light mode and one navy family in dark mode (FE-ONENOTE-01 bounded-field exemption: one authored
  scene per viewport, structure carried by type and real UI).
- Contrast: all on-screen text >= 4.5:1, large >= 3:1, in every state. No opacity dimming of text.
- Proof: numbers come from SEOUL_STATS; quotes from live-seoul.json by seq; examples carry an EXAMPLE label.
- Logos: unaltered, >= 24 px, on a chip with >= 3:1 against the mark; disclaimer stays.

