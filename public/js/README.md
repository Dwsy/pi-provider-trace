# Trace Web UI（原生多文件）

无 npm、无构建。浏览器 **ES modules** + 自研小组件。

## 目录

| 路径 | 职责 |
|------|------|
| `main.js` | 入口 |
| `shell/app.js` | 启动、事件绑定、会话切换 |
| `shell/stream.js` | EventSource |
| `core/` | state, dom, i18n |
| `data/` | store, ingest, api |
| `lib/` | format, provider, sse, usage |
| `components/` | Empty, Badge, UsageTable, TabBar |
| `views/` | session-list, exchange-list, exchange-panel, overview, timeline |

## CSS

`public/css/` — tokens, base, components（原 `styles.css` 拆分）

## 兼容

旧单文件 `app.js` 已弃用，由 `/js/main.js` 替代。

## Theme

`core/theme.js` + `css/tokens.css` (`data-theme=light|dark`). Preference: `pi-trace-theme`.

## Design

Factory style: `docs/design/factory-style-reference.md`, `public/css/tokens.css`.
