# 卡坦岛 · 好友桌

> 原作者：[Jack15678](https://github.com/Jack15678)，上游：[Jack15678/catan-friends](https://github.com/Jack15678/catan-friends)。本 Fork 保留原提交历史与 upstream 关联，由 qiuh23 为现有好友游戏大厅适配双部署。用户确认已获朋友授权并明确跳过邮件核对；本次未新增或宣称开源许可证，仍按原项目个人非商业娱乐说明使用。
>
> **当前状态：未上线。** 两个大厅入口均关闭。Node/Worker 的本地验证不等于生产验收；生产配置、部署、合并和入口启用均待用户确认。

本地目录为 `C:\Game\CatanFriends`，与 `MagicalAthlete-catan`、`WizardFriends-catan` 并排，后两者为最新 main 的独立工作区，原工作区保留。

接入与运维文档：

- [自动发布、密钥与门禁](docs/automatic-deployment.md)
- [阿里云首次配置、空间轮转与回滚](docs/aliyun-deployment.md)
- [集成验收与生产待办](docs/integration-verification.md)


可在浏览器游玩的 3–4 人卡坦岛基础版。中文界面、低多边形 3D 岛屿、房间码联机、电脑练习与断线恢复。

## 本地启动

需要 Node.js 22 或更新版本。

```powershell
cd 'C:\Game\CatanFriends'
npm install
npm run dev
```

打开 **http://localhost:5175**。一个进程同时运行 Vite 页面与 WebSocket 房间服务。

输入昵称后可以：

- **创建好友房间**：复制邀请链接给朋友。3–4 人准备后由房主开局，可用电脑补齐座位。
- **加入房间**：输入 6 位房间码，或打开邀请链接。
- **先和电脑练一局**：创建独立房间，自动加入两名电脑玩家并开始对局。

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

首版范围为经典基础版。先手按房间入座顺序决定；采用自由交易/建造顺序。电脑是基础策略，未实现扩展版、观战、回放或自动接管掉线真人。开发模型为程序化 Three.js 几何，目前没有 `.blend` 文件。

## 联机设计

与用户指定的两个项目一样，把身份、房间传输、规则引擎和个人视图分开。详细对照见 [docs/architecture.md](docs/architecture.md)。

- 服务端唯一裁决骰子、牌堆、资源、交易与胜利。浏览器只提交意图。
- 每位玩家只收到自己的手牌和发展卡；其他玩家只显示公开数量与公开分数。
- 客户端凭证由随机数生成，留在浏览器本地；服务端保存 SHA-256 摘要。凭证通过 WebSocket 首条消息发送，不放进邀请 URL。
- 操作带唯一 ID 和期望版本；按房间串行执行，去重最近 256 次成功操作，拒绝旧版本写入。断线重发保留原 ID。
- Node 每次确认操作前将房间写入 `.data/房间码.json`，临时文件替换保证存档写入完整。重启后按需加载。
- 刷新或网络恢复自动回到原座位。全部真人离线后电脑停止行动；房间在最后活动后保留 48 小时。

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

Fork 的生产发布使用上述检查产物链，并默认关闭生产门禁；请勿同时启用 Native Builds 或运行手动 `npm run deploy` 覆盖生产。保留原手动命令仅供上游参考和明确授权的独立环境使用。当前交付只运行本地服务和本地模拟，未执行公网部署。云端房间状态写入 Durable Object 存储，电脑回合由 alarm 驱动，WebSocket 使用休眠接口。

## 验证

```powershell
npm test
# 以下两项需要 npm run dev 正在运行
npm run test:browser
npm run test:multiplayer
# 需要 npm run worker:dev 正在运行
npm run test:worker
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
