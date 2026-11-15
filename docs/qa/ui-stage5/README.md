# UI 阶段 5：最终视觉收敛

基线：`2e780b1c92d9d897dcbdd8e781b93a91b2848ddb`（阶段 4 / PR #34）。本阶段只更改表现层与相应验证、规范，不更改规则、服务端、协议、状态、玩家身份色或资源插画资产。

## 完整文件清单

- `src/home-family.css`：95% paper dock、shadow-2、12px panel 圆角，开桌 accent/white，其余 surface-alt；白字对 accent 对比度 4.59:1。
- `src/table.css`：回合横幅仅 shadow-2，左侧 3px 玩家/等待标记，取消会覆盖左标记的整圈 2px 强制边框；响应式资源数量统一 18px。
- `src/ui/table.tsx`：只注入 playerStyle 和资源不足样式类；查看费用复用 buildAvailability，保留所有 DOM、aria、动作和数字内容。
- `src/style.css`：所有现有资源卡底改 paper；数量 18px/700。
- `src/ui/theme.css`：资源不足 saturate(.4)/muted，数量 18px/700、两位数空间；窄屏卡宽 52px/极窄横屏 44px，保留现有断点与 dock 避让规则。
- `src/commerce.css`：accent 2px 选中下划线；上下排列 44×44px 热区、32px 视觉圆；wood/brick 10% alpha 预览；确认 footer 留在正常滚动流中，不遮住步进器。
- `src/ui/commerce.tsx`：只按原动作 disabled 条件选择 ready/unavailable 样式；自己的报价保留中性 pending，不声称已能被他人接受。
- `src/board3d.js`：合法位置/选中/生产地面标记为 #c99b3f，强盗反馈为 #493e57；不改几何、点击、深度或海面。
- `src/visuals/robber.js`：强盗脚下地面环为 #493e57；模型自身暖色轮廓用于可读性，未改源 GLB、尺寸、位姿、光照和点击。
- `DESIGN.md` 与 `.impeccable/design.json`：同步本阶段组件规范；基础 token 数值不变。
- `tests/ui-stage5.test.js`：5 项设计/尺寸/材质及真实 React 静态渲染回归。
- `docs/qa/ui-stage5/README.md`：本记录。

没有删除类名或死代码，没有新增 CSS 文件。改写的是现有规则中的声明；类名引用检查使用 `grep -R -n 'exchange-stepper' src scripts tests`、`grep -nE 'turn-banner|needs-attention|your-turn' src/table.css src/ui/table.tsx`、资源卡和 dock 在 `src/` 的全仓检索。原渲染路径仍使用这些选择器，故不把它们当死代码删除。

## Token / 设计一致性

`tokens.css` 的所有原始 token（含 reduced-motion）不变，`resource-palette.test.js` 和 `ui-stage4.test.js` 逐项比较 JSON 与 CSS；DESIGN 保持相同数值并新增组件用途。所有 CSS 独立十六进制值仍为 **18**，低于 90。

| 用途 | 原表现 | 本阶段来源和值 |
| --- | --- | --- |
| 首页 dock | 不透明纸面、18/16px 圆角、独立阴影 | paper #f7f6f0 95% alpha / radius-panel 12px / shadow-2 |
| 开桌 | ink + paper | accent #b65c35 + white；hover focus #9a4c26 |
| 回合横幅 | 多条独立阴影、任务整圈描边 | shadow-2 `0 7px 24px #21483b12`；3px `--player` / muted #65776b |
| 资源手牌 | 各资源渐变、13–24px/600 | paper #f7f6f0；18px/700；不足 saturate(.4) + muted |
| 页签 | 单独投影 | accent #b65c35 2px 下划线 |
| 步进器 | 横排压缩宽度 | touch-size 44px、视觉32px、50%圆角 |
| 交易资格 | 中性预览 | wood #397456 / brick #ae674a，各10% alpha底 |
| 合法/选中/生产地面标记 | #d4bb79 / #49695e / #f0db9e / #e3bd69 | feedback-select/gain #c99b3f |
| 强盗地面反馈/脚环 | #685074 / #ffd56a | feedback-robber #493e57 |
| 海面 | #b8d8d2 | ocean #b8d8d2，不变 |
| 字阶、图标、断点、动效 | 阶段4已归一 | 9档11–32px；16/20/24/40、1.65；640/950/1190；120/180/240ms，不变 |

## 已验证与边界

- 完整单元/集成源码测试 **282/282**，包括新的 5 项。
- `npm run check`（语法 + TypeScript）。
- `npm run build:cn`、`npm run build:global`。
- `npm run worker:check` 打包预演；`python -m unittest ops/test_deploy.py`。
- `git diff --check`。
- React 静态渲染：数量0、费用不足/恢复、玩家回合切换、银行4:1、缺货、资源不足、同种资源、暂停、离线、busy、无报价、报价创建/接收/自己待接受、他人回合及配对限制。保留并验证原 action、disabled、aria 和原状态无变更。
- Three.js 材质测试与既有2D/3D资源/几何测试通过；不等同浏览器内渲染验收。

### 三视口说明

| 视口 | 本次检查 | 未完成 |
| --- | --- | --- |
| 1440×900 | 既有媒体分支、dock/token/资源字阶源码检查；双版本构建 | 像素截图/浏览器交互 |
| 390×844 | 交易五列单卡内宽约64.4px，可容44px热区；footer正常流 + dialog overflow-y:auto；资源托盘为两位数留空间 | 像素截图/浏览器交互 |
| 844×390 | 交易双栏内单卡宽约49.2px，可容44px热区；单个picker估算157.6px，长内容和确认按钮共用可滚动区域且无sticky遮挡 | 像素截图/浏览器交互 |

以上为源码分支和保守几何计算，不是浏览器计算样式或视觉证明。依用户最新要求，本阶段跳过截图，不启动此前受阻浏览器、不重试受限截图服务，也不为截图阻塞交付。国内/海外首页与对局均完成构建和静态呈现测试，未声称完成双站实际对局/3D与2D浏览器验证。已有 Three.js 大 chunk 提示未扩大范围处理。

发布通过既有 Draft PR → 精确 head 普通 Checks → 常规合并 → main Checks → 自动双端 release 路径。最终合并 SHA、运行链接与发布探测证据另记于交付记录，不用本地构建代替上线验证。
