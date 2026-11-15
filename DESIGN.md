---
name: 卡坦岛 · 海岸桌面
description: 以可操作的实体感岛屿为中心的好友桌游界面
colors:
  primary: "#173b3d"
  paper: "#f7f6f0"
  ocean: "#b8d8d2"
  muted: "#65776b"
  accent: "#b65c35"
  wood: "#397456"
  brick: "#ae674a"
  sheep: "#66863e"
  wheat: "#a28027"
  ore: "#637e8c"
  surface-alt: "#e9ede3"
  focus: "#9a4c26"
  line: "#d6ded3"
  feedback-gain: "#c99b3f"
  feedback-robber: "#493e57"
  feedback-select: "#c99b3f"
typography:
  body:
    fontFamily: "Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  title:
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.4
rounded:
  control: "8px"
  panel: "12px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
---
# 海岸桌面

## Overview

主界面是操作型桌游界面。海水与低多边形实体棋盘构成主视野，暖白色侧栏承载房间、玩家和操作。棋盘的视觉优先级高于界面装饰。

## Colors

界面颜色的独立值只在 `src/tokens.css` 声明，与 frontmatter 和 `.impeccable/design.json` 的 token 表一致；其他 CSS 可以声明指向这些 token 的语义别名，不再定义另一套颜色值。带透明度的表面使用 token 颜色与 alpha 混合。棋盘实体用相应地形颜色，其明暗由光照决定；数字 token 不受光照影响。海水底色与页面的 ocean 保持一致。

资源身份色以五种 UI token 为准。二维地块与程序化 3D 回退共用 `terrain.js` 的亮色地形表：wood `#477e5f`、brick `#b97854`、sheep `#7d9c4f`、wheat `#b08f31`、ore `#6d8794`，desert `#dfc88d` 不变。当前实际显示的 V9 GLB 在实例化前也按此表校准顶面与资源装饰的色相，保留面间明暗、地层边缘、树干与白色羊毛，不改源资产或几何。资源插画的主色使用对应 UI token 或 ±10 个百分点的 HSL 明度变体，羊毛仍保留暖白主体与绿色脸部。资源名称、图形和颜色共同标识资源，玩家身份色不随资源调色改变。

生产与港口选中共用金色 `--feedback-gain` / `--feedback-select: #c99b3f`；强盗反馈使用 `--feedback-robber: #493e57`。交易反馈描边、光晕从这些 token 派生。首页展示棋子的强调色从 CSS `--accent` 注入，无主港口端点使用 `--line`，真实玩家颜色保持不变。

## Typography

操作界面统一使用 `--font`：Segoe UI、Microsoft YaHei、system-ui 字体栈。字号只使用 11 / 12 / 13 / 14 / 16 / 18 / 20 / 24 / 32px：最弱辅助标注 11px、次级文字 12px、紧凑正文 13px、正文 14px、强调 16px、小标题 18px、面板标题 20px、页面标题 24px、首页主标题 32px。真实信息文字不得小于 11px，字重只使用 400 / 500 / 600 / 700 / 800。首页主标题是唯一使用 `--font-display` 的场景，字体为 Noto Serif SC、Songti SC、SimSun 的衬线回退；响应式字号仍须落在上述字阶。

当前标题依赖系统字体，尚未引入独立自托管显示字体；这是首版资产状态，不作为未来必须使用系统显示字体的规范。

次级文字使用 12px，最弱辅助标注也至少 11px，不再沿用 9/10px 或 rem 字号。图标仅使用 16px（行内）、20px（按钮）、24px（工具栏与主要标记）、40px（空状态）四档；线宽统一 1.65，空状态不另设细描边。尺寸由 `ui/theme.css` 统一选择 token，资源插画、骰面和二维棋盘几何不属于 `.icon` 尺度。

## Layout
桌面版顶部为品牌与房间信息，左侧优先建造和回合操作，玩家与房间信息可滚动查看，中央为岛屿与手牌，右侧为当前任务、记录与交流。手机竖屏以棋盘为中心，搭配紧凑状态条和两行操作；低高度横屏使用左侧棋盘与右侧操作轨道。可折叠玩家、记录与聊天，弃牌、交易报价等当前任务独立显示并保留提醒。适配安全区和键盘视口，不强制旋转；主要按钮触控高度至少 44px。

