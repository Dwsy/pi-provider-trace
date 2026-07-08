# Design — pi-provider-trace Web UI

Factory-inspired **instrument panel**: flat surfaces, accent only on data states.

## Implementation

| File | Role |
|------|------|
| `public/css/tokens.css` | `--canvas`, `--chrome`, `--card-*`, light/dark |
| `public/css/components.css` | Layout, `.panel-bone`, `.panel-stack` |
| `public/js/core/theme.js` | `data-theme` + `localStorage` `pi-trace-theme` |

## Themes

- **Dark:** `#101010` canvas, `#eeeeee` metric cards (`--card-bg`)
- **Light:** warm gray canvas, **white cards** (no inverted black slabs)
- Boot: inline script in `index.html` before CSS

## Components

- `.panel-bone` — metrics / stream assembled / usage tables
- `.panel-dark` — nested blocks (media, inline usage on stream)
- `.panel-stack` — vertical gap between cards (overview, usage, stream tabs)
- `.field-input` — score form inputs themed per mode

## Archive

[factory-style-reference-full.md](./factory-style-reference-full.md) — original Factory prompt excerpt.