# Factory — Full Style Reference (archive)

Source: design language prompt for pi-provider-trace Web UI.  
**Implementation SSOT for code:** `factory-style-reference.md` + `public/css/tokens.css`.

---

# Factory — Style Reference
> Terminal war room at midnight. Factory is a stark black control surface where a single white card lands like a flashlit dispatch — the only object in the room is the work itself.

**Theme:** dark

Factory operates as a terminal war room: deep black canvas, weight-400 Geist type pressed tight with negative tracking, and generous negative space that lets two functional accents — signal orange and metric green — speak above the noise. The signature move is the light card floating on near-black ground (#eeeeee panels on #101010 canvas), creating stark figure/ground contrast rather than soft elevation.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Obsidian Canvas | `#101010` | `--color-obsidian-canvas` | Page background |
| Carbon Lift | `#1d1a18` | `--color-carbon-lift` | Raised dark surfaces |
| Ash Stroke | `#3d3a39` | `--color-ash-stroke` | Hairline borders |
| Warm Granite | `#8a8380` | `--color-warm-granite` | Muted body text |
| Pale Stone | `#b8b3b0` | `--color-pale-stone` | Eyebrows / labels |
| Bone | `#eeeeee` | `--color-bone` | Light cards, primary text on dark |
| Chalk | `#fafafa` | `--color-chalk` | Elevated neutral |
| Signal Orange | `#ee6018` | `--color-signal-orange` | Live / status / data signal |
| Metric Green | `#a0ca92` | `--color-metric-green` | Positive metrics |

## Typography

- **Geist** 400 (500 only for rare emphasis) — `--font-geist`
- **Geist Mono** 12px uppercase captions — `--font-geist-mono`

## Components (abridged)

- Light Surface Card: `#eeeeee`, 10px radius, 24px padding, no shadow
- Metric Tile: 1px `#1d1a18` divider, mono label, large value
- Buttons: `#1f1d1c` fill or ghost `#3d3a39` border, 3px radius
- No drop shadows; depth = contrast + spacing

## Do's and Don'ts

See conversation / original prompt for motion, layout, agent prompts, and Tailwind `@theme` block.

## pi-provider-trace mapping

| Factory | Trace UI |
|---------|----------|
| Light Surface Card | `.panel-bone` (overview, stream assembled, usage tables) |
| Feature card border | `.panel-dark` (inline usage on stream tab, media box) |
| Status Pulse | `.pill.on::before` orange dot |
| Metric green/orange | `.badge.ok` / `.badge.sse` |

