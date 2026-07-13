# pi-provider-trace

Pi extension for **transparent LLM provider debugging**: real HTTP metadata, memory-only live stream snapshots, one durable final result, Pi lifecycle events, and normalized **usage / cost / cache hit rate**—all per Pi session.

Tracing is **off by default**. Enable it only when you need visibility.

## Why a hack (`globalThis.fetch` patch)?

Pi exposes **official extension events** that are great for billing, payload inspection, and session boundaries—but they are **not** equivalent to observing the provider response stream. This extension targets DevTools-style visibility: real URL/method/headers, live deltas, and the completed model result, linked to the Pi session and tool lifecycle.

### Official hooks vs this extension

| Capability | Pi official | Enough without fetch patch? |
|------------|-------------|-----------------------------|
| Logical **request payload** | `before_provider_request` | ✅ Payload logging / rewrite |
| **Status + response headers** (before stream read) | `after_provider_response` | ✅ Meta only—**no body** |
| **SSE / streaming body** | ❌ Not exposed (pi-ai consumes the stream) | ❌ |
| **Raw HTTP request** (as on the wire / via proxy) | ❌ Only serialized payload object | ❌ |
| **Tokens / cost / timing** per assistant message | `message_end` | ✅ For accounting—not a packet trace |
| Session boundaries | `session_start` / `session_shutdown` | ✅ |
| Timeline (turns, tools, `/tree`, `/compact`) | Many separate `pi.on` events | ⚠️ No shared exchange id with HTTP |

`after_provider_response` is intentionally fired **before** the response stream is consumed—so official hooks cannot reproduce live deltas, TTFT, completed text, reasoning, or streamed tool arguments.

### Two-layer design

1. **Hack layer (opt-in via `/trace on` or `pi --trace`)**  
   Patches `globalThis.fetch` and tees response bodies. Provider rows are reduced into throttled `stream_update` patches and folded into a current in-memory snapshot; the completed generation is written once as `stream_result`. Usage is folded incrementally into `llm_usage` without retaining raw SSE rows.

2. **Official + extension events**  
   `before_provider_request` → `provider-payload.jsonl`; `message_end` / `turn_end` for Pi-side usage; turns, tools, tree/compact hooks → `pi_event`, merged on the timeline by timestamp.

**Payload + headers + per-turn usage only?** Use Pi’s `examples/extensions/provider-payload.ts`—no fetch patch required.  
**Live provider-stream troubleshooting?** You need this extension’s hack layer—hence **default off** and explicit `/trace on` (patching `fetch` is invasive).

### Hack-layer limits

- Only traffic through **`globalThis.fetch`**; custom transports may be missed.
- Heuristic LLM URL filter (`trace-fetch.ts`).
- Same family of idea as `pi-model-selector-x` (runtime patch), but on the **network** layer, not TUI prototypes.

## Features

| Layer | What you get |
|--------|----------------|
| **HTTP (hack)** | Patches `globalThis.fetch`, tees response bodies, publishes cumulative live snapshots, and persists one completed stream result |
| **Pi events** | Subscribes to extension lifecycle (input, turns, tools, `before_provider_request`, session tree/compact/switch/fork, etc.) as `pi_event` |
| **Usage** | Parses provider SSE (Anthropic, OpenAI Responses/Completions, …) and Pi `message_end` / `turn_end` usage → `llm_usage` |
| **Web UI** | Zero-build developer workbench (`public/`), configurable port (default **32211**), global search, linked request flow, timeline, usage, download/delete |
| **i18n** | Auto **zh** (China TZ or `zh` browser lang), else **en**; manual override in UI (`pi-trace-locale`) |

## Requirements

