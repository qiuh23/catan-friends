# 卡坦岛 · 好友桌

| 线路 | 游戏大厅 | 卡坦岛直达 |
| --- | --- | --- |
| 国内（阿里云） | [国内游戏大厅](https://magical-athlete-online.cn/) | [进入卡坦岛](https://catan.magical-athlete-online.cn/) |
| Cloudflare | [Cloudflare 游戏大厅](https://magical-athlete.qiuh23.workers.dev/lobby/) | [进入卡坦岛](https://catan-friends.qiuh23.workers.dev/) |

**线上核实于 2026-11-06 08:33（北京时间）：** 两个大厅的卡坦岛入口均已开启，两端 `/api/deployment` 与 `/build-info.json` 均返回 `061ee3eff1972205a8956eb4002d21671c15ff99`。本轮修改基于前两步合并后的 main `440ea04`；这些新功能尚未部署，线上举报配置接口当前返回 404。合并、发布成功及线上验收须分别确认。取证范围与本轮测试见 [交付记录](docs/random-chat-report-2026-11-06.md)。

3–4 人基础版，以及可选的 **5–6 人扩充（2025 配对回合）**。中文界面、程序化 Three.js 岛屿、好友联机、电脑练习、聊天与存档恢复。本文功能说明对应源码，线上版本以上述实际回读为准。

## 本地启动

推荐 Node.js 24（与生产一致；最低版本见 `package.json`）。

```powershell
npm ci
npm run dev
```

打开 **http://localhost:5175**。Vite 页面和 Node WebSocket 房间服务由同一个进程提供。输入昵称创建房间，把完整邀请链接发给朋友；或者用独立练习房与电脑游玩。建房时选择基础版或 5–6 人扩充、公开/私密及可选规则；开局前由房主调整设置，其他真人须重新准备。

同一台电脑测试多人请用独立浏览器配置或无痕窗口；同一浏览器的相同房间凭据会恢复原身份，新页面接管旧连接。局域网可访问 `http://本机局域网IP:5175`，邀请链接应从该地址复制，连通性取决于防火墙和路由。不同服务器的房间、身份与存档独立。

生产模式本地运行：

```powershell
npm run build
npm start
```

默认 **http://localhost:3005**；可通过 `PORT`、`HOST`、`DATA_DIR` 设置端口、监听与存档目录。Node 不自动加载 `.env`；示例见 [.env.example](.env.example)。保留整个数据目录，包括 `moderation/`。浏览器身份仍保存在原网站的本地存储中。

## 当前功能

- 基础版 19 地块、54 交点、72 条边、9 港口；随机数字的 6/8 不相邻，10,000 次生成失败时明确报错并回滚开局。
- 5–6 人扩充为 30 地块、80 交点、109 条边、11 港口、每种资源 24 张、34 张发展卡；沿用 A..Zc 环形数字次序，跳过两块沙漠，保留配对伙伴建设阶段。
- 蛇形初始放置、第二座村庄起始资源、双骰生产、银行库存不足处理、弃牌、强盗和按资源张数等概率抢牌。
- 道路/村庄/城市、玩家交易、银行/港口交易、发展卡、最长道路与最大骑士军队、结算及原房间再来一局。
- 可选友善强盗、卡坦港口；先手始终按入座顺序，不随机先手。
- 服务端权威随机：Web Crypto 种子、ChaCha20 随机流、无偏整数采样与 Fisher–Yates；秘密流与游玩结果在同一个房间事务中提交，失败/非法/重复请求不额外推进流。
- 身份恢复、请求去重与版本校验；普通房主离线保留 30 分钟，主动暂停首次离线固定最多 4 小时，练习离线 10 分钟。房主在线不会因普通闲置关闭。
- 玩家级聊天限流、独立聊天序号及去重；聊天不占棋盘版本，重连恢复历史，发送失败或确认期间继续编辑均保留输入。
- 聊天及设置内提供“隐私 / 举报”，消息显示编号并可定位举报；邮箱为用户已确认的 `qiutian0808@163.com`，由玩家确认发送邮件。站长使用独立权限人工处置，无自动审核或工单系统。
- 桌面/手机布局、3D 与可键盘操作的 2D 棋盘、公开行动提示及可中断镜头跟随。电脑使用基础策略。

## 隐私与站长处置

玩家仅收到自己的资源和发展卡；不公开其他玩家手牌、牌库顺序、恢复凭据摘要、随机密钥或流缓冲。客户端快照和站长查看使用字段白名单；服务端基础设施错误只返回固定说明，后台错误记录只含固定类别。

已确认默认：`REPORT_CONTACT=qiutian0808@163.com`，`MODERATION_RETENTION_DAYS=90`。普通聊天保留本房间最近 100 条、最长 7 天；必要人工查看/处置记录及证据保留 90 天，人工保全项持续至明确解除。消息隐藏、昵称替换和身份限制标记用于继续执行处置，关闭标记防止旧链接复活。备份轮转与恢复清理另见运维文档。这些是运行设置，不构成备案或适用要求已审核完成的声明。

站长权限需要独立的 `SECURITY_ADMIN_TOKEN`（32–256 位 base64url 字符）；缺失时返回 403。房主、玩家凭据均无此权限。Node 通过受保护服务环境配置，Cloudflare 使用 Worker Secret；真实密钥不得放进仓库、参数、网址、浏览器或日志。用法、保全/解除、容量与权限边界见 [随机、聊天与举报运维](docs/random-chat-report-operations.md)。

## Cloudflare 本地运行

```powershell
npm run build
npm run worker:dev
```

打开 **http://127.0.0.1:8788**。本地使用 `wrangler.local.jsonc`，房间和处置写入本机 `.wrangler/`，与生产不同。Worker 和 Node 共用规则、房间事务与个人视图；Worker 使用 SQLite Durable Objects、WebSocket 休眠和 alarm。

```powershell
npm run worker:check
```

此命令只做打包预演，不部署。

## 部署、迁移与回滚

沿用既有 GitHub Checks → 受检查双端产物发布链，目标仍为独立 Catan Node 服务与 `catan-friends` Worker；不新增远端 CI、Native Builds 或其他发布者。`npm run deploy` 保留为明确授权的独立环境手动命令，不能用它覆盖生产链。

**首次发布本改动前，需要更新主机上的 `ops/deploy.py`、`ops/backup.py`，备份房间与处置记录，并核实管理员密钥与运行配置。** 房间和发布产物升级到 state schema 3，旧房间在第一次加载时仅为后续随机操作增加安全流，原地图、手牌、牌库、座位、先手与进度保留。Cloudflare 不创建新类或命名空间。

工作流新增 `CATAN_STATE_SCHEMA=3` 发布准备门禁；与现有 `CATAN_PRODUCTION_ENABLED=true` 同时满足才发布。该仓库变量须在上述准备完成后设置，本 PR 不修改线上变量、主机文件或 Worker Secret。

代码回滚只允许回到支持 schema 3 的兼容版本，保留最新数据。首次跨版本发布缺少兼容旧版本时，自动回滚会拒绝降到不执行安全随机/聊天/处置规则的旧代码，需要发布兼容修复版本。不要删除随机字段、重播已确认操作、覆盖新存档或删除 Worker/DO 来“回滚”。详见 [迁移与回滚步骤](docs/random-chat-report-operations.md)。

既有资料：[发布链](docs/automatic-deployment.md) · [阿里云部署](docs/aliyun-deployment.md) · [历史首次发布](docs/production-rollout-2026-11-05.md)。历史记录的入口开关、版本及验收描述只代表当时。

## 本地验证

```powershell
npm test
npm run build
npm run worker:check
npm run test:secure-worker
npm run test:chat-report:browser
npm run test:node:restart
# 另开 npm run dev 后运行原有浏览器测试
npm run test:browser
npm run test:multiplayer
# 独立启动、杀进程、重开本地 Worker
npm run test:worker:restart
```

浏览器未安装时运行 `npx playwright install chromium`。截图在 `test-results/`；专项脚本使用临时数据并自动清理，不接触生产。实际通过、失败及未测试项单独记录于 [本轮验收](docs/random-chat-report-2026-11-06.md)。手机尺寸模拟不能代替真机 Safari、键盘与移动网络测试。

## 代码与来源

`shared/board.js` 管地图拓扑，`shared/game.js` 管规则和个人视图，`shared/random.js` 管随机算法，`shared/room.js` 管私有随机流、身份/版本/去重及聊天，`shared/moderation.js` 管处置白名单；`server/` 与 `worker/` 提供两端存储和网络。`src/` 提供棋盘及界面，`ops/` 与 `scripts/deploy/` 提供运维工具。`.data/`、`.wrangler/`、备份及测试产物不进 Git。

原作者：[Jack15678](https://github.com/Jack15678)，上游：[Jack15678/catan-friends](https://github.com/Jack15678/catan-friends)。本 Fork 保留原历史和 upstream 关联；作者已授权朋友间适配，未新增开源许可证，按原项目个人非商业娱乐说明使用。3D 为程序化几何，没有宣称 Blender 资产。

实现参考：[巫师牌](https://github.com/qiuh23/wizard-friends) · [胡闹运动会](https://github.com/qiuh23/magical-athlete-online) · [RFC 8439](https://www.rfc-editor.org/rfc/rfc8439) · [Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)。规则参考：[CATAN 官方 FAQ](https://www.catan.com/faq/basegame)。
