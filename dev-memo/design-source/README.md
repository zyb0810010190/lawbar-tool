# Lawbar Case Box — 设计源 CSS / Design Source CSS

八个可读、未压缩、未打包的 `.css` 源文件 — Lawbar Case Box 视觉强化通道的完整样式源。
Eight human-readable, un-minified, un-bundled `.css` source files — the complete stylesheet source for the Lawbar Case Box visual-hardening lane.

## 加载顺序 / Load order

按下列顺序引入(后者覆盖前者):
Load in this order (later files override earlier ones):

1. `editorial-tokens.css`
2. `editorial-styles.css`
3. `desktop-shell.css`
4. `cn-overlay.css`
5. `v08-additions.css`
6. `v11-auth.css`
7. `v12-typography.css`
8. `v13-mark.css`

## 文件出处 / Provenance — 各文件来自哪个版本

| 文件 / File | 来源版本 / Source version | 内容 / Contents |
|---|---|---|
| `editorial-tokens.css` | v0.2 (editorial direction) | `:root` 调色板 + 字号 / 间距 / 半径 / 阴影令牌,含 `[data-theme="dark"]` |
| `editorial-styles.css` | v0.2 (editorial direction) | 排印基础 + 组件规则(按钮 / 表单 / 表格 / 卡片 / pill / colophon) |
| `desktop-shell.css` | v0.3 (desktop shell) | 桌面应用壳层 — titlebar · sidebar · status-bar · main 区域 |
| `cn-overlay.css` | v0.4 (简体中文方向) | CJK 字体栈 + 字号调整 + `em` → 下划线强调(替代斜体) |
| `v08-additions.css` | v0.8 (12-screen build) | 三类台账 / 详情 / 上传 sheet / 文件行 / 待办日程 / 归档 / 工作台 |
| `v11-auth.css` | v0.11 (auth pages) | 登录 / 注册 / 重置密码 / 微信小程序登录 |
| `v12-typography.css` | v0.12 (typography refine) | 标题↔正文同栏对齐修复(须在前述之后加载) |
| `v13-mark.css` | v0.13 (Plan C 符号) | Plan C 档案索引签微符号 `.lb-mk` + 颜色 / 尺寸变体 |

## 字体 / Fonts — CDN-only(未本地捆绑)

设计**仅使用 Google Fonts CDN**,本导出包内**不含本地 WOFF2 文件**。
The design uses the **Google Fonts CDN only**; this export bundle contains **no local WOFF2 files.**

通过以下 `<link>` 加载 / Load via:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
```

字体职责 / Font roles:
- **Noto Serif SC**(思源宋体)— 标题 / 引文 / 强调词 / 视觉名词 / Headlines, quotes, emphasis
- **Noto Sans SC**(思源黑体)— UI 按钮 / 表单 / 表格行 / 正文 / Controls, forms, body
- **JetBrains Mono** — 编号 / 哈希 / 时间戳 / eyebrow / 状态徽标 / IDs, hashes, timestamps, eyebrows

离线自托管 / For offline self-hosting — 自行下载 WOFF2 并补充 `@font-face`:
- Noto Serif SC / Noto Sans SC — github.com/googlefonts/noto-cjk
- JetBrains Mono — github.com/JetBrains/JetBrainsMono

## 备注 / Notes

- 所有颜色均通过 token 表达(无硬编码),便于 palette-sync 校验与 checksum 比对。
  All colors flow through tokens (no hardcoded values) for palette-sync checks and checksums.
- `v13-mark.css` 的 `.lb-mk` 使用 CSS `mask-image` + inline SVG,单色随 `currentColor`;无外部图像依赖。
  `.lb-mk` uses CSS `mask-image` + inline SVG; single-color via `currentColor`; no external image deps.
- 这些是设计源文件,需适配 / 移植至现有 renderer 样式结构(详见交付手册 § 02)。
  These are design-source files to adapt/port into the existing renderer stylesheet structure (handoff § 02).
- 本导出不含打包 HTML、不压缩、不合并、不嵌入 JS。
  This export contains no bundled HTML, no minification, no merging, no JS-embedding.