首页保留全屏海面，实测标题、副标题、服务器提示、入口按钮、视角控件和安全区，计算其间的岛屿可见区域。桌面和竖屏上下留白；短横屏将介绍与视角放左侧、入口放右侧，中央保留完整岛屿与港口。低高度可隐藏副标题，主要入口和标题保留。使用整圈旋转的共同包围范围构图，旋转时不反复缩放或改俯角。

## Elevation & Depth

全站阴影统一为三档：静置卡片使用 `--shadow-1`（`0 3px 14px #173b3b14`）；浮动面板、下拉与回合横幅使用 `--shadow-2`（`0 7px 24px #21483b12`）；弹窗使用 `--shadow-3`（`0 16px 44px #173b3b26`）。同档组件使用同一个 token，不再单独声明近似阴影。

## Shapes

圆角尺度为 `--radius-sm:8px`、`--radius-md:12px`、`--radius-lg:14px` 与药丸形 `999px`，圆形头像和圆点使用 `50%`。卡坦岛保留 `--radius-control` 指向 8px、`--radius-panel` 指向 12px，弹窗与主要浮动面板使用后者。棋盘六边形和游戏棋子尺寸由拓扑/渲染代码定义。

## Tokens

`src/tokens.css` 是尺度与颜色的唯一数值来源，`.impeccable/design.json` 的 `extensions.tokens` 保存逐项一致的规范记录。

| 类别 | Token | 值与用途 |
| --- | --- | --- |
| 字体 | `--font` / `--font-display` | Segoe UI、Microsoft YaHei、system-ui / Noto Serif SC、Songti SC、SimSun；后者仅首页主标题 |
| 正文与弱文字 | `--ink` / `--muted` | `#173b3d` / `#65776b` |
| 纸面、海面与次级表面 | `--paper` / `--ocean` / `--surface-alt` | `#f7f6f0` / `#b8d8d2` / `#e9ede3` |
| 强调、焦点与分隔线 | `--accent` / `--focus` / `--line` | `#b65c35` / `#9a4c26` / `#d6ded3` |
| 五资源 | `--wood` / `--brick` / `--sheep` / `--wheat` / `--ore` | `#397456` / `#ae674a` / `#66863e` / `#a28027` / `#637e8c` |
| 行动反馈 | `--feedback-gain` / `--feedback-robber` / `--feedback-select` | `#c99b3f` / `#493e57` / `#c99b3f` |
| 字阶 | `--font-size-{值}` | 11 / 12 / 13 / 14 / 16 / 18 / 20 / 24 / 32px |
| 字重 | `--font-weight-{值}` | 400 / 500 / 600 / 700 / 800 |
| 图标 | `--icon-inline` / `--icon-button` / `--icon-toolbar` / `--icon-empty` | 16 / 20 / 24 / 40px |
| 图标描边 | `--icon-stroke` | 1.65；包括空状态 |
| 圆角 | `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-pill` / `--radius-circle` | 8px / 12px / 14px / 999px / 50% |
| 卡坦圆角别名 | `--radius-control` / `--radius-panel` | `var(--radius-sm)` / `var(--radius-md)`，即 8px / 12px |
| 间距 | `--space-1` … `--space-6` | 4 / 8 / 12 / 16 / 24 / 32px |
| 静置阴影 | `--shadow-1` | `0 3px 14px #173b3b14` |
| 浮动阴影 | `--shadow-2` | `0 7px 24px #21483b12` |
| 弹窗阴影 | `--shadow-3` | `0 16px 44px #173b3b26` |
| 层级 | `--z-base` / `--z-sticky` / `--z-dock` / `--z-banner` / `--z-menu` / `--z-modal` / `--z-toast` | 0 / 10 / 20 / 30 / 40 / 50 / 60 |
| 动效时长 | `--duration-1` / `--duration-2` / `--duration-3` | 120ms / 180ms / 240ms |
| 缓动 | `--ease` | `cubic-bezier(.2,.7,.3,1)` |
| 触控目标 | `--touch-size` | 44px；宽高均至少 44px，紧凑控件用 padding 或伪元素扩展热区 |

