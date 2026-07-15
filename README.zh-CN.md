# pi-provider-trace

> English: [README.md](README.md)

默认关闭。`/trace on` 开启 Provider 请求追踪；`/trace ui` 打开开发者观测台。

## 安装

需已安装 [Pi](https://pi.dev)：

```bash
npm install -g @earendil-works/pi-coding-agent
```

安装本扩展（npm，推荐）：

```bash
pi install npm:pi-provider-trace
```

或 Git：

```bash
pi install git:github.com/Dwsy/pi-provider-trace
```

若未自动启用，在 `~/.pi/agent/settings.json` 增加：

```json
"+extensions/pi-provider-trace/src/index.ts"
```

修改后**重启 pi**。

## 为什么需要 hack（patch `globalThis.fetch`）

Pi 扩展已提供一批**官方事件**，适合记账、改 payload、会话边界，但**不能**观察 Provider 返回的响应流。本扩展补足真实 URL/方法/响应头、TTFT、实时增量、最终文本/推理和工具参数，并把它们与 Pi 会话及工具生命周期联动。

### 官方能力 vs 本扩展目标

| 能力 | Pi 官方 hook | 仅官方能否满足 |
|------|----------------|----------------|
| 发给模型的**逻辑 payload** | `before_provider_request`（可序列化、可改写） | ✅ 足够做 payload 日志 |
| **HTTP 状态 + 响应头**（读流之前） | `after_provider_response` | ✅ 仅有 meta，**无 body** |
| **SSE / 流式 body 逐行** | ❌ 无（流由 pi-ai 消费，hook 拿不到） | ❌ |
| **原始 request**（与代理/baseUrl 一致） | ❌ 无（只有 payload 对象，不是线上字节） | ❌ |
| 回合结束 **token / cost / timing** | `message_end` | ✅ 账单向够用，**不能**替代抓包 |
| 会话起止 | `session_start` / `session_shutdown` | ✅ 边界信息 |
| turn / tool / `/tree` / `/compact` 时间线 | 需额外订阅多类 `pi.on` | ⚠️ 与 HTTP 无统一 exchange id |

文档对 `after_provider_response` 的表述是：在**消费 stream 之前**记录 status 与 headers——因此**不可能**用官方 hook 复现本扩展的实时增量、TTFT、完成文本、推理内容与工具参数。

### 本扩展采用的双层设计

1. **Hack 层（默认 `/trace on` 才启用）**  
   Patch `globalThis.fetch`，对疑似 LLM 请求 `tee()` 响应体。Provider 行被归并为节流的 `stream_update` 增量 patch，并在内存中折叠成当前快照；流结束只写一条 `stream_result`。Usage 同样增量折叠，不保留原始 SSE 行。

2. **官方 + 扩展事件层**  
   同时订阅 `before_provider_request`（另存 `provider-payload.jsonl`）、`message_end` / `turn_end`（Pi 侧 usage/cost）、以及 turn/tool/session 树与压缩等 → `pi_event`，与 HTTP 记录按时间戳在同一时间线叠加。

若你只需要「payload 落盘 + 响应头 + 每轮用量」，可参考 pi 自带的 `examples/extensions/provider-payload.ts`，**不必**开启 fetch patch。  
若你需要 **实时 Provider 流、TTFT 与完成结果排障**，则需要本扩展的 hack 层——这也是默认 **关闭**、仅 `/trace on` 开启的原因：全局改 `fetch` 有侵入性，应显式 opt-in。

### 局限（hack 层）

- 只捕获走 **`globalThis.fetch`** 的流量；自定义 transport 可能漏抓。
- URL 过滤为启发式（见 `trace-fetch.ts`），非主流 `baseUrl` 需自行扩展规则。
- 与 `pi-model-selector-x` 同类思路（运行时 patch），但挂在**网络层**而非 TUI。

## 按 Pi 会话分文件

```
~/.pi/provider-trace/
  registry.json
  sessions/<sessionKey>/
    http-sse.jsonl
    provider-payload.jsonl
```

`sessionKey` 来自当前 session 文件名（无 session 时用 `cwd-…`）。

### 写盘策略（瞬时流 → 单条最终结果）

- `stream_update`：文本/推理增量 patch 加当前工具状态，最多每 50ms 推送一次；Logger 在内存中折叠为当前完整快照，绝不落盘。
- `stream_result`：响应流正常结束时只写一条；读取失败时也只写一条 `state: error` 的部分结果。
- `request` / `response_meta` / `pi_event` / `llm_usage` / `error` 仍作为低频事实写入 JSONL。
- 旧日志若含 `sse_line`，历史 API 会在服务端先折叠为一条兼容结果，不会再把数千行发给浏览器。

Logger 对新 `stream_update` 和旧 `sse_line` 都明确禁止落盘，因此不存在逐 token 或逐 SSE 行写盘路径。

## 命令

| 命令 | 说明 |
|------|------|
| `pi --trace` | CLI：启动时等同 `/trace on`（抓包 + Web UI） |
| `/trace on` | 抓包 + 启动 Web UI（**不**自动打开浏览器，通知里给 URL） |
| `/trace ui` | 仅启动 Web UI（不自动开浏览器） |
| `/trace off` | 关闭抓包 |
| `/trace path` | 日志根目录 |

## Web UI

前端是面向开发者的零构建观测台：中性浅色/深色、单一青绿色状态色、线性证据区，不依赖 CDN 或前端框架。运行时只有一份 CSS 和六个原生 ES Modules，详见 `public/js/README.md`。

- 桌面路径：Pi 会话 → 模型请求账本 → 证据检查器；移动端按同一路径单面板浏览。
- 默认“联动”视图：Pi 输入/上下文 → HTTP 边界 → TTFT/累计模型流 → 工具调用/结果。
- 证据页签：联动、输入、请求头、响应、输出、时间线、原始。
- “输入”先结构化展示生成参数（temperature、top_p、token 上限等）、可用工具定义/Schema、历史工具调用与结果，原始 Payload 保留在末尾。
- 全局搜索覆盖会话、endpoint/model、payload、最终输出与工具参数。
- 浅色/深色主题、`prefers-reduced-motion`、加载/空/错状态。
- 桌面三栏支持拖动调宽和独立折叠；窄屏自动切为单面板，避免检查器被挤出视口。
- 会话支持批量选择、合并导出 JSONL 与并发批量删除；批量删除仍需显式确认。
- 工具调用在流中增量归并，并从后续请求 payload 关联 tool result。

## 用量 / 成本 / 缓存率

- **SSE 结束**：从 provider 流解析（Anthropic `message_*`、OpenAI `usage` / `response.completed` 等）→ `kind: llm_usage`
- **Pi 侧**：`message_end` / `turn_end` 的 `message.usage`（pi-ai 已算 `cost`）→ 同 exchange id 的 `llm_usage`
- **缓存命中率**：`cacheRead / (input + cacheRead)`
- Web UI：**用量** tab + 流式页顶部表 + 交换列表 `$` / `%` 徽章

## Pi 事件（独立于 HTTP）

`/trace on` 后订阅 agent/turn/tool/message/provider 等事件，写入同一 JSONL，`kind: "pi_event"`。

**会话结构 hook**（与 HTTP 时间线叠加）：`session_before_switch` / `session_switch`、`session_before_fork` / `session_fork`、`session_before_tree` / `session_tree`（`/tree` 分支与总结）、`session_before_compact` / `session_compact`（压缩/总结）、`session_info_changed`。详见 `docs/session-hooks.md`。可观测性扩展（Langfuse 对齐指标、processors/sinks）：`docs/observability-architecture.md`，`GET /api/metrics?session=`。时间线可单独勾选「会话/树/压缩」。

Web UI 默认端口 **32211**，可配置：

- `/trace port` 查看
- `/trace port 33000` 写入 `~/.pi/provider-trace/ui-config.json`
- 环境变量 `PI_PROVIDER_TRACE_UI_PORT`（未写文件时）

`http://127.0.0.1:<port>/`（多次 `/trace ui` 复用同一服务；改端口后下次 `ui` 会换监听）。

启动 UI 后会扫描 `sessions/*` 与 `registry.json`，左侧列出**全部历史会话**；可单独或批量下载/删除会话轨迹，批量导出按文件流合并，不会一次性把全部日志读入内存。

重启 pi 后生效。

## Observability / 可观测性

- **Processors → Sinks**：`src/observability/`（`derive-metrics` 读路径聚合，非 fetch 热路径）
- `GET /api/metrics?session=` · `GET/POST /api/scores` · `GET /api/media`
- 详见 `docs/observability-architecture.md`

> **Langfuse 生产导出**：后续拓展，本期不开发。预留 `src/observability/sinks/langfuse.ts` 桩，见 `docs/future-langfuse.md`。

- 可选 `PI_PROVIDER_TRACE_WRITE_OBSERVATION=1`：JSONL 追加 `kind: observation`（本地，非 Langfuse）
