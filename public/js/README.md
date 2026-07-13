# Trace Web UI

无构建步骤、无 CDN、无前端框架。浏览器直接加载六个 ES Modules：

| 文件 | 职责 |
|---|---|
| `main.js` | 生命周期、EventSource、交互与局部刷新调度 |
| `api.js` | `/api/*` 与实时连接边界 |
| `model.js` | Session / Exchange / Stream 派生模型与工具结果关联 |
| `view.js` | DOM 渲染、实时输出局部 patch、空/错/加载状态 |
| `format.js` | 时间、成本、Token、JSON 格式化 |
| `i18n.js` | 中英文界面文案与 locale 持久化 |

流式契约：`stream_update` 是文本/推理增量 patch 与当前工具状态，页面在内存折叠后通过 `requestAnimationFrame` 只更新当前输出；`stream_result` 是唯一持久化的最终流记录。前端不再保存或重放原始 SSE 行。
