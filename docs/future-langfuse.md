# 后续拓展：连接生产 Langfuse

**本期不开发、不自动上报。** Pi 侧仅本地可观测；Langfuse 为独立后续 PDCA。

## 本期（已完成）

- JSONL + Web UI + `/api/metrics` / scores / media
- 指标模型对齐 Langfuse（`observability/types.ts`）
- `sinks/langfuse.ts` **桩** + mock 单测（不连生产）
- 可选 `PI_PROVIDER_TRACE_WRITE_OBSERVATION=1` → JSONL 双写 `kind: observation`（本地，非 Langfuse）

## 明确不在本期

- 配置生产 `LANGFUSE_*` 并自动 `POST /api/public/ingestion`
- `/trace on` 触发远端 sink
- 与 Langfuse Cloud 项目联调验收

## 后续实现清单（新 work/ issue）

| # | 项 |
|---|-----|
| 1 | opt-in `LangfuseSink` 挂在 processors 管道末尾 |
| 2 | `sessionKey` → traceId；exchange → generation observation |
| 3 | 批量 ingestion + 重试/降级（失败仍保留 JSONL） |
| 4 | env：`LANGFUSE_HOST`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` |
| 5 | 不上传原始 SSE（与 hack 层策略一致），metrics + payload 摘要 |
| 6 | staging 项目 E2E 验收 |

## 参考

- `docs/observability-architecture.md`
- DeepWiki `langfuse/langfuse` Public API / ingestion
- 预留代码：`observability/sinks/langfuse.ts`
