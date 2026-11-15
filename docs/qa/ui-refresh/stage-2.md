# UI 改造阶段 2 清理旧布局与组件归一

基准 main：`66a278b6ec8738dba6e8fd24e0eee8ab33ddcb8f`。独立分支：`ui/coastal-stage2-20261115`。

## 变更清单

| 文件 | 变更 |
| --- | --- |
| src/style.css | 删除旧三栏、空侧栏及不再可达的首页祖先规则；清理被覆盖的资源数量字号；dialog 使用现有12px面板 token |
| src/entry.css | 清理旧三栏、空侧栏及迁移前首页/侧栏规则；保留实际使用的玩家列表、聊天和表单 |
| src/table.css | 统一空侧栏隐藏；集中 topbar、turn-banner、board-top 基础与响应式样式，保留原级联获胜值及条件 |
| src/notices.css | 集中 action-feedback 海玻璃版本、定位/隐藏/文本换行及 leader；弹窗使用12px面板 token |
| src/ui/theme.css | 移出 topbar/turn-banner 基础定义；保留响应式覆写；清理空侧栏及不可达首页祖先规则 |
| src/map-first.css、src/immersive-polish.css、src/visual-first.css、src/home-showcase.css | 移出三个共享组件的定义，保留独立组件原样式；map-first解除短横屏开桌弹窗的旧440px上限，使已有600px布局生效 |
| src/home-family.css | 弹窗根圆角统一为现有面板 token |
| tests/home-showcase.test.js | 新增3项阶段目标测试：组件归属、反馈的隐藏/定位/长文本行为、弹窗圆角与旧列布局清除；原4项保留 |

没有新增CSS文件；没有改游戏逻辑、数据、网络、服务端、DOM及可访问性属性。字体、图标、断点的全仓尺度归一仍属于后续阶段。

## 删除依据

删除前检索全部187个运行时/测试文件，以及 scripts、ops 和工作流；逐项查看 className、classList 与模板动态拼接。完整命令、引用位置和条件清单见随交付包的 `dead-style-audit.md`。

- 17个弃用类在JS/TS/JSX/TSX/HTML中的引用为0：`panel-title`、`game-facts`、`island-guide`、`guide-mark`、`resource-legend`、`guide-note`、`invite-block`、`empty-seat`、`lobby-actions`、`build-icon`、`hand-label`、`log-section`、`bank-row`、`offer-columns`、`trade-offer`、`variant-option`、`secondary-panel`。每项 `rg` 结果均为空、退出码1。
- `root.tsx:115/193` 的左右aside为空；删除37个旧分支后只保留统一 `#left-panel,#right-panel{display:none}`。
- `root.tsx:113` 房间状态同时具有 `in-room playing`，等待房间另加 `waiting`；`.in-room:not(.playing)` 不可达。
- HomePanel/PublicRooms及舞台弹窗是main外的dialog，故旧 `.home`/`.playing` 祖先下的表单、聊天等规则不可达。
- `.players`（entry.tsx）与 `.chat-section`（table.tsx）仍有真实引用，保留其基类和浮窗规则。动态 `resource-card ${r}` 亦保留。
- 216项清理记录包括16个旧列选择器、37个空aside分支、51个旧home布局/不可达祖先作用域、81个含弃用类的选择器、11个旧playing侧栏/几何规则、9个不可能房间状态、5个被覆盖的资源数字规则、6个弹窗根圆角替换。
- 共享组件归一记录包含173次选择器分支迁移、46条被覆盖声明删除。按原导入顺序保留获胜声明、媒体条件、特异性和相互顺序；不将所有媒体查询简单移至文件末尾。

## Token与规模对照

| 项目 | 阶段1后 | 阶段2后 |
| --- | --- | --- |
| token定义 | tokens.css，共57项 | 不变 |
| 弹窗根圆角 | 18px / ui-radius 14px等混用 | var(--radius-panel) → var(--radius-md) → 12px |
| CSS文件数 | 14 | 14 |
| CSS总字节数 | 124010 | 109704 |
| CSS不同十六进制色 | 20 | 20 |
| DESIGN.md / design.json / tokens.css | 阶段1同步 | 本阶段不改规范或token值 |

字节数按14个CSS原文件求和，颜色数用 `#[0-9a-fA-F]{3,8}\b` 的唯一值计数。

## 已完成验证

- `npm test`：268/268通过（原265项及新增3项）。
- `npm run build:cn`、`npm run build:global`：均通过。
- `npm run worker:check`：通过。
- 14个CSS均经PostCSS解析；共享组件单一归属检查、`git diff --check`通过。
- 独立静态级联复核：首页shell/board/视角控件、活跃players/chat在8组视口条件下保持原有效布局；资源数字5种场景的最终值保持不变。此项是代码复核，不是浏览器截图或Playwright。

## 浏览器验收状态

按照用户最新口径，仅对首页/大厅等静态页面截图1440×900、390×844、844×390；对局不再要求截图，改用测试与上线后实际试玩。

用户另行明确批准将公开PR的CSS交给已连接的Cloudflare Browser Rendering截图。三个精准视口的首页真实3D截图已完成，无页面横向溢出；顶部栏、首页入口和棋盘框的实测布局与改前一致。390×844开桌弹窗无溢出。初次844×390弹窗截图复现了改前已有的冲突：600px横屏宽度受通用440px max-width限制，右侧内容被裁切；本次在既有横屏规则内解除该旧上限，目标测试、完整268项测试和两种构建已重验。修复后的横屏截图及桌面弹窗结果归档至私有交付页。

Cloudflare浏览器截图不替代完整Playwright。此前本地Chromium socket EPERM与本地预览跨隔离环境不可达的限制仍然存在；未重跑被拒绝的启动路径。上线后试玩、PR/合并/双站部署结果记录到私有交付页。
