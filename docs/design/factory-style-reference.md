# Design — pi-provider-trace Web UI

开发者观测台，不是营销 Dashboard。视觉服从一次模型请求的因果链与证据密度。

## 信息架构

- 桌面：Session ledger → Request ledger → Evidence inspector。
- 移动：相同路径按 Sessions / Requests / Inspector 单面板推进。
- Inspector 默认显示 Pi Context → HTTP → Model Stream → Tool Calls；Input / Output / Timeline / Raw 是证据切面。

## 视觉约束

- 冷中性色为底，唯一产品强调色为低饱和青绿；红色与琥珀色只表达错误/警告。
- 主要分组依赖 1px 分隔线和负空间，不使用等大卡片矩阵、渐变 Hero、外发光或毛玻璃装饰。
- 普通界面使用高可读无衬线字体；ID、URL、时间、成本、Token、JSON 使用等宽字体。
- 浅色/深色共用语义 token；`prefers-reduced-motion` 禁用非必要动画。

## 性能约束

- 无 CDN、无框架、无构建步骤；一份 CSS + 六个 ES Modules。
- `stream_update` 只传文本/推理增量与当前工具状态；Logger/页面各自在内存折叠，`requestAnimationFrame` 只 patch 当前输出和工具参数。
- 请求列表最多渲染 300 条匹配项；历史 API 在服务端折叠旧 `sse_line`。
- 搜索 100ms 防抖，EventSource 按 session 服务端过滤。

## Archive

[factory-style-reference-full.md](./factory-style-reference-full.md) — original Factory prompt excerpt.
