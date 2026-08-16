# `/api/overview` contract

Frozen interface for the cross-session overview. Backend and frontend are built
against this document in parallel; neither side changes it unilaterally.

## Why

Today the workbench answers "what happened in this session". It cannot answer
"which model is burning the budget", "did latency regress this week", or "which
sessions are failing" without opening sessions one at a time. `/api/overview`
folds the same durable JSONL facts across sessions so those questions have a
single, cheap answer.

## Request

```
GET /api/overview?window=24h|7d|30d|all&limit=<n>
```

- `window` defaults to `7d`. An unrecognised value is `400`, never a silent
  fallback.
- `limit` caps `sessions[]` (default 50, max 500). `totals`, `models`,
  `providers`, and `timeline` always cover the whole window regardless of
  `limit`.
- Sessions are included when their newest record falls inside the window.

## Response

```ts
interface OverviewResponse {
  generatedAt: string;              // ISO
  window: "24h" | "7d" | "30d" | "all";
  windowStart: string | null;       // ISO; null when window is "all"
  scanned: {
    sessions: number;               // session dirs considered
    included: number;               // sessions inside the window
    bytes: number;                  // JSONL bytes read
    truncated: boolean;             // true when a per-session byte cap was hit
    durationMs: number;
  };
  totals: OverviewTotals;
  sessions: OverviewSession[];      // newest first, length <= limit
  models: OverviewModel[];          // descending totalCost, then totalTokens
  providers: OverviewProvider[];    // descending totalCost, then totalTokens
  timeline: OverviewBucket[];       // ascending, gap-filled
}

interface OverviewTotals {
  generations: number;              // exchanges with a usage record
  exchanges: number;                // exchanges with a request record
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  /** cacheRead / (input + cacheRead); 0 when there is no prompt traffic. */
  cacheHitRate: number;
  /** null when no exchange produced the measurement. */
  avgTtftMs: number | null;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  /** output tokens / streaming seconds, averaged over exchanges that streamed. */
  avgOutputTps: number | null;
}

interface OverviewSession {
  key: string;
  label: string;
  lastTs: string;
  generations: number;
  errors: number;
  totalTokens: number;
  totalCost: number;
  avgTtftMs: number | null;
  avgLatencyMs: number | null;
  models: string[];                 // distinct `provider/model`, first-seen order
}

interface OverviewModel {
  key: string;                      // `provider/model`
  provider: string;
  model: string;
  generations: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  totalCost: number;
  avgTtftMs: number | null;
  p95TtftMs: number | null;
  avgOutputTps: number | null;
  sessions: number;
}

interface OverviewProvider {
  provider: string;
  generations: number;
  errors: number;
  totalTokens: number;
  totalCost: number;
  avgTtftMs: number | null;
  sessions: number;
  models: number;
}

interface OverviewBucket {
  /** ISO start of the bucket. Hourly for 24h, daily otherwise. */
  bucket: string;
  generations: number;
  errors: number;
  totalTokens: number;
  totalCost: number;
  avgTtftMs: number | null;
}
```

## Derivation

Reuses the existing folds — no new capture path, no JSONL format change.

- Exchanges come from `foldExchangeFromRecords`; per-exchange numbers come from
  `deriveGenerationMetrics`. Legacy `sse_line` logs are compacted first through
  `compactLegacySseRecords`, exactly as `/api/history` does.
- Model identity is read from the `llm_usage` record's model/provider fields,
  falling back to the request URL host when the provider is absent. Exchanges
  with no resolvable model are grouped under `unknown` rather than dropped.
- Percentiles use nearest-rank on the sorted sample. A metric with an empty
  sample is `null`, never `0`.
- Averages are unweighted per exchange, matching `rollupObservationMetrics`.
- Reading is bounded: at most 8 MiB tail per session log, mirroring `tailJsonl`.
  Hitting the cap sets `scanned.truncated`.

## Errors

`{ "error": string }` with `400` for a bad `window` or `limit`, `500` for an
unexpected read failure. A single unreadable session log is skipped and counted
in `scanned.sessions` without failing the request.

## Frontend expectations

- The overview is a distinct top-level surface, reachable from the topbar and
  from the empty state, not a fourth column in the workbench.
- Selecting a session row navigates into the existing workbench with that
  session selected.
- Every string is added to both locales in `public/js/i18n.js`.
- `null` metrics render as an em dash with a title explaining the sample was
  empty — never as `0 ms`.
- Charts stay inline SVG. No new dependency, no CDN.
