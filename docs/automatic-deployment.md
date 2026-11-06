# 卡坦岛自动发布与一次性配置

> 现行站点方案：国内 `SITE_EDITION=cn`，固定建筑/艺术昵称且完全禁用玩家交流、交流处置及访问/连接安全审计，保留故障和游戏数据；海外 `SITE_EDITION=global` 保留自定义昵称/聊天。两站入口、身份与邀请码独立。国内需安装 `access_log off` 的 Nginx 模板和仅故障日志的轮转配置，停用本游戏旧审计任务；现有备份/磁盘故障监测继续保留，历史私有审计不删。下述旧聊天/昵称/安全审计行为仅适用于海外，历史部署快照不证明新方案已上线。构建、接收器更新与验证见 [站点策略](site-editions.md)。


> 2026-11-06：当前源码升级至 state schema 3，新增 `CATAN_STATE_SCHEMA=3` 准备门禁，并要求先更新主机接收器/备份脚本。下文首次发布描述为历史快照；当前线上回读见 [本轮记录](random-chat-report-2026-11-06.md)，迁移与兼容回滚见 [运维步骤](random-chat-report-operations.md)。

**2026-11-05 21:41 首次发布快照（北京时间）：** [PR #1](https://github.com/qiuh23/catan-friends/pull/1) 已按用户授权合并，main `1cebfe1cd7fbd328131f72acb488c3621554c0bd` 的 [Checks 42036916669](https://github.com/qiuh23/catan-friends/actions/runs/42036916669) 与 [首次双端发布 42037701133](https://github.com/qiuh23/catan-friends/actions/runs/42037701133) 成功；两端公网 SHA/HTTPS/资源/WSS 已回读。production environment、专用 RAM role/policy 与加密 CF secret 已配置；仓库 `CATAN_PRODUCTION_ENABLED=true`。首次发布为手动选择当前 main 的成功 push Checks；后续 main 的自动 `workflow_run` 尚待下一次发布实证。大厅卡坦岛入口仍关闭，完整验收进行中。详见 [生产记录](production-rollout-2026-11-05.md)。

新 Fork/新环境的安全默认值仍是不设置门禁或 `false`；本仓库的实际 true 是完成用户审批和配置后的状态，不代表其他环境已获准发布。下文保留新环境准备与维护规则。

## 唯一发布链

`PR → Checks（无生产凭证）→ 合并 main → 当前 main 的 push Checks 成功 → Deploy checked Catan backends → production 环境 → Cloudflare 预构建 Worker + 阿里云已验证 Node 包 → HTTPS/前后端版本/资源/WSS 检查`。

Checks 仅运行针对性的网络/部署/入口契约、Vite 构建和 Worker dry-run。完整规则/多浏览器测试在本地执行。只有 main push 生成两个一天保留期的产物：`node-<完整SHA>` 和 `worker-<完整SHA>`，包含当前提交和 Checks run 的发布清单。发布器使用受信 main 控制代码，校验仓库与仓库数字 ID、workflow 数字 ID、push/main、成功状态、当前 main SHA、唯一产物、GitHub ZIP SHA-256、内部清单及解包边界；排队后、CF 发布前、Node 安装前和主机切换前再次核对。PR/fork/手动 Checks、旧 main、过期或替换产物均不能发布。

生产发布串行且不取消正在切换的服务。Node 只装预构建 Linux Node24 生产依赖；主机不运行 npm 安装/构建脚本。Worker 使用已验证 bundle 和海外静态资源 `--no-bundle` 发布，不重建应用代码。目标硬编码为 catan-friends，不能通过 payload 选择其他游戏、服务、任意命令或数据目录。

大厅属于运动会仓库，继续使用原 `Checks → Deploy checked backends` 更新两大厅。卡坦岛更新不会调用运动会或巫师牌部署。巫师牌已有按服务器返回大厅的链接，无需修改它或增加 PR。

## 获准后配置 GitHub / 阿里云

在 `qiuh23/catan-friends` 创建 `production` Environment，限制 main 发布；可配置受信审查人，若不设置每次人工批准，则门禁启用后每个符合条件的 main 自动发布。禁止 PR 获得 production 凭证。为 main 配置必要 Checks 的合并规则，勿把完整游戏/浏览器测试增加为默认远端 CI。

沿用现有阿里云 GitHub OIDC Provider（先核实 ARN 与 audience，不创建重复 Provider），新增**卡坦岛专用 RAM role/policy**，不能复用运动会/巫师牌角色。信任条件必须固定：

```json
{"oidc:iss":"https://token.actions.githubusercontent.com","oidc:aud":"sts.aliyuncs.com","oidc:sub":"repo:qiuh23@145330254/catan-friends@1447016080:environment:production"}
```

当前仓库启用了 GitHub immutable OIDC subject：账号与仓库均带数字 ID。上例是本仓库实际回读值；新 Fork 必须读取自己的 subject customization 与真实 token 声明，不能照抄 ID、退回旧的裸仓库名示例或使用通配符。当前专用角色为 `catan-friends-production-deploy`，仅附加 `CatanFriendsProductionDeploy`，信任及权限已回读匹配，最大会话 3600 秒且控制台登录关闭。

权限只允许现有 ECS 的 `ecs:RunCommand`，且 `ecs:CommandRunAs` 精确为 `catan-friends-deploy`，以及同实例 `ecs:DescribeInvocationResults`。不授予 root 运行、其他实例、RAM 修改、云密钥读取或其他游戏发布权。主机该用户仅 sudo 固定 catan-friends 接收器；接收器将请求作为数据核验，不执行请求提供的命令。GitHub 使用 OIDC/STS 短期凭证经现有 Cloud Assistant 送达，**无需开放 SSH 入站或给 GitHub runner 放宽 22 端口**。

`CATAN_PRODUCTION_ENABLED` 必须是 **Repository variable**：job 的 if 在进入 Environment 前计算，不能只放在 Environment 中。其余目标/角色变量放 production Environment（值须从实际已核验资源复制）：

| 变量 | 用途 / 拟定值 |
| --- | --- |
| `CATAN_PRODUCTION_ENABLED` | 新环境不设置或 `false`；当前 qiuh23 仓库经批准已为 `true` |
| `ALIYUN_REGION_ID` | 现有 ECS 实际地域（本次核查杭州，仍应以实例配置为准） |
| `ALIYUN_INSTANCE_ID` | 现有实例 ID |
| `ALIYUN_ROLE_ARN` | 新卡坦岛专用角色 ARN |
| `ALIYUN_OIDC_PROVIDER_ARN` | 已有受信 Provider ARN |
| `CLOUDFLARE_ACCOUNT_ID` | 已核验账号 ID |
| `CATAN_ALIYUN_ORIGIN` | `https://catan.magical-athlete-online.cn`，无尾斜杠 |
| `CATAN_CLOUDFLARE_ORIGIN` | `https://catan-friends.qiuh23.workers.dev`，无尾斜杠 |

当前专用 CF token `catan-friends-production-ci` 已通过 active/account Scripts 读取核验，加密保存于 production environment，有效至北京时间 **2027-11-05 23:59:59**。它只有所选账号的 Workers Scripts Edit，仍属于账号级权限边界，未声称仅能写 Catan 一个脚本。

唯一新增的生产发布 secret 为专用 `CLOUDFLARE_API_TOKEN`；阿里云不使用长期 AccessKey 或 CI SSH 私钥。主机 bootstrap 可保留管理员批准的可选应急受限 SSH 公钥，但自动链不依赖它。

## 获准后配置 Cloudflare

核对账号套餐、Workers 子域、SQLite Durable Objects 与限流 binding 可用。首次由上述链创建 `catan-friends` 和独立 `ROOMS/CatanRoom` 命名空间，保留 upstream `v1` SQLite migration；以后不得重命名服务/类、删除 binding、删 namespace 或重新初始化房间。已有运动会/巫师牌的 Worker、数据及预览均不改。

为卡坦岛创建单独 API token，具备该账号 Workers Scripts Edit 和本项目发布所需权限。Cloudflare 常规 Scripts Edit 授权在账号级；不能把单独 token 描述为云端强制只可写一个 Worker。隔离措施是独立 secret/environment、固定 Worker/绑定与受信代码；需要更强的云端隔离时应另行设计账号/受控发布代理并取得用户批准，不能扩大当前 token 权限后声称完成了脚本级隔离。

`wrangler.jsonc` 固定正式 origin/服务器标记，`CATAN_RATE_LIMITER` 使用独立 namespace `3005`（120 请求/60秒），配置时再确认没有其他服务复用它。Cloudflare 原生限流按边缘位置计数，是尽力限流，不是全球精确配额；绑定缺失、错误或调用失败时生产游戏 API 关闭。参考 [Cloudflare Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。本地使用 `wrangler.local.jsonc`、不同 namespace，避免正式 origin 被 localhost 冒用。

**不要为卡坦岛连接 Native Builds、Pages 或第二个生产发布 workflow。** 初查 token 对 Builds 查询返回 403；后续已在实际控制台核实：Catan 的 Git 存储库显示“连接”，没有连接仓库或 Native Builds，唯一发布者是上述 GitHub 链。运动会的“禁用构建”已勾选，沿用 GitHub 成对发布；巫师牌连接自己的 main 且“禁用构建”未勾选，CF Native Builds 与其独立 GitHub 阿里云流程各自只负责一个目标。不要为验证 Catan 改动这些既有分工。GitHub source 对 `workflow_run` 的安全边界见 [GitHub 官方说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)。

## 首次发布与验收顺序

1. 用户批准后，按 [阿里云手册](aliyun-deployment.md) 准备隔离服务、存储、DNS、证书、反代和运维脚本；这些首次配置不是工作流自动猜测或代办的动作。
2. 配好上述角色、Environment 和 CF token，确认无重复发布目标；审查并合并 PR，运行 main Checks。工作流可先保持门禁 false，只构建产物。
3. 准备两端真实 origin 后，经批准开启 `CATAN_PRODUCTION_ENABLED=true`。若 main Checks 已完成，可手动触发发布并传其 `checks_run_id`；只接受仍为当前 main 的成功 push Checks。一天产物过期时重新运行原当前 main push 的 Checks，重新生成并校验产物（覆盖仅限同一 run 的同名产物）；不能绕过摘要校验或用任意旧包。
4. 自动非建房探针通过后，按 [集成验收](integration-verification.md) 对两端分别进行真实多人、恢复与失败回滚验收。门禁开启不代表大厅已启用，卡坦岛入口一直关闭。
5. 两端分别完成验收、用户再批准后，在运动会大厅 PR 中按环境启用卡坦岛 `enabled`；沿用大厅现有发布链。

## 回滚与迁移

发布前主机为当前房间和独立配置备份，服务只在切换阶段短暂停止，原房间目录从不包含于发布包。Node 新版本启动/健康失败会恢复上一代码指针；两端后续公开检查失败则仅回滚本次记录的 Node/CF 代码版本。Node 以 commit/runId/current 指针约束回滚，CF 以本次不可变 version ID 和 BUILD_SHA 约束回滚，遇到更新的外部部署拒绝覆盖。

首次 CF 发布尚无上一版本、或发布失败而无法安全记录本次版本时，保留该 dormant Worker 并报告，**不通过删除 Worker/DO“回滚”**；大厅保持关闭。DO 不兼容的版本回滚须停止并人工检查，不能 force 或回滚数据。普通代码回滚永远不恢复旧存档覆盖最新对局。

2026-11-06 源码采用 state schema 3：房间根字段保存私有随机流，增加独立聊天去重/玩家限流及处置记录。旧房间加载时补一次安全流，保留既有牌库、地图、座位和进度。发布前更新主机接收器和备份脚本；只允许回滚同 schema 的兼容代码，详见上述运维步骤。两服身份/房间仍独立，不能把跨服复制当迁移。
