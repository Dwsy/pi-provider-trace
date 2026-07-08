# pi-provider-trace

> English: [README.md](README.md)

默认关闭。`/trace on` 开启 fetch 抓包；`/trace ui` 打开可视化。

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

Pi 扩展已提供一批**官方事件**，适合记账、改 payload、会话边界，但**不能**等价于「对 LLM 供应商的透明抓包」。本扩展的目标是 **wire 级** 调试：真实 URL/方法/头、响应体与 **SSE 逐行**，并在 Web UI 里按单次 HTTP 交换浏览流式输出。

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

文档对 `after_provider_response` 的表述是：在**消费 stream 之前**记录 status 与 headers——因此**不可能**用官方 hook 复现本扩展「Stream SSE」页里的 event/delta 重组。

### 本扩展采用的双层设计

1. **Hack 层（默认 `/trace on` 才启用）**  
   Patch `globalThis.fetch`，对疑似 LLM 请求 `tee()` 响应体，写入 `request` / `response_meta` / `sse_line`，并在流结束后解析 provider usage → `llm_usage`。这是实现 **wire 透明度** 的唯一可靠路径（在 pi-ai 走全局 fetch 的前提下）。

2. **官方 + 扩展事件层**  
   同时订阅 `before_provider_request`（另存 `provider-payload.jsonl`）、`message_end` / `turn_end`（Pi 侧 usage/cost）、以及 turn/tool/session 树与压缩等 → `pi_event`，与 HTTP 记录按时间戳在同一时间线叠加。

若你只需要「payload 落盘 + 响应头 + 每轮用量」，可参考 pi 自带的 `examples/extensions/provider-payload.ts`，**不必**开启 fetch patch。  
若你需要 **和浏览器 DevTools / curl 同级别的 SSE 排障**，则需要本扩展的 hack 层——这也是默认 **关闭**、仅 `/trace on` 开启的原因：全局改 `fetch` 有侵入性，应显式 opt-in。

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

## 命令

| 命令 | 说明 |
|------|------|
| `pi --trace` | CLI：启动时等同 `/trace on`（抓包 + Web UI） |
| `/trace on` | 抓包 + 启动 Web UI（**不**自动打开浏览器，通知里给 URL） |
| `/trace ui` | 仅启动 Web UI（不自动开浏览器） |
| `/trace off` | 关闭抓包 |
| `/trace path` | 日志根目录 |

## Web UI

**Design:** Factory（`docs/design/factory-style-reference.md`）— 深黑画布 + Bone 亮卡，无渐变 hero。

前端为 BS 多文件架构：`public/index.html`、`public/css/*`、`public/js/*`（ES modules，无 npm）；详见 `public/js/README.md`。服务端 `web-ui.ts` 提供静态资源与 `/api/*`（i18n、provider-icons、sessions、stream 等）。

- **三栏**：Pi 会话列表 → HTTP 交换 → 详情（流式 / 请求 / 响应 / 原始）
- **i18n**：未手动选择时，中国大陆时区或浏览器 `zh*` 语言 → 中文，否则英文；右上角可切换（`pi-trace-locale`）
- **时间线** tab：Pi 扩展事件（`pi_event`）与 HTTP 记录按 `ts` 叠加；默认不展开每条 SSE，可勾选
- SSE 解析：事件类型、delta 拼接预览
- 实时流按所选会话过滤；切换会话会重载该会话 JSONL 历史

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

启动 UI 后会扫描 `sessions/*` 与 `registry.json`，左侧列出**全部历史会话**；可下载 `http-sse.jsonl` / `provider-payload.jsonl`，或删除该会话轨迹目录。

重启 pi 后生效。

## Observability / 可观测性

- **Processors → Sinks**：`src/observability/`（`derive-metrics` 读路径聚合，非 fetch 热路径）
- `GET /api/metrics?session=` · `GET/POST /api/scores` · `GET /api/media`
- 详见 `docs/observability-architecture.md`

> **Langfuse 生产导出**：后续拓展，本期不开发。预留 `src/observability/sinks/langfuse.ts` 桩，见 `docs/future-langfuse.md`。

- 可选 `PI_PROVIDER_TRACE_WRITE_OBSERVATION=1`：JSONL 追加 `kind: observation`（本地，非 Langfuse）