焦点环统一为 `2px solid var(--ui-focus)`，`outline-offset:2px`，其中 `--ui-focus` 是 `--focus` 的别名。`prefers-reduced-motion:reduce` 只在 tokens 中将三个时长 token 置为 `0ms`，使用这些 token 的界面动效随之关闭。布局宽度断点为 640 / 950 / 1190px，短横屏统一使用 `(max-height:600px)` 条件；棋盘与卡牌几何尺寸不受间距尺度限制。

短横屏仅由 `table.css`（基础舞台、手牌与回合栏）和 `ui/theme.css`（首页、弹窗、交易、反馈与最终 HUD）各一段 `(orientation: landscape) and (max-height: 600px)` 管理。横屏段内可复用 640px 宽度分档；竖屏不触发双栏交易/开桌布局。1190px 以上的宽屏增强使用严格大于，避免与 1190px 以下规则同时命中。

## Components

选择建造后，合法位置出现浅金色标记；点击位置提交一次服务端操作。悬停显示地块产出信息。可旋转/缩放，提供复位按钮和 2D 棋盘备用。状态通过文字、图标和颜色共同表达。二维棋盘上的合法位置可用 Tab 聚焦、Enter 落子。

首页示例与对局调用同一道路网络和建筑构建入口，复用当前建筑模型、回退、所属颜色及相同玩家道路的转角连接；四处村庄沿六段道路依次建造，其中两处升级城市，30 秒舒缓循环，镜头约 5 分钟转一圈。拖动、缩放或点击地图即暂停，可恢复展示或复位。弹窗和页面隐藏暂停时钟；减少动态效果与 2D 使用静态示例。示例不经过游戏动作、行动提示或网络连接；进入房间清除展示层并恢复房间默认视角，切换渲染器或离开页面释放实例、资源和动画。

## Do's and Don'ts

- 保持五种资源的界面颜色、图标与棋盘地形对应。
- 数字标记和合法位置必须优先清晰，不能被景物遮挡。
- 手机保留完整棋盘和当前关键操作；可以收起辅助记录，不能把必须处理的任务藏进辅助面板。

Three.js 程序化几何构建六边形地块、树、矿山、农田、羊、海岸、村庄、城市和道路。`src/terrain.js` 管理确定的地形变化和实例批次，`src/board3d.js` 管理层更新、交互、渲染及资源池，`src/board.js` 保留二维备用。装饰保留中央数字净空与边缘道路通道；运行时没有远端贴图、商业原版图像或字体依赖。素材来源、许可和性能预算见 `docs/terrain-art-and-layout.md`。

## Stage 5 component treatment

- 首页展示岛与海面不变。三入口 dock 使用 paper 95% alpha、shadow-2、radius-panel；开桌按钮使用 accent 底与白字（对比度约 4.59:1），其余入口为 surface-alt。hover 使用 focus，保持白字。
- 回合横幅只使用 shadow-2。你的回合左侧使用 3px 当前玩家色，等待回合使用 muted；玩家色通过 playerStyle 注入，保留现有任务说明与快捷操作。
- 资源卡使用 paper，数量固定 18px/700。零库存或当前查看建造费用不足的资源使用 saturate(.4)，数量文字使用 muted；免费建造仍按原费用规则呈现，不改变动作资格。两位数量留出空间，不通过缩小文字来挤进窄卡。
- 交易选中页签使用 accent 2px 下划线。步进器采用上下排列的 44×44px 点击区、32px 圆形视觉，以免五列中的点击区相互覆盖。预览与反馈按当前动作资格使用 wood / brick 文字和同色 10% alpha 底；自己的未成交报价保持中性，不误示为已经成交。
- 交易内容与确认按钮留在同一个可滚动区域中，footer 不再覆盖内容。短横屏延续原双栏付出/获得布局，过长内容滚动访问；不宣称源码尺寸估算等同于三视口像素验收。
- 3D 合法位置、选中和生产地面标记与 feedback-select/gain 对齐为 #c99b3f，强盗地面标记与 feedback-robber 对齐为 #493e57。保持深度测试、点击映射、几何、海面 #b8d8d2 和模型本身的暖色轮廓可读性。

阶段 4 的 9 档字阶、4 档图标、640/950/1190 断点、两处短横屏规则归属与 180ms 常规动效继续有效。
