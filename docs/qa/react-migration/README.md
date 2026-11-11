# 正式 React 界面迁移验收

2026-11-11。卡坦岛基线为远端 main `61d13cd`，巫师牌界面参考为 main `6f3733e`。验收针对正式根入口；不使用独立样板或生产测试接口。架构、权限和部署边界见 [迁移说明](../../react-ui-migration.md)。

本轮为本地源码及构建验收，尚未合并或公网发布。以下区分真实本地服务、共享规则协议夹具和静态检查，不把视口模拟解释为真机验收。

## 主要检查结果

| 检查 | 本轮结果 | 证据与范围 |
| --- | --- | --- |
| 协调器语法与严格 UI TypeScript | 通过 | `npm run check`；UI 的 `tsconfig.json` 启用 `strict` |
| 规则、权威、隐私、部署契约等单测 | 172 项通过 | `npm test`；含规则机器人完整局，不等同真人浏览器完整局 |
| Node 发布接收器 | 11 项通过 | `TMPDIR=/private/tmp python3 -m unittest ops/test_deploy.py` |
| cn／global 正式构建 | 两版通过 | `npm run build:cn`、`npm run build:global`；构建含严格类型检查 |
| 真实站点策略浏览器专项 | 两版各 3 视口通过 | `scripts/site-edition-browser.mjs cn`／`global`；真实本地 Node 服务、建房、电脑、开局、昵称、聊天差异、规则文案与刷新身份 |
| 正式 React 界面迁移专项 | 两版各 3 视口通过 | `output/playwright/react-migration/cn-report.json`、`global-report.json`；1440×900、390×844、844×390，页面及控制台错误均为 0 |
| 三个真人身份的真实本地联机 | 通过 | `scripts/multiplayer-browser.js`：建房／加入／准备、真实 3D 拾取落子、完整蛇形初始放置、聊天同步、刷新与隐藏信息；暂停／恢复、暂停期间聊天及对局中房主双向转交也通过 |
| 本站游戏大厅返回 | 两版通过 | `TEST_EDITION=cn/global npm run test:integration`；本站邀请码、外站邀请拒绝、暂离确认／取消、返回对应大厅且不携带查询参数或凭据 |
| 交易浏览器回归 | 5 视口及边界用例通过 | `scripts/commerce-browser.mjs`、`commerce-edgecases-browser.mjs`；桌面、390px／320px 竖屏、844px／667px 横屏，截图输出至本轮 `commerce/` 子目录 |
| 重启与本地 Worker | 已执行项目通过 | Node 重启、安全 Worker，以及 3／6 人 Worker 重启；验证既有身份和状态恢复，不访问生产存档 |
| 手动视图恢复 | 3 视口通过 | `test-results/view-recovery-browser.json`；3D／2D 来回切换、刷新、重连和后续公开动作保持视图 |
| 3／6 人地图取景 | 8 组通过 | `output/playwright/react-migration/map-fit/results.json`；含 320px 窄屏，投影落在可用区域内 |
| 公开行动反馈及交易／奖励呈现 | 通过 | 10 个行动反馈场景及交易效果、公开分数、奖项显示；输出位于 `action-feedback/`、`commerce-effects/` |
| Worker 打包预演 | 通过 | `npm run worker:check`；只打包，不发布 |

Python 接收器首跑遇到 macOS `/var` 与 `/private/var` 临时目录别名导致的路径比较失败；改用规范化 `TMPDIR=/private/tmp` 后 11 项通过。该记录用于说明本机环境差异，没有修改部署路径安全检查来绕过失败。

三真人浏览器流程在真实本地服务器上运行，3D 落子通过实际投影和拾取；后续初始化可使用二维棋盘完成，以覆盖同一权威状态的两种输入方式。尚未由三个真人浏览器一路游玩到胜利；终局界面和再开使用下面的协议夹具，完整规则推进另由单测覆盖。

## 正式界面专项覆盖