- [Pi](https://pi.dev) coding agent (`@earendil-works/pi-coding-agent`)

```bash
npm install -g @earendil-works/pi-coding-agent
```

## Installation

**npm (recommended):**

```bash
pi install npm:pi-provider-trace
```

**Git:**

```bash
pi install git:github.com/Dwsy/pi-provider-trace
```

If the extension is not auto-enabled, add to `~/.pi/agent/settings.json`:

```json
"+extensions/pi-provider-trace/src/index.ts"
```

Restart Pi after install or settings change.

## Quick start

```text
pi --trace           # CLI: same as /trace on at session start (skip in --mode rpc)
/trace on            # start capture (bound to current Pi session)
/trace ui            # open http://127.0.0.1:32211/
/trace off           # stop capture (logs remain on disk)
/trace path          # show log root directory
```

## Slash commands

| Command | Description |
|---------|-------------|
| `/trace` | Status and help |
| `pi --trace` | Enable tracing when Pi starts + start Web UI (no auto browser) |
| `/trace on` | Enable capture + start Web UI (prints URL; does not open browser) |
| `/trace off` | Disable capture |
| `/trace ui` | Start Web UI (reuses server; does not open browser) |
| `/trace port [n]` | Show or set UI port (persisted to `ui-config.json`) |
| `/trace path` | Log root `~/.pi/provider-trace` |

## On-disk layout

```
~/.pi/provider-trace/
  registry.json
  sessions/<sessionKey>/
    http-sse.jsonl
    provider-payload.jsonl
```

- **sessionKey**: Pi session file stem, or `cwd-…` without a session file.
- Auth headers are redacted in logs.

### Write path (transient stream → one durable result)

- `stream_update`: throttled text/reasoning patch plus current tool-call state, at most one browser update per 50 ms. The logger folds patches into one in-memory snapshot for reconnects.
- `stream_result`: written once when the response body completes (or once with `state: error` on stream failure).
- `request`, `response_meta`, `pi_event`, `llm_usage`, and `error` remain durable facts in JSONL.
- Legacy logs containing `sse_line` remain readable: the history API compacts those rows into one synthesized result before sending them to the browser.

The logger explicitly refuses to persist both new `stream_update` and legacy `sse_line` records. There is no per-token or per-row disk write path.

## Web UI port

Priority: runtime `/trace port N` (saved) → `~/.pi/provider-trace/ui-config.json` → `PI_PROVIDER_TRACE_UI_PORT` → default **32211**.

## Web UI (`http://127.0.0.1:<port>/`)

**Design:** compact developer instrument with neutral light/dark themes, one restrained teal accent, linear evidence sections, and no external frontend runtime or CDN. Static assets: one CSS file plus six ES Modules; see `public/js/README.md`.

- Desktop: Pi sessions → model request ledger → evidence inspector; mobile: the same path as one panel at a time.
- Primary **Flow** view links Pi input/context → HTTP boundary → TTFT/live result → tool calls/results.
- Evidence tabs: Flow, Input, Output, Timeline, Raw.
- Input first exposes generation settings, available tool schemas, and historical tool calls/results as structured evidence; the raw provider payload remains available below.
- Global search across sessions, endpoint/model, payload, final output, and tool arguments.
- Theme: light / dark (`pi-trace-theme` in localStorage); reduced-motion support.
- Desktop side panes are resizable and independently collapsible; narrow screens switch to one-pane navigation without horizontal clipping.
- JSON blocks use native rendering and copy actions; no syntax-highlighting dependency.
- Batch-select sessions for one streamed JSONL export or confirmed concurrent deletion.
- Live updates: `/api/stream?session=<key>` (history via `/api/history`)
- Structured tool calls are accumulated while streaming; matching results are linked from later request payloads.

## Trace record kinds

| `kind` | Source |
|--------|--------|
| `request` / `response_meta` / `stream_result` / `error` | Durable HTTP fetch facts |
| `stream_update` | Live-only stream patch, folded into an in-memory current snapshot (never written to JSONL) |
| `pi_event` | Pi extension lifecycle (incl. `/tree`, `/compact`, switch/fork) |
| `llm_usage` | SSE fold + `message_end` / `turn_end` |

**Cache hit rate:** `cacheRead / (input + cacheRead)`. Costs use pi-ai `usage.cost` when present.

## Limitations

- Captures traffic via **`globalThis.fetch`** only.
- Heuristic LLM URL filter in `trace-fetch.ts`.
- If the configured port is taken by **another** Trace Web UI instance, `/trace ui` reuses it (health check on `GET /api/status`). Otherwise configure another port (`EADDRINUSE`).
- UI is **127.0.0.1** only—logs may contain prompts; keep local.

## Module map

`src/index.ts` · `src/trace-fetch.ts` · `public/` (HTML/CSS/JS) · `src/web-ui.ts` · `src/logger.ts`

## Observability API

- `GET /api/metrics?session=` — trace + generation metrics (Langfuse-aligned fields, local only)
- `GET/POST /api/scores?session=` — numeric scores
- `GET /api/media?session=&exchange=` — multimodal refs
- Architecture: `docs/observability-architecture.md`, `src/observability/processors/`

> **Langfuse production export**: future work, not in this release. Stub only — see `docs/future-langfuse.md`.

- Optional `PI_PROVIDER_TRACE_WRITE_OBSERVATION=1` for local `kind: observation` lines (not Langfuse export)
