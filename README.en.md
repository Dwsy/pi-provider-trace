# pi-provider-trace

Pi extension for **transparent LLM provider debugging**: raw HTTP + SSE wire capture, Pi agent lifecycle events, and normalized **usage / cost / cache hit rate**—all per Pi session.

Tracing is **off by default**. Enable it only when you need visibility.

## Why a hack (`globalThis.fetch` patch)?

Pi exposes **official extension events** that are great for billing, payload inspection, and session boundaries—but they are **not** equivalent to transparent **wire-level** debugging of LLM provider traffic. This extension targets DevTools/curl-style visibility: real URL/method/headers, response bodies, and **line-by-line SSE**, browsable per HTTP exchange in the Web UI.

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

`after_provider_response` is intentionally fired **before** the response stream is consumed—so official hooks cannot reproduce the **Stream SSE** tab (event types, deltas, reassembled text).

### Two-layer design

1. **Hack layer (opt-in via `/trace on`)**  
   Patches `globalThis.fetch`, tees response bodies, logs `request` / `response_meta` / `sse_line`, and folds provider usage from SSE into `llm_usage`. This is the practical way to get wire transparency while pi-ai uses global `fetch`.

2. **Official + extension events**  
   `before_provider_request` → `provider-payload.jsonl`; `message_end` / `turn_end` for Pi-side usage; turns, tools, tree/compact hooks → `pi_event`, merged on the timeline by timestamp.

**Payload + headers + per-turn usage only?** Use Pi’s `examples/extensions/provider-payload.ts`—no fetch patch required.  
**Full SSE / wire troubleshooting?** You need this extension’s hack layer—hence **default off** and explicit `/trace on` (patching `fetch` is invasive).

### Hack-layer limits

- Only traffic through **`globalThis.fetch`**; custom transports may be missed.
- Heuristic LLM URL filter (`trace-fetch.ts`).
- Same family of idea as `pi-model-selector-x` (runtime patch), but on the **network** layer, not TUI prototypes.

## Features

| Layer | What you get |
|--------|----------------|
| **HTTP (hack)** | Patches `globalThis.fetch`, tees response bodies, logs request/response/SSE lines without breaking pi-ai consumers |
| **Pi events** | Subscribes to extension lifecycle (input, turns, tools, `before_provider_request`, etc.) as `pi_event` |
| **Usage** | Parses provider SSE (Anthropic, OpenAI Responses/Completions, …) and Pi `message_end` / `turn_end` usage → `llm_usage` |
| **Web UI** | Configurable port (default **32211**), session history, timeline, usage, download/delete |
| **i18n** | Chinese / English in the UI |

## Requirements

- Pi coding agent with extension support (`@earendil-works/pi-coding-agent`)
- Extension enabled in `settings.json`:

```json
"+extensions/pi-provider-trace/index.ts"
```

Restart Pi after adding or changing the extension.

## Quick start

```text
/trace on          # start capture (bound to current Pi session)
/trace ui          # open http://127.0.0.1:32211/
/trace off         # stop capture (logs remain on disk)
/trace path        # show log root directory
```

## Slash commands

| Command | Description |
|---------|-------------|
| `/trace` | Status and help |
| `/trace on` | Enable fetch patch + Pi event logging |
| `/trace off` | Disable capture |
| `/trace ui` | Web UI (reuses server if already up) |
| `/trace port [n]` | Show or set UI port (persisted to `ui-config.json`) |
| `/trace path` | Log root under `getAgentDir()/provider-trace` |

## On-disk layout

```
~/.pi/agent/provider-trace/
  registry.json
  sessions/<sessionKey>/
    http-sse.jsonl
    provider-payload.jsonl
```

- **sessionKey**: Pi session file stem, or `cwd-…` without a session file.
- Auth headers are redacted in logs.

## Web UI port

Priority: runtime `/trace port N` (saved) → `~/.pi/agent/provider-trace/ui-config.json` → `PI_PROVIDER_TRACE_UI_PORT` → default **32211**.

## Web UI (`http://127.0.0.1:<port>/`)

- Sessions list (history from registry + `sessions/*`)
- HTTP exchanges per provider `fetch` id
- Tabs: Timeline, Stream SSE, Request, Response, Raw, Usage & cost
- Download JSONL / delete session traces
- Live SSE: `/api/stream?session=<key>`

## Trace record kinds

| `kind` | Source |
|--------|--------|
| `request` / `response_meta` / `sse_line` / `error` | HTTP fetch patch |
| `pi_event` | Pi extension lifecycle (incl. `/tree`, `/compact`, switch/fork) |
| `llm_usage` | SSE fold + `message_end` / `turn_end` |

**Cache hit rate:** `cacheRead / (input + cacheRead)`. Costs use pi-ai `usage.cost` when present.

## Limitations

- Captures traffic via **`globalThis.fetch`** only.
- Heuristic LLM URL filter in `trace-fetch.ts`.
- Configured port must be free (`EADDRINUSE` otherwise).
- UI is **127.0.0.1** only—logs may contain prompts; keep local.

## Module map

`index.ts` · `trace-fetch.ts` · `public/` (HTML/CSS/JS) · `web-ui.ts` · `web-ui-static.ts` · `logger.ts`
## Observability API

- `GET /api/metrics?session=` — trace + generation metrics (Langfuse-aligned)
- `GET/POST /api/scores?session=` — numeric scores
- `GET /api/media?session=&exchange=` — multimodal refs
- Architecture: `docs/observability-architecture.md`, `observability/processors/`


> **Langfuse production export**: future work, not in this release. Stub only — see `docs/future-langfuse.md`.

- Optional `PI_PROVIDER_TRACE_WRITE_OBSERVATION=1` for local `kind: observation` lines (not Langfuse export)


## Web UI

Static assets: `public/index.html`, `public/css/*`, `public/js/*` (ES modules, no npm). Theme: light / dark / system (`pi-trace-theme` in localStorage).