`scripts/react-migration-browser.mjs` 复用 `map-first-fixture.js`，通过原个人视图投影和根入口构建界面。只有脚本内的 WebSocket 包装器延迟聊天 ACK，并处理房间层暂离／再开；没有新增生产接口，也不以此替代真实房间持久化验收。

- 报价、聊天、发展卡、弃牌、公开快照、结算及再开更新后，WebGL canvas 仍为同一个 DOM 节点。
- 建造费用浮窗点击空白关闭后保留已选建造模式及画布。
- 玩家交易保留付出 2 张木材、获得 1 张矿石的完整数量；切换玩家／银行、发起／当前报价、外点关闭、重开及刷新均保留草稿，银行资源选择也恢复。发布、撤销走共享规则。
- 海外延迟 ACK 期间继续输入的新草稿不会被清空；对手消息快照更新后保留文本、焦点和选区，关闭／重开仍恢复草稿。国内不生成聊天入口或输入。
- 发展卡数量、胜利点卡禁用、丰收两张资源选择及提交通过；必选弃牌需恰好满足数量，点击背景不能关闭，草稿继续保留。
- 暂离先确认，取消继续原局；返回首页后用原凭据恢复，权威手牌保持。脚本不输出或保存凭据到报告。
- 最终排名包含全部玩家和公开最终分，最后一行可实际滚动到屏幕内；再开／返回主按钮在首屏可点击，再开返回原席位候场。

原始截图及报告位于忽略提交的 `output/playwright/react-migration/`。`global-report.json` 包含 3 组结果和 27 张截图；国内报告略去聊天场景。取景专项、交易专项和行动反馈分别保存在子目录，避免覆盖旧轮次的受跟踪截图。

## 代表截图

以下均为正式入口的本地实际截图，已经目视检查。桌面和手机视口分别模拟；图中为规则协议夹具公开状态，不代表真实账号或线上房间。

| 场景 | 截图 |
| --- | --- |
| 桌面对局 1440×900 | [全屏三维地图与浮控](global-desktop-table.png) |
| 手机竖屏 390×844 | [对局](global-portrait-table.png) · [交易数量](global-portrait-trade.png) |
| 手机横屏 844×390 | [对局](global-landscape-table.png) · [结算首屏](global-landscape-settlement.png) |
| 小手机 320×568 | [六人地图与完整港口](small-portrait-map.png) |
| 首页及候场 | [首页](global-portrait-home.png) · [候场](global-portrait-room.png) |

本目录同时保留 [海外专项报告](global-report.json)、[国内专项报告](cn-report.json) 和 [地图量化结果](map-fit-results.json)。全部本机输出仍可在 `output/playwright/react-migration/` 检查。

## 复现

在本地启动当前源码服务后，运行正式入口专项：

```sh
TEST_URL=http://127.0.0.1:5187 TEST_EDITION=global BROWSER_CHANNEL=chrome node scripts/react-migration-browser.mjs
```

国内用对应 cn 构建／服务与 `TEST_EDITION=cn`。站点策略脚本自行启动临时服务；其他专项按其 `TEST_URL` 指向当前本地服务。浏览器截图输出全部留在 `output/playwright/` 或忽略的 `test-results/`，不接触生产。

## 未验证与发布状态

- 未使用实体 iOS／Android；系统键盘、安全区、真实移动网络切换、长时间锁屏／后台、耗电和持续稳定性未验证。
- 未完成真人浏览器多人整局到胜利。规则机器人完整局、夹具终局和真实联机初始化分别覆盖不同层级，不能互相替代。
- 未合并、未公网发布，没有修改现有阿里云／Cloudflare main 自动部署链；实际线上版本、生产房间恢复和公网延迟均未据此确认。
- 海外聊天与自定义昵称仅保留海外行为；国内仍采用既有固定昵称与无交流策略。巫师牌的按钮修复在其独立仓库验证，不把其测试计入卡坦岛的通过数。
