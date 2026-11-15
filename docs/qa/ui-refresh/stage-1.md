# UI 改造 · 阶段 1：单一 token 真源

基准：`f3fd91156b1ce18b6466ca91dd8421bda273c90d`，独立分支 `ui/coastal-tokens-20261115`。

## 变更清单

- `src/tokens.css`：扩展为 57 项 token，补齐九档字号、五档字重、圆角、间距、三档阴影、z-index、120/180/240ms、统一缓动、44px 触控尺寸、focus 与 line。减少动态效果只将时长 token 置零。
- `src/ui/theme.css`：颜色与尺度引用主 token；全站字体引用 `--font`，删除对它的反向重绑定；移除无引用 `--ui-gold`。
- `src/home-family.css`：删除五项 `--entry-*` 重复声明，引用全部转到主 token；首页标题使用 `--font-display`。
- `src/style.css`、`table.css`、`entry.css`、`map-first.css`、`immersive-polish.css`、`visual-first.css`、`commerce.css`、`notices.css`、`graphics-quality.css`、`chat-preview.css`：暖白、深青与语义状态颜色归一；透明色使用 token + alpha 的 `color-mix`。不删除组件规则，不改变选择器或声明顺序。
- `DESIGN.md` 与 `.impeccable/design.json`：与 57 项 token 同步；经用户确认，17px 标题改为18px，11px/15px内边距改为12px/16px，常规动效180ms。

## Token 前后对照

| 项目 | 改前 | 改后 |
| --- | --- | --- |
| 主配色 | tokens、ui、entry 三套近义色 | tokens 唯一定义值；ui 可声明别名 |
| 纸面 | 多个暖白 | `--paper: #f7f6f0` 与 alpha |
| 正文 / 次级文字 / 边线 | 多个深青、灰绿 | `--ink` / `--muted` / `--line` |
| UI 主色 | `#397456` 木材绿 | `var(--accent)`，既定 `#b65c35` |
| font | theme 反向重绑定 | tokens 字体栈，ui 只引用 |
| 常规动效 | ui 150ms / 设计160ms | `--duration-2: 180ms` |
| 最小信息文字规范 | 10px | 11px（实际字号归一在阶段4） |
| CSS 不同十六进制色 | 268 | 20（反馈色于阶段3继续归一） |

完整 token 数值表见 [DESIGN.md](../../../DESIGN.md) 与 `.impeccable/design.json` 的 `extensions.tokens`。

## 删除依据

删除前执行 `rg -n -- '--ui-gold|--entry-' src`：`--ui-gold` 只有 theme 声明、无引用；entry 五项声明只供 home-family 使用，先替换全部引用再移除声明。删除后同样全仓检索：两者引用均为零。未删除旧布局或组件样式；该工作属于阶段2。

## 验证状态

- `npm test`：265/265 通过。
- `npm run build:global`：通过（既有大包体积提示）。
- `npm run check`：通过，包括 TypeScript 检查。
- `git diff --check`：通过。
- 静态核对：57 项 token 与 design.json 一致；原有配色值不变；CSS 颜色数20。
- 三视口浏览器截图：尚未完成。系统 Chromium 启动受到当前执行环境 AF_UNIX socket 限制（Operation not permitted）；官方 Playwright headless-shell 下载五次均为空或截断归档，安装失败。云浏览器亦无法访问 exec 中的本地5175服务（ERR_CONNECTION_REFUSED）。2026-11-15 用户书面授权阶段1先提交、PR并合并，三个视口截图改为合并后补交。此记录不将代码测试等同于截图验收；阶段2尚未开始。
