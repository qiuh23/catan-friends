# 卡坦岛 · 好友桌

> 原作者：[Jack15678](https://github.com/Jack15678)，上游：[Jack15678/catan-friends](https://github.com/Jack15678/catan-friends)。本 Fork 保留原提交历史与 upstream 关联，由 qiuh23 为现有好友游戏大厅适配双部署。用户确认已获朋友授权并明确跳过邮件核对；本次未新增或宣称开源许可证，仍按原项目个人非商业娱乐说明使用。
>
> **2026-11-05 首次生产状态：双端已部署，大厅入口仍关闭，完整验收进行中。** 用户已批准合并、生产配置与部署。阿里云和 Cloudflare 均运行 `1cebfe1cd7fbd328131f72acb488c3621554c0bd`，HTTPS、静态资源、前后端版本和无房间 WSS 探针已通过；多人、恢复与发布回滚仍须分别记录。首次发布为受控手动触发，后续 main 的自动触发链待下一次发布验证。见 [生产记录](docs/production-rollout-2026-11-05.md)。

本地目录为 `C:\Game\CatanFriends`，与 `MagicalAthlete-catan`、`WizardFriends-catan` 并排，后两者为最新 main 的独立工作区，原工作区保留。

接入与运维文档：

- [自动发布、密钥与门禁](docs/automatic-deployment.md)
- [阿里云首次配置、空间轮转与回滚](docs/aliyun-deployment.md)
- [集成验收与生产待办](docs/integration-verification.md)
- [2026-11-05 生产配置、首次发布与回滚记录](docs/production-rollout-2026-11-05.md)


可在浏览器游玩的卡坦岛好友桌：默认 3–4 人基础版，可选完整的 2025 年第六版 5–6 人扩充、友善强盗和卡坦港口。中文界面、程序化 3D 岛屿、公开/私密房间、电脑练习和断线恢复。规则版本、组件、人数与其他拓展范围见 [资料库核对](docs/catan-reference-audit.md)，房间期限、测试、存档和发布回滚见 [本次交付](docs/room-rules-review.md)。

## 本地启动

需要 Node.js 22 或更新版本。

```powershell
cd 'C:\Game\CatanFriends'
npm install
npm run dev
```

打开 **http://localhost:5175**。一个进程同时运行 Vite 页面与 WebSocket 房间服务。

输入昵称后可以：

- **创建好友房间**：选择公开或私密、人数规则与可选变体；按对应人数准备后由房主开局，可用电脑补齐座位。公开真人房可从在线列表刷新、加入及原身份返回，私密/练习房不公开。
- **加入房间**：输入 6 位房间码，或打开邀请链接。
- **先和电脑练一局**：创建独立房间，按人数规则自动补足电脑玩家并开始对局。

同一台电脑测试真人联机，请使用不同浏览器或独立的浏览器配置/无痕窗口。同一浏览器中的同一房间会恢复同一个身份，新页面接管旧页面的座位。

同一网络内的朋友可访问 `http://这台电脑的局域网IP:5175`。需要从该地址建房/复制邀请，发出的链接才会指向朋友能访问的主机。服务监听 `0.0.0.0`，网络访问仍取决于系统防火墙和路由配置。`localhost` 链接只适用于这台电脑。

## 当前实现

- 19 块随机地形、54 个交点、72 条边、9 个港口；6/8 数字不相邻。
- 蛇形初始放置，两座村庄与两条道路，第二座村庄发放起始资源。
- 双骰资源生产，城市双倍产出，银行每种资源 19 张及库存不足处理。
- 7 点弃牌、移动强盗、随机抽取相邻对手资源。
- 道路/村庄/城市建造、距离规则、道路连接规则、棋子数量上限。
- 玩家之间的资源报价与接受，银行 4:1、普通港口 3:1、专属港口 2:1。
- 25 张发展卡：骑士、道路建设、丰收、垄断、隐藏胜利点；购买回合限制与每回合出牌限制。
- 最长道路、最大骑士军队、10 分获胜、结算及重新开局。
- 房间码、邀请链接、准备状态、聊天、在线状态、身份恢复与保存对局。
- 旋转/缩放/复位 3D 棋盘；二维备用棋盘支持键盘 Tab 和 Enter 操作。
- 桌面与手机布局；基础电脑策略，可建造、交易和使用发展卡完成整局。

基础版先手按房间入座顺序决定，采用自由交易/建造顺序，保留既有随机地图默认。5–6 人扩充使用 30 地块、11 港口、每种资源 24 张、34 张发展卡、六套棋子，以及 2025 配对回合：主玩家掷骰行动后，相隔三席的第二行动玩家可建造、银行交易、购买/使用发展卡及获胜，不再次掷骰或与玩家交易；之后下一位主玩家行动。两个小变体默认关闭，可与人数扩充组合。未实现其余大型拓展、观战、回放、续赛投票或自动接管掉线真人。所有模型为程序化 Three.js 几何，没有 `.blend` 文件，也未引入资料库官方图片。

## 联机设计

与用户指定的两个项目一样，把身份、房间传输、规则引擎和个人视图分开。详细对照见 [docs/architecture.md](docs/architecture.md)。

- 服务端唯一裁决骰子、牌堆、资源、交易与胜利。浏览器只提交意图。
- 每位玩家只收到自己的手牌和发展卡；其他玩家只显示公开数量与公开分数。
- 客户端凭证由随机数生成，留在浏览器本地；服务端保存 SHA-256 摘要。凭证通过 WebSocket 首条消息发送，不放进邀请 URL。
- 操作带唯一 ID 和期望版本；按房间串行执行，去重最近 256 次成功操作，拒绝旧版本写入。断线重发保留原 ID。
- Node 每次确认操作前将房间写入 `.data/房间码.json`，临时文件替换保证存档写入完整；启动扫描并恢复期限。Worker 复用同一 Room，SQLite 事务同时保存状态和 alarm，公开目录复用原 Durable Object namespace，不增加绑定或部署 migration。
- 等待阶段非房主主动退座释放席位，旧身份失效；对局中暂离和网络断线保留原座位。房主可开局前踢人、主动转交及确认解散；解散和暂离分开，关闭后旧链接不能复活。
- 普通真人房从房主最后一个有效连接离线起保留 30 分钟；主动暂停的真人房从本次暂停首次离线起固定最多 4 小时，短暂返回不顺延；个人练习离线后 10 分钟。普通在线闲置不关房；其他玩家/AI 活动不续房主离线期限。到期直接关闭、清私密数据并保存小型永久关闭标记，不使用旧 48 小时最后活动规则。

## 构建与运行

```powershell
npm run build
npm start
```

生产模式默认 **http://localhost:3005**，可通过 `PORT` 环境变量修改。页面和 WebSocket 同源，无需另配 API 地址。保留 `.data/` 即保留 Node 对局存档；该目录不进 Git。

## Cloudflare 入口

项目包含 Worker + Durable Objects 适配，使用同一套规则与房间控制代码。

```powershell
npm run build
npm run worker:dev
```

本地 Worker 地址 **http://127.0.0.1:8788**。验证打包：

```powershell
npm run worker:check
```

Fork 的生产发布使用上述检查产物链，并默认关闭生产门禁；请勿同时启用 Native Builds 或运行手动 `npm run deploy` 覆盖生产。保留原手动命令仅供上游参考和明确授权的独立环境使用。qiuh23 已经通过受检查产物链完成首次公网部署，当前账号的生产门禁为 true；新 Fork/新环境仍应缺省或设置 false，先配置并验权。云端房间状态写入 Durable Object 存储，电脑回合由 alarm 驱动，WebSocket 使用休眠接口。

## 验证

```powershell
npm test
# 以下两项需要 npm run dev 正在运行
npm run test:browser
npm run test:multiplayer
# 需要 npm run worker:dev 正在运行
npm run test:worker
# 3/4/5/6 人完整初始摆放、权限、隐私、重连和 Node 重启
node scripts/room-protocol-smoke.js
# 已启动本地 Worker 时，同一协议复核
$env:TEST_URL='http://127.0.0.1:8788'; node scripts/room-protocol-smoke.js
# 本地独立 Worker 进程重启，TEST_PLAYERS 可为 3、4、5、6
$env:TEST_PLAYERS='6'; npm run test:worker:restart
```

首次运行浏览器测试，如缺少浏览器，执行 `npx playwright install chromium`。截图输出到 `test-results/`。测试覆盖与已验证结果见 [docs/verification.md](docs/verification.md)。

## 代码结构

```text
shared/board.js       六边形拓扑、合法建造位置、最长道路
shared/game.js        游戏规则、个人视图、电脑策略
shared/room.js        身份、操作版本/去重、房间控制
server/index.js       Node HTTP/WebSocket 服务与磁盘存档
worker/index.js       Cloudflare Durable Objects 适配
src/board.js          3D 模型、点击射线、2D 备用棋盘
src/main.js           房间、对局、交易、手牌、聊天界面
src/connection.js     自动重连与操作确认
tests/               规则与真实 WebSocket 测试
scripts/             多浏览器与 Worker 实测脚本
```

3D 资产可在后续替换为 Blender 导出的 glTF，规则层与棋盘拓扑无需更改。当前所有模型和图标由代码绘制，没有运行时外部图像依赖。

## 参考

- [qiuh23/magical-athlete-online](https://github.com/qiuh23/magical-athlete-online)
- [qiuh23/wizard-friends](https://github.com/qiuh23/wizard-friends)
- [CATAN 官方基础版 FAQ](https://www.catan.com/faq/basegame)
- [CATAN 基础版规则与词典](https://cdn.svc.asmodee.net/production-unboxnowcom/uploads/sites/6/2022/02/catan_base_rules_2020_200707.pdf)

本项目按上级仓库约定，用于作者和朋友的个人非商业娱乐。
