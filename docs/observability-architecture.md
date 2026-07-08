# 可观测性架构（Langfuse 对齐）

原则：**LLM wire + Pi 事件 = 事实源**；指标/UI/导出 = **processors + sinks**。

## Langfuse 指标对照

| 层级 | 性能 | 用量 | 成本 | 其他 |
|------|------|------|------|------|
| **Observation** | latency, TTFT, streamingLatency, tokens/s | input/output/total tokens | input/output/total cost | count |
| **Trace** | 聚合 latency | sum tokens | sum cost | error/warning/debug counts, scores |
| **Score** | — | — | — | numeric / categorical |

本仓已有：tokens、cost、cache；`derive-metrics.ts` 补 **latency / TTFT / TPS**；trace rollup 补 **generationCount / errorCount**。

## 三层

1. **Sources** — `trace-fetch`, `pi-events`, `provider-payload.jsonl`
2. **Processors** — `usage-metrics`, `derive-metrics`, 未来 media/scores
3. **Sinks** — JSONL, Web UI；（**Langfuse 生产连接 = 后续拓展，本期不开发**，见 `docs/future-langfuse.md`）

## API

- `GET /api/metrics?session=<key>` → `{ trace: TraceMetrics, generations: { id, metrics }[] }`

## 扩展

- Provider 插件：`observability/providers/<id>.ts`
- 媒体预览：从 multimodal payload 抽 `MediaRef`
- Exporter：`observability/sinks/langfuse.ts`（**仅桩，非本期**）→ `docs/future-langfuse.md`

DeepWiki：`dw aq -r langfuse/langfuse -q "trace aggregation metrics"`

Fern：`metrics.yml`, `trace.yml` on langfuse/langfuse main.


## Langfuse 完整指标对照（观测级）

| 类别 | 指标 |
|------|------|
| 性能 | latency, streamingLatency, timeToFirstToken, tokensPerSecond, outputTokensPerSecond |
| 用量 | inputTokens, outputTokens, totalTokens |
| 成本 | inputCost, outputCost, totalCost |
| 计数 | count (generations), countScores |

## Trace 级聚合

latency（首尾时间）、sum(tokens/cost)、errorCount/spanCount/eventCount、scores（`/api/scores`）。

## 已实现 API

- `/api/metrics` — 读路径 rollup
- `/api/scores` — M7
- `/api/media` — M4
- UI：Trace 总览 tab、exchange TTFT/latency 徽章

## 可选导出

**后续：** 生产 Langfuse 见 `docs/future-langfuse.md`（本期不配置 env、不自动上报）
