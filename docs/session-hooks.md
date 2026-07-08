# Pi session hooks in pi-provider-trace

When `/trace on`, these Pi extension events are recorded as `pi_event` in the same JSONL as HTTP traces. On the **Timeline** tab they appear on the **Pi** lane (purple), interleaved with agent/turn/provider events by `ts`.

## Session file & lifecycle

| Event | When (Pi) | Trace `summary` / `detail` |
|--------|-----------|------------------------------|
| `session_start` | Startup, resume, fork, new | `reason` |
| `session_shutdown` | Quit, reload, switch, fork | `reason`, `targetSessionFile` |
| `session_before_switch` | Before `/new`, `/resume` | `reason`, `targetSessionFile` |
| `session_switch` | After switch | `reason`, `previousSessionFile` |
| `session_before_fork` | Before `/fork` | `entryId` |
| `session_fork` | After fork | `entryId`, new session path |
| `session_info_changed` | `/name`, display name | `name` |

## Tree navigation (`/tree`)

Branch summaries are generated when you move the leaf in the session tree.

| Event | When | Trace notes |
|--------|------|-------------|
| `session_before_tree` | Before navigate | `targetId`, `oldLeafId` from `preparation` — extensions may `cancel` or return custom `summary` |
| `session_tree` | After navigate | `newLeafId`, `oldLeafId`, `fromExtension`, `summaryEntry` presence |

**Reading the timeline:** `before_tree` → (optional LLM call for branch summary) → `tree` often aligns with extra `request`/`llm_usage` rows if Pi calls the model for summarization.

## Compaction (`/compact`, threshold, overflow)

| Event | When | Trace notes |
|--------|------|-------------|
| `session_before_compact` | Before compact | `reason`: `manual` \| `threshold` \| `overflow`; `tokensBefore`, `firstKeptEntryId`, `branchEntries` count, `willRetry` |
| `session_compact` | After compact saved | `compactionEntry` → `summaryPreview` (truncated), `tokensBefore`, `fromExtension` |

**Reading the timeline:** `before_compact` → provider HTTP (summary generation) → `compact done` → optional `willRetry` agent turn.

## Combined view (HTTP + Pi)

```
input → agent_start → turn_start → context
  → before_provider_request → HTTP request → SSE… → llm_usage
  → turn_end → tool_call …
session_before_tree → HTTP (branch summary?) → session_tree
session_before_compact → HTTP (compaction summary?) → session_compact
```

Filters in UI: **Pi** checkbox includes all `pi_event` rows (including tree/compact). Use exchange list for HTTP-only slices.

## Hooks not recorded

Extension handlers that only **return** `{ cancel, compaction, summary }` are not separate events—the **before_*** and ***_** pair plus HTTP trace show the outcome. `ctx.navigateTree()` from commands does not emit extra events beyond the normal agent loop unless Pi fires the same `session_before_tree` / `session_tree` pair for `/tree`.