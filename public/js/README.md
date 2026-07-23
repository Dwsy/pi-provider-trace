# Trace Web UI

无构建步骤、无 CDN、无前端框架。浏览器直接加载六个 ES Modules：

| 文件 | 职责 |
|---|---|
| `main.js` | 生命周期、EventSource、交互与局部刷新调度 |
| `api.js` | `/api/*` 与实时连接边界 |
| `model.js` | Session / Exchange / **Turn 树**（`buildSessionTree`）/ 工具结果关联 |
| `view.js` | 回合树 DOM、节点详情、generation wire 页签、实时 patch |
| `format.js` | 时间、成本、Token、JSON 格式化 |
| `i18n.js` | 中英文界面文案与 locale 持久化 |

## 信息架构

默认 **listMode = turns**：

```text
Session → Prompt (user input)
       → Turn #n
          → Generation (HTTP + stream_result)
          → Tool (args + contentText)
          → Message (role / text / thinking)
```

可切换 **requests** 回到纯 HTTP 请求账本（旧日志兼容）。

## 流式契约

`stream_update` 是文本/推理增量 patch 与当前工具状态，页面在内存折叠后通过 `requestAnimationFrame` 只更新当前输出；`stream_result` 是唯一持久化的最终流记录。前端不再保存或重放原始 SSE 行。

## 测试

```bash
node public/js/model.test.mjs
node public/js/tree.test.mjs
```
