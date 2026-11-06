# 卡坦岛独立部署与生产审批手册

> 2026-11-06：以下首次生产状态是历史记录。当前源码的接收/备份/兼容回滚格式已升级到 schema 3；生产主机上的这些脚本需要另行更新，不能仅合并代码。当前回读与迁移要求见 [本轮记录](random-chat-report-2026-11-06.md) 和 [运维步骤](random-chat-report-operations.md)。

**2026-11-05 首次生产配置已按用户授权完成。** Catan 独立用户/目录/端口、固定接收器、备份/轮转/空间监测、DNS/HTTPS/Nginx、GitHub production 与专用 RAM role 已配置；受检查 main `1cebfe1cd7fbd328131f72acb488c3621554c0bd` 已从同一 [发布 42037701133](https://github.com/qiuh23/catan-friends/actions/runs/42037701133) 成功部署两端。国内服务 active 且 enabled，监听 `127.0.0.1:3005`，数据位于独立 `/var/lib/catan-friends`；卡坦岛证书有效至北京时间 **2027-02-03 20:31:43**。大厅入口仍关闭，完整联机/恢复/回滚验收进行中；后续 main 自动触发尚待实证。详见 [生产记录](production-rollout-2026-11-05.md)。

下面的初查表是配置前的历史快照，不能当作当前缺失项。操作清单保留为新环境/重建和维护说明；进一步生产变更仍按授权范围执行，不能从本记录推定其他环境已经准备完成。

## 2026-11-05 21:10–21:12（北京时间）配置前只读快照

| 范围 | 实际结果 |
| --- | --- |
| ECS | `115.29.188.62`，`ecs.e-c1m1.large`，运行中，2 GiB 级实例，约 1.21 GB 可用内存；不适合现场并行构建三个游戏 |
| 系统盘 | 购买容量 40 GiB；文件系统 41,882,943,488 字节，已用 14,646,562,816 字节，可用 25,300,643,840 字节（37% 已用） |
| 当前代码体积 | `/opt/magical-athlete` 约 6.07 GB，预览约 1.95 GB，巫师牌约 0.55 GB；本 PR 不清理这些目录 |
| 现有服务 | 运动会、运动会预览、巫师牌、Nginx 与 cron 均 active；卡坦岛 service、用户、数据/发布/备份目录不存在 |
| 内部端口 | `127.0.0.1:3000/3001/3002` 在用；候选 `127.0.0.1:3005` 未被占用，执行准备前仍须复核 |
| 公开端口 | 80、443、8080、8081 已监听并有安全组放行；22 仅受限来源；3005 不开公网 |
| DNS | 阿里云权威记录只有 `@`、`athlete`、`wizard` 的 A → `115.29.188.62`，TTL 600；没有 `catan` |
| 证书 | 大厅、athlete、wizard 三张证书均有效至 2027-02-02；certbot timer active；没有卡坦岛证书 |
| 有效 Nginx | `nginx -t` 通过；国内大厅精确公开资源白名单仍是 `art/(athlete|wizard)\.svg`，不会自动接受新插图 |
| 现有发布 | ECS 运动会 current 为 `dfb2dc9ef0234043797cbad9f50993212b8a835a`，巫师牌为 `1f564076d5794815eb72676e512314b1e1ade0a2`，预览为 `950403652b2334e7622b1b1c97137121f501dae6` |
| 云/仓库设置 | 运动会仓库 `AUTO_DEPLOY_ENABLED=true`，巫师牌 `ALIYUN_AUTO_DEPLOY_ENABLED=true`；卡坦岛仓库无发布变量，`production` environment 不存在；Cloudflare 卡坦岛 Worker 不存在 |
| 不能核实的项 | 现有 Cloudflare token 能读 Worker/绑定，读 Native Builds trigger 返回 403；不能据历史文档宣称当前已禁用，须有权限的管理员检查 |
| 有效期 | ECS 与系统盘到期时间为北京时间 2027-11-06 00:00，自动续费 false；域名 2027-10-25 到期。本任务不续费或购买 |

原始只读输出保存在本机 `C:\Game\catan-integration-audit\host-evidence.json` 与 `cloud-evidence.json`；不提交凭据、玩家数据或云 API 原始身份材料。状态会变化，生产操作前重新检查。

## 固定隔离范围与请求来源

卡坦岛使用 `https://catan.magical-athlete-online.cn`、独立服务/运行用户 `catan-friends`、发布用户 `catan-friends-deploy`、内部端口 3005。只操作以下目录：

| 用途 | 位置 |
| --- | --- |
| 代码 | `/opt/catan-friends/releases/<SHA>-<Checks run ID>`、`current`、`previous` |
| 配置 | `/etc/catan-friends/server.env`，root:catan-friends 0640 |
| 房间、身份、随机状态 | `/var/lib/catan-friends`，catan-friends 0700；在代码版本目录之外 |
| 日志 | `/var/log/catan-friends` root:adm 0750，固定日志 root:adm 0640；应用只使用 systemd 已打开的 stdout/stderr FD，不能替换日志路径 |
| 私有备份 | `/var/backups/catan-friends`，root 0700，归档 0600 |
| 发布锁/状态/空间监测 | `/var/lib/catan-friends-deploy-state`，状态文件 root 0600 |
| 固定安装器 | `/usr/local/sbin/catan-friends-deploy`，root 拥有，部署用户只能 sudo 此入口 |

运行用户无权写代码/日志目录；发布用户只能 sudo 固定安装器，不能读其他游戏数据/密钥。默认发布沿用已有 GitHub OIDC → 阿里云短期 STS → ECS 云助手通道，不开放 GitHub runner SSH 网段，不复用管理员密钥或另两游戏 RAM role。可选的管理员应急 SSH 另用独立 ed25519 公钥，写入 root 拥有的 `authorized_keys` 并固定 `restrict,command="/usr/bin/sudo -n /usr/local/sbin/catan-friends-deploy"`；该可选通道不在 Actions 工作流使用，不需为它扩大 22 安全组。

Node 仅绑定回环，`TRUST_PROXY=loopback` 只在直接对端为回环地址时接受单个合法 `X-Real-IP`。Nginx 用 `$remote_addr` **覆盖** X-Real-IP/X-Forwarded-For，清除 Forwarded/CF-Connecting-IP，不继承访客自带转发链。浏览器 Origin 精确匹配本服 HTTPS origin；两服不需要互相开放 CORS。Nginx 和应用分别限流，WebSocket 转发 Upgrade/Origin，100 秒读超时覆盖心跳。模板中的 `catan_api`/`catan_connections` 名称和端口都须先查冲突。

## 一次性配置清单和审批范围

需要批准的具体事项是：新增 `catan` DNS A 记录、申请该子域的免费 Let's Encrypt 证书、创建上述用户/目录/服务/备份/限权安装器、启用卡坦岛独立 Nginx 站点、添加卡坦岛专属 RAM/OIDC 发布 role 和 GitHub `production` environment 与独立发布 secrets/vars、创建 Cloudflare `catan-friends` Worker/专属 Durable Object 命名空间，最后发布已合并的受检查 main。现有实例与域名可复用，不需购买服务器。

新环境或重建的准备顺序如下。当前 qiuh23 的已完成项以本页顶部和生产记录为准；清单并非重复执行指令，首次主机/云设置不会由工作流自动猜测或重装：

1. 重新检查 `df -B1 /`、`free -b`、`ss -ltnp`、`nginx -t`、80/443 安全组和当前三个服务。确认 `3005` 空闲，当前数据/配置/指针备份可读。已有 80/443 放行，无需开放 3005 或新增公网游戏端口。
2. 在阿里云 DNS 添加 `catan A 115.29.188.62`，TTL 600，直连 ECS；不要把国内入口代理到 Cloudflare。用权威 DNS 查询验证生效，不用本机代理的合成地址判定 DNS。
3. 复用现有 GitHub OIDC provider，新增卡坦岛专属 role，信任的 audience 为 `sts.aliyuncs.com`、subject 精确限定 `repo:qiuh23@145330254/catan-friends@1447016080:environment:production`；不复用运动会或巫师牌 role。权限只给固定实例的 `ecs:RunCommand`、部署用户 `catan-friends-deploy`，及所需的调用结果只读查询。按阿里云当前支持的 condition key 验证实例/用户名限制，不支持的条件不能假装生效；若平台只能授权任意该用户命令，要明确这是受限非 root 用户的权限边界，sudo 仍只准固定安装器。提交并审核实际 RAM policy/正反拒绝测试后才启用，不存长期 AccessKey。
4. 审查精确提交的 `ops/` 文件，作为 root 执行 `bash ops/bootstrap.sh`。脚本只准备主机，不启动/启用服务、不启用 Nginx、不改 DNS/云权限、不下载依赖。依赖现有 `/opt/node/bin/node` 24、Python3、Nginx、logrotate、OpenSSH、sudo；缺项停止，不自动装软件或扩大权限。已有 env/站点文件保留。仅在另行批准应急 SSH 时才追加公钥路径参数；默认不写 authorized_keys。
5. 临时将 `ops/nginx-acme.conf` 复制到 `/etc/nginx/sites-available/catan-friends-acme`，只为本子域启用其 `sites-enabled` 链接；取现有 `/run/lock/game-sites.configure.lock`，先 `nginx -t` 再 reload。访问挑战路径自检后执行 `certbot certonly --webroot -w /var/www/catan-friends-acme -d catan.magical-athlete-online.cn`，使用已确认的运维邮箱与 ACME 同意项。该临时站只返回 ACME/503，不公开游戏。
6. 检查新证书、续期 webroot 和现有 renewal hook，使用 `certbot renew --cert-name catan.magical-athlete-online.cn --dry-run` 验证。确认成功后撤掉本次 ACME 链接，启用审查后的 `/etc/nginx/sites-available/catan-friends`；同一配置锁内 `nginx -t` 后 reload。保留其他站点、老 HTTP/IP/8080/8081 和全部预览。不直接重启 Nginx。
7. 填好 env，核对 `DATA_DIR`、`PUBLIC_ORIGIN`、`BACKEND_ID=aliyun`、`HOST=127.0.0.1`、`TRUST_PROXY=loopback`。GitHub environment 仅允许 main，按下表添加专用变量/密钥；不在仓库写私钥或把长期云凭据传给 ECS。
8. Cloudflare 管理员检查卡坦岛没有 Native Builds、Deploy Hook 或第二条直推发布链；如存在，先记录并禁用。当前控制台已核实 Catan 无 Git 仓库连接/Native Builds；初查 token 的 Builds 403 仅是历史读取限制，不能单独证明是否存在发布者。Worker 使用独立 `ROOMS`/CatanRoom DO，保留 `v1` 迁移标签，不删 namespace、不复用运动会/巫师牌 DO。
9. 用户合并 PR 后，等待精确当前 main 的 `Checks` 成功并产生有效产物。经生产发布授权后才设 `CATAN_PRODUCTION_ENABLED=true`，执行一次该成功 Checks run 的受控发布；后续 main 的成功 Checks 自然触发唯一 release 工作流。产物过期或 main 前进时重新检查最新 main，不发布旧包。
10. 先通过完整游戏验收，最后单独批准大厅开关与插图白名单更新。`systemctl enable catan-friends` 是验收后的显式步骤，确保实例重启后恢复；bootstrap 不自行设置。操作前后检查已有两游戏与预览的 SHA/连接保持正常。

| GitHub production 名称 | 类型与含义 |
| --- | --- |
| `CATAN_PRODUCTION_ENABLED` | **仓库级**发布 gate（job 开始前使用），新环境默认未设置/false；当前仓库已获授权为 true |
| `ALIYUN_ROLE_ARN` | environment 变量，卡坦岛独立 OIDC role ARN |
| `ALIYUN_OIDC_PROVIDER_ARN` | environment 变量，已核实的现有 provider ARN |
| `ALIYUN_REGION_ID` | environment 变量，`cn-hangzhou` |
| `ALIYUN_INSTANCE_ID` | environment 变量，已核实的现有固定实例 ID，不据地址猜值 |
| `CATAN_ALIYUN_ORIGIN` | `https://catan.magical-athlete-online.cn` |
| `CATAN_CLOUDFLARE_ORIGIN` | `https://catan-friends.qiuh23.workers.dev`，首次创建后核实 |
| `CLOUDFLARE_ACCOUNT_ID` | 已核实账户 ID；公开配置但不猜值 |
| `CLOUDFLARE_API_TOKEN` | 独立发布 token secret，最小 Workers Scripts/DO 发布权限；不要复用其他游戏凭据 |

Cloudflare API token 的实际目标限制由其权限产品支持范围决定；若只能按账户而非 Worker 细分，应明确告知管理员此边界，不能声称云端已有单 Worker 权限隔离。代码和流程固定 `catan-friends`，environment 只准 main，不授权第三方 PR 接触 secrets。阿里云链新增卡坦岛专属 role，不扩大已有两个游戏角色，也不放行 GitHub runner 到 22。

云助手以 `Username=catan-friends-deploy`、`WorkingDir=/tmp`、`KeepCommand=false` 执行固定命令模板：`printf '%s\n' '<有界base64 JSON>' | sudo -- /usr/local/sbin/catan-friends-deploy`。JSON 只含 action/SHA/run/artifact 身份和短期签名下载地址；不含 GitHub token 或云凭据。命令本身再做 Base64 内容编码，输出不回显命令/签名 URL。若云权限支持命令内容摘要条件，可增加该条件；每次签名 URL/SHA 不同，不能拿某一次整条动态命令的 hash 冒充永久固定模板授权。

## 大厅插图的现有主机增量

运动会仓库中的大厅及 `deploy/nginx-lobby.conf.template` 随原运动会发布链更新两端；卡坦岛更新不会发布另外两个游戏。模板改动不会自动安装线上 Nginx 文件。管理员需在批准后，仅将当前 `/etc/nginx/sites-available/magical-athlete-lobby` 白名单一处从：

```nginx
art/(athlete|wizard)\.svg
```

改为：

```nginx
art/(athlete|wizard|catan)\.svg
```

改前另存该文件及 root-only 配置备份，取 `game-sites.configure.lock`，运行 `nginx -t` 成功后 `systemctl reload nginx`。若失败恢复原文件并重新检查，不动其他站点。此增量只允许一张公开 SVG，不开放任意目录或游戏/API路径。未安装时卡坦岛插图可能 404，应在验收时发现。该一行白名单增量已在本次授权配置中应用，并通过 Nginx 检查与 reload；入口开关仍保持关闭，待两环境验收后由独立 PR/配置批准开启。

## 自动发布校验、失败与数据安全

`Checks` 在 PR 和 main 上执行必要网络/部署契约测试、一次前端构建、Worker dry-run；只有 main push 生成 Node 与 Worker 两份不可变产物。`release.yml` 是卡坦岛两目标唯一自动发布入口，串行且不中途取消切换。它检查仓库/工作流 ID、成功 Checks、push/main、精确当前 main、唯一未过期产物与 GitHub SHA256，发布相同 SHA 的预构建包；ECS 不执行 npm 安装或编译。

主机再次从 GitHub 公共只读 API核对当前 main、Checks workflow ID/run、仓库 numeric ID、artifact ID/digest/run 归属；API 不可用/限额时停止。下载仅允许 HTTPS GitHub Actions 的签名 Azure Blob 主机，无重定向、用户信息、非默认端口或 fragment。ZIP 必须只有 `catan.tar.gz` 和标准 SHA256 文件；tar 只准 `dist/server/shared/node_modules/package*.json/release.json`，拒绝链接、设备、路径逃逸、重复成员、`.data` 和异常体积。manifest 必须为 Linux x64/Node24/stateSchema3 和精确 SHA/run。包内脚本从不以 root 运行。

主机备份数据后切换 `current`，重启**卡坦岛**，验本地 health 与前端 revision；失败自动切回旧代码。远端链还验 HTTPS、前后端 SHA、backendId、无需建房的 WSS marker；失败走精确当前尝试的回滚。首次无旧代码时回滚停止卡坦岛并撤掉 current，独立站点返回不可用，不会改为其他游戏或跨服。GitHub 重跑 Checks 可能保留 run ID；同一 SHA/run 的旧目录只在与重新验证下载包的完整文件树/摘要一致时复用，不覆盖它。若该版本已经 current，验健康后幂等结束，保留原 previous；若上次已回滚，可重试这个已重新核验的不可变包。

安装器从不删除/覆盖 `/var/lib/catan-friends`，不把存档放进 release。代码回滚只切代码；`stateSchema:3` 是当前源码兼容闸门，未来不兼容结构须先提供兼容方案/迁移审批，禁止只修改标签绕过校验。Cloudflare 版本回滚保持 DO namespace 与数据；首次无历史版本时自动删除 Worker 会影响资源，工作流应报告需要管理员处理并保持入口关闭。

## 40 GiB 空间、备份与告警

卡坦岛单个展开发布包上限 256 MiB，保留 current、previous 和一个更早版本；压缩下载上限 128 MiB。成功切换后只清理本项目已识别的旧 release，不清另外两个游戏或预览。备份保留最多 14 天且总量最多 256 MiB，预算压力会缩短保留期，任何一份超过预算则报错并阻止发布，不能默默跳过备份。该预算适合目前小型 JSON 房间；增长后先由管理员批准异机备份，不购买存储或直接扩大磁盘。

Node 每房间原子写入 JSON；每日和发布前备份逐文件读取并验证完整 JSON/version1，包含身份、隐藏手牌、随机状态和 root-only env/配置。每个房间是某个完整已保存 revision；多个独立房间不承诺同一毫秒全局快照。不复制 `.tmp`。备份私有且不能通过 Nginx 访问，恢复时不能给玩家公开归档。

日志每 15 分钟检查轮转，单文件超过 10 MiB 提前轮转，最多保留 14 份压缩历史。`copytruncate` 避免为日志中断对局，但存在少量并发日志丢失窗口，因此这些是运维日志，不冒充需长期保留的安全审计证据；本项目不修改现有两个游戏的六个月安全记录策略。持续高流量下日志最多仍可在两个轮转检查间增长，不能把 10 MiB 当作硬配额。网络日志不记 URL/query、Cookie、Authorization、昵称或手牌。

空间监测每 15 分钟记录本项目大小、主机空闲空间、至少 24 小时跨度的平均增长，以及达到 5 GiB 安全线的估计天数。低于 20% 空闲或按当前平均增长不足 14 天时 warning；低于 10% 或不足 5 GiB 时 critical，并通过系统 logger 写告警；部署在不足 5 GiB 时拒绝继续。查看 `journalctl -t catan-friends` 与 `/var/lib/catan-friends-deploy-state/storage.json`。这不是已配置的外部通知：若需要短信/邮件，另列权限与目的地请求批准。

例：若新增净增长 100 MiB/天，当前约 25.3 GB 空闲到 5 GiB 安全线约有 190 天；这是算例，不能当作测得增长。现有服务的大 release 历史也会占盘，本 PR 保留其回滚能力，不擅自清理。主机增长应连同三项目监测；突增和用户保留的手动归档可能早于线性预测耗尽空间。

## 回滚、恢复与验收

手动代码回滚通过同一受限云助手用户调用固定安装器，base64 JSON 为 `{ "action":"rollback", "commit":"当前尝试完整SHA", "runId":当前尝试Checks编号 }`。只准回滚这个精确尝试，不接受任意路径/其他游戏名。回滚后复验卡坦岛 HTTPS、WSS、前后端 SHA，保留当下数据。修改 env/Nginx 则从本次 root-only 配置备份单独恢复，并取配置锁、`nginx -t` 后 reload；同步修正仓库配置防止下次发布再次切回。

灾难恢复单独审批恢复范围：先暂停新操作并停卡坦岛，完整保存当前数据与配置，选定私有备份，逐项校验归档路径只属于 `snapshot/rooms` 与预期配置；在新临时目录解包、检查所有 JSON/schema，管理员确认回退会丢失备份后的动作后才替换卡坦岛数据目录，修复 owner/mode 后启动。不要将备份整包直接解到 `/`，不要恢复另一游戏。恢复旧数据与代码回滚是不同操作，自动发布不会执行数据恢复。

本地已执行 `ops/test_deploy.py` 10 项离线安全检查（Linux WSL 全通过）：包含恶意包/来源拒绝、精确回滚、发布目录允许运行用户遍历、发布状态写失败不停止旧服务/切换指针、失败发布切回代码仍保留最新房间文件、同一 SHA/run 安全重试/幂等及篡改目录拒绝、私有房间备份在独立临时目录恢复。它们使用模拟网络/服务和临时文件，未接触生产状态。`bash -n ops/bootstrap.sh` 通过。

另在本地 WSL Linux 用官方 SHA256 核验过的 Node24.22.2，执行新工作区的 `npm ci`、前端构建、Worker dry-run、Linux package，再将实际 4,790,989 字节 tar 的 ZIP交给本机接收器解包校验；通过后从解包产物以外置 DATA_DIR 启动 Node，health/资源 revision、HTML200、无房间 WSS marker 均通过。该开发包取自未提交工作树，标记为当时 HEAD `b0db91f99be03bd5f30b66d32ba0afc7addc80cd`/测试 run123，仅验证打包/接收/启动契约，不是检查通过的正式 main 产物。这段仅描述当时本地烟测边界；后续已通过真正 production OIDC/云助手发布与主机安装，相关完整 SHA、服务与公网结果见生产记录，不把本地 smoke 当作线上证据。

生产完整验收正在进行，仍须逐端实测建房/加入/邀请、至少多个真人同步与隐藏信息、断线/刷新、进程重启后原身份/原存档、合法动作与错误配置、伪造转发头/Origin 拒绝、HTTPS/资源/WSS、发布失败回滚；两服独立房间与 token 不跨 origin，邀请指向原服务器且错误服提示不能静默入另一房。再检查大厅两服切换、三个游戏桌面/手机、旧链接/预览/两旧游戏不受影响。真实设备/运营商网络与线上存档恢复未做时明确待验，入口继续“未上线”。
