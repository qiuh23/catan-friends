# 2026-11-05 首次生产配置与发布记录

本文记录北京时间 **2026-11-05 21:41** 首次发布完成后的事实与验收边界。后续发布或验收结果应追加日期、完整 SHA 与对应运行记录，不能把这里的快照当作实时状态。

## 当前结果

用户确认已获朋友 Jack15678 授权，并明确要求跳过邮件复核；本次保留原作者、upstream 和原提交历史，没有新增或推定开源许可证。随后用户明确批准合并、生产配置与部署，并允许在真实验收通过后启用大厅入口。

| 项目 | 已核实结果 |
| --- | --- |
| Catan 合并 | [PR #1](https://github.com/qiuh23/catan-friends/pull/1)，main `1cebfe1cd7fbd328131f72acb488c3621554c0bd` |
| 必要检查 | [Checks 42036916669](https://github.com/qiuh23/catan-friends/actions/runs/42036916669)，main push，成功 |
| 首次发布 | [Deploy checked Catan backends 42037701133](https://github.com/qiuh23/catan-friends/actions/runs/42037701133)，手动选择上述 Checks，成功 |
| 阿里云入口 | [catan.magical-athlete-online.cn](https://catan.magical-athlete-online.cn)，health、网页 build-info 与无房间 WSS 的 revision 均为上述完整 SHA，backendId=aliyun |
| Cloudflare 入口 | [catan-friends.qiuh23.workers.dev](https://catan-friends.qiuh23.workers.dev)，相同完整 SHA，backendId=cloudflare；独立 ROOMS/CatanRoom 与 SQLite DO 存档 |
| 国内服务 | catan-friends active、开机 enabled，运行用户 catan-friends，监听 127.0.0.1:3005；当前代码位于 `/opt/catan-friends/releases/1cebfe1cd7fbd328131f72acb488c3621554c0bd-42036916669` |
| 国内持久目录 | `/var/lib/catan-friends`，独立于代码；不与另外两个游戏共用身份或房间 |
| DNS / TLS | catan A → 现有 ECS；证书有效至 **2027-02-03 20:31:43**，复用原 ACME 账号，没有购买服务 |
| GitHub production | 仅允许 main，七项目标/角色变量与加密 CF secret 已配置；仓库变量 CATAN_PRODUCTION_ENABLED=true |
| RAM | catan-friends-production-deploy，最大会话 3600 秒、控制台登录关闭；仅附加 CatanFriendsProductionDeploy；实际 trust、实例 ARN 和 CommandRunAs 已回读匹配 |
| 专用 CF token | catan-friends-production-ci，active，账号 Scripts 读取已验证；到期 **2027-11-05 23:59:59**。仅账号级 Workers Scripts Edit，并非单 Worker 的云端强制隔离 |
| 大厅 | [运动会 PR #52](https://github.com/qiuh23/magical-athlete-online/pull/52) 已合并；[成对发布 42037416511](https://github.com/qiuh23/magical-athlete-online/actions/runs/42037416511) 自动成功，两大厅均为 `8add618b860f79e9d607926d622ff6a1d1d4ee8a`。三游戏卡片已发布，Catan 两项 enabled 仍为 false |

首次构建完成时 gate 尚为 false，对应 workflow_run 发布被正常跳过。随后完成用户批准的配置、启用 gate，并手动派发首次发布。因此首次成功证明了 GitHub OIDC → Catan 短期 STS → 固定 ECS/部署用户 → 主机接收器，以及预构建 CF 与 Node 两目标发布；**尚未证明 gate=true 后新的 main push 自动完成整条链**。下一次经过审核的文档 main 更新将用于验证这一点，不增加工作流或额外 CI 套件。

以上公网探针不创建房间。真实多人、个性化隐藏信息、邀请/跨服拒绝、断线/刷新、持久化恢复与带存档的发布/回滚验收正在进行。完成前保持大厅入口关闭。浏览器移动模拟与实体 iPhone/Safari/运营商网络验收分别记录，不把模拟结果写成实体设备结果。

## 发布唯一归属与 OIDC

已在实际 Cloudflare 控制台核实：Catan 的 Git 存储库显示“连接”，当前没有连接仓库或 Native Builds；BUILD_SHA 是上述 main，ROOMS 为独立 catan-friends_CatanRoom，限流 namespace 为 3005。Catan 两目标只由本仓库 `Checks → Deploy checked Catan backends` 负责。

运动会的 Native Builds “禁用构建”已勾选，继续由原 GitHub 成对链更新两大厅与运动会；巫师牌连接自己的 main 且未禁用 Native Builds，其 CF 和 GitHub 阿里云链分别负责各自目标。本次 Catan 发布没有重新发布巫师牌或运动会。初查 API 的 Builds 403 是历史读取限制，后续控制台核实消除了这三个开关的状态不确定性。

本仓库 GitHub OIDC 使用 immutable subject，必须匹配：

```text
repo:qiuh23@145330254/catan-friends@1447016080:environment:production
```

issuer 为 `https://token.actions.githubusercontent.com`，audience 为 `sts.aliyuncs.com`；沿用既有 provider，新建独立 Catan role/policy。裸仓库名的 `repo:qiuh23/catan-friends:environment:production` 不匹配当前真实声明，不能用它代替或放宽为通配符。新 Fork 必须读取自己的 repo/owner ID 与 OIDC subject，不能照抄此值。

RAM 只允许该现有实例上的 ecs:RunCommand，ecs:CommandRunAs=catan-friends-deploy，以及同实例读取执行结果。Cloud Assistant 可运行该非 root 用户的普通命令；只有 root 所有的固定 receiver 被 sudoers 允许。没有为 GitHub runner 放开 22，没有使用长期阿里云 AccessKey，也没有复用另外两个游戏的 role。

## 数据、空间与现有游戏边界

国内使用既有 40 GiB 系统盘。首次发布后的可用空间为 **25,056,333,824 字节**；这是时间点快照，尚无足够 24 小时跨度来声称测得增长速度。主机已实际运行独立 backup、storage 和 logrotate 检查，运行用户、外置数据目录与代码权限检查通过。

- 单包展开上限 256 MiB，压缩下载上限 128 MiB；代码保留 current、previous 和一个更早版本，只清理已识别的 Catan release。
- 私有 JSON 房间及配置备份保留最多 14 天、总量最多 256 MiB；预算会缩短保留期，不能把“14 天”当作无条件承诺。超预算应阻止发布并处理容量，不跳过备份。
- 每 15 分钟检查日志轮转与空间。日志超过 10 MiB 提前轮转，14 份压缩历史；copytruncate 有并发丢少量日志的窗口，单文件阈值也不是两次检查间的硬上限。
- 空闲不足 20% 或按可用增长样本预计不足 14 天时 warning；不足 10% 或不足 5 GiB 时 critical，发布在不足 5 GiB 时拒绝继续。告警写系统 logger，未额外配置外部短信/邮件。

原运动会、巫师牌、预览、旧 HTTP/IP/8080/8081、原数据和回滚目录保留。国内大厅仅增加精确的 catan SVG 白名单，先备份并在配置锁内完成 nginx -t/reload；没有开放任意目录。Catan 内部 3005 不开放公网，Nginx 覆盖转发来源头，应用仅信任直接回环代理送来的单个合法 X-Real-IP。

## 带存档发布与代码回滚验收步骤

下面是尚待执行并记录结果的受控验收。测试身份/隐藏手牌/token 及原始房间记录只留私有运维证据，不提交仓库。

1. 两服各自创建三个独立玩家的房间，完成初始落子与合法行动，记录每位玩家自己的公开/私有视图及确认 revision；原 origin 的邀请只回到创建服。保存精确身份和局面以核对恢复，但不把令牌放入 URL。
2. 两服测试房间准备好之后，才合并后续审核通过的文档 PR。观察新的 **main push Checks → workflow_run release**，确认 Node/CF 来自同一完整新 SHA，且没有 Native Builds/其他工作流同时发布目标。此步沿用原必要 CI，不增加远端浏览器或整局套件。
3. 重新连接原三个身份，逐人比较棋盘、回合、资源/发展卡、在线状态与继续行动；Node/CF 各自恢复自己的房间。普通代码更新不得覆盖 DATA_DIR 或 DO storage。Node 的实际服务重启恢复与 CF 持久化恢复分别记录。
4. 回滚之前，确认 current 指针和部署状态仍是这次新 SHA/Checks run，previous 恰为兼容的 `1cebfe1cd7fbd328131f72acb488c3621554c0bd`。通过固定 receiver 的 rollback 请求回退这次 Node 尝试；它要求 commit/runId 与 active attempt 匹配，不接受任意路径或其他游戏。首次发布没有 previous 时不得拿此步骤演练停服。
5. CF 代码回滚只选择已经记录的旧 immutable version；先读取当前版本及 BUILD_SHA，确认仍属于这次尝试，拒绝覆盖外部/更新的发布。不 force、不删除 Worker/namespace、不更改 v1/CatanRoom 绑定。遇到 DO 不兼容即停止人工检查。
6. 在旧兼容代码下再次检查两服原身份/私有数据及合法行动。随后通过正常受检查产物链**重新应用仍为当前 main 的新版本**，再做相同恢复核验。旧 1ceb 已不是 main 时，不能用“重新安装旧包”绕过 current-main 校验；它只能作为已记录 previous 的回滚目标。
7. 记录运行 ID、完整 SHA、CF version、前后 current/previous 指针与通过/失败项。两环境通过完整验收后，再按用户授权由大厅所在仓库的审核变更启用入口。门禁 true、一次部署成功或这份文档合并都不等于入口已验收。

普通代码回滚不恢复旧房间备份；期间新增的已确认动作必须保留。灾难恢复旧备份会丢失其后的动作，属于另一个操作，须先停 Catan、保存当前状态、在隔离目录验证完整 JSON/身份/隐藏信息与路径，再由操作者确认回退范围。不能把整个配置/备份包解到 `/`，不能恢复到另一个游戏目录。

详细的固定目录、archive/provenance 验证、原子切换与失败处理见 [阿里云手册](aliyun-deployment.md)；发布 gate、产物重试与首次无旧 CF 版本的边界见 [自动发布](automatic-deployment.md)；逐环境检查清单见 [集成验证](integration-verification.md)。
