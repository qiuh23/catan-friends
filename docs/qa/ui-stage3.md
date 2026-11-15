# UI 阶段 3：资源色四方对齐

基准：`acc045f400e333f2cd8d3505ea74e4b93871156f`（阶段 2 已合并）。

## 变更

- 五资源 UI token 不变。`terrain.js` 采用设计指定的亮色表，同时用于 2D 和程序化回退。
- 实际 3D 路径是 V9 GLB，而非只有旧程序化地形。`board-models.js` 加载后、实例化前调用 `terrain-readability.js` 的显示色校准：以亮色表的色相和地表平均明度为锚，保留顶面/装饰内部明暗；不改源 GLB、位置、索引、法线、随机、网络或游戏状态。白色羊毛、树干、地层侧缘与两种沙漠保持原色。
- `icons.js` 主 fill 使用对应资源 token 数值或 ±10 个百分点的 HSL 明度变体；保留轮廓、白羊毛、树干与高光。SVG 仍可独立作为 Image/canvas 纹理使用，不依赖外部 CSS 变量继承。
- `commerce.css` 生产、强盗、港口选中描边/光晕改用 `--feedback-gain`、`--feedback-robber`、`--feedback-select`。前后二者同为 `#c99b3f`，强盗 `#493e57`；同步 `tokens.css`、`DESIGN.md`、`.impeccable/design.json`。
- `table.tsx` 无主港口边框改用 `var(--line)`；`main.js` 将 `--accent` 计算色注入首页展示棋子。无 DOM/可访问性属性变更。实际玩家 COLORS 不改。
- 新增 `resource-palette.test.js` 5 项设计目标测试；`home-pieces.test.js` 的比较色从同一个首页示例取得，继续比较首页/对局棋子的所有实际实例颜色与几何，不锁死旧硬编码。

没有新增 CSS 文件，没有删除样式规则或类，没有改服务端、规则、协议、存档和真实玩家身份色。阶段 4 的字号、图标、断点与阶段 5 的样式提升没有混入。

## 色值对照

| 资源 | UI token（保持） | 原地形 | 新地形 / V9 顶面锚 |
| --- | --- | --- | --- |
| 木材 | #397456 | #648c68 | #477e5f |
| 砖块 | #ae674a | #c08459 | #b97854 |
| 羊毛 | #66863e | #a5be70 | #7d9c4f |
| 粮食 | #a28027 | #ddbd61 | #b08f31 |
| 矿石 | #637e8c | #88989b | #6d8794 |
| 沙漠 | 不适用 | #dfc88d | #dfc88d（不变） |

新增反馈 token：生产 `#f1c86e` → `--feedback-gain: #c99b3f`；港口选中 `#d8ad58` → `--feedback-select: #c99b3f`；强盗 `#493e57` → `--feedback-robber: #493e57`。规范 token 表与 CSS 全量逐项相等由测试保证。

## 提交前验证

- `npm test`：273/273 通过。
- `npm run check`（JS 语法、TypeScript）：通过。
- `npm run build:cn`、`npm run build:global`：通过。
- `npm run worker:check`：通过。
- 真实 17 个 GLB：15 个资源变体校色、2 个沙漠不变；顶面色相/均值、几何逐值不变、羊毛/树干/地层保留、明暗细节和重复加载幂等均通过。
- 既有 2D/3D、规则、房间生命周期与隐藏信息测试仍通过。

当前本地 Chromium 启动不可用，未重试此前被拒绝路径，也未把 Playwright 标为通过。按用户最新要求，合并部署后补首页/入口弹窗的 1440×900、390×844、844×390 静态截图；对局用测试和两站上线试玩兜底，不要求对局截图。截图、部署 SHA 和试玩结果另随阶段交付记录，不以本文件中的提交前结果冒充上线验收。
