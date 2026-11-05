# 卡坦岛集成验证与生产待办（2026-11-05）

## 当前交付状态

Fork：[qiuh23/catan-friends](https://github.com/qiuh23/catan-friends)，原作者与 parent 为 [Jack15678/catan-friends](https://github.com/Jack15678/catan-friends)。起点为 upstream/main `b0db91f99be03bd5f30b66d32ba0afc7addc80cd`；保留原提交历史，不添加许可证。用户确认作者为朋友并明确要求跳过邮件授权核对；无需继续查邮件。

已从各自最新 main 建立并排工作区：`C:\Game\CatanFriends`、`C:\Game\MagicalAthlete-catan`、`C:\Game\WizardFriends-catan`。另两仓库原工作区及其功能分支保留。运动会起点 `dfb2dc9ef0234043797cbad9f50993212b8a835a`，巫师牌起点 `1f564076d5794815eb72676e512314b1e1ade0a2`。

卡坦岛尚未生产上线，两个大厅的 `catan.enabled` 均为 false，显示未上线。GitHub Actions 已只读确认 enabled；卡坦岛生产 variables 为空，production environment 不存在，没有设置生产密钥、RAM role 或启用门禁。

## 已实施

- 原 Node 与 Worker/Durable Objects 后端、规则与 version1 存档格式继续使用。Node 正式环境固定回环地址、独立外置数据目录、精确 HTTPS Origin；仅在显式 loopback 代理模式时接收本机 Nginx 覆盖的单个合法 X-Real-IP，其余转发头不参与身份/限流。
- Worker 固定 cloudflare 标识与正式 origin，专用原生限流绑定，配置缺失失败关闭。与 Node 不共享房间、身份或存储；本地 Wrangler 配置单独隔离。
- A-/C- 邀请房码与来源匹配；错误服务器阻止进入并显示提示，不自动跨服；同源旧裸码可用。邀请只携带公开房间码，不携带 token/hash/任意 backend。卡坦岛不支持观战，相关邀请明确拒绝。
- 主页增加对应服务器的原大厅返回链接、上游作者署名和个人非商业说明。大厅复用运动会 `lobby/`，完整扩展三游戏配置/路由/名称/邀请/资源白名单和测试。
- 单一受检查 main 成对自动发布链、默认关闭门禁、OIDC/STS 与专用云助手身份、校验产物与安全解包、独立 root-owned 代码发布、数据外置、代码失败回滚和有界备份/日志/空间监测模板。

## 本地验证

| 范围 | 结果与实际验证内容 |
| --- | --- |
| 卡坦岛 `npm test` | 29/29：规则、完整电脑对局、隐藏资源/发展卡/牌堆、真实三人 WS、重连、重复指令、Node 重启存档恢复与房间隔离；另含服务器前缀、Origin、伪转发头/真实代理限流、Worker 错配置及发布来源/摘要/恶意归档/回滚保护 |
| Vite 构建、Worker dry-run | 通过；Wrangler 固定为 lock 已解析的 4.157.0，正式部署使用相同版本，无新运行时依赖 |
| `scripts/browser-smoke.js` | 桌面/手机、电脑练习完整初始落子、掷骰、刷新原房、指南、2D/3D 切换，无页面错误/横向溢出 |
| `scripts/multiplayer-browser.js` | 三个独立浏览器、准备开局、真实 3D 点击、完整初始布局、聊天、刷新原身份、其他玩家手牌/发展卡不可见 |
| `scripts/worker-smoke.js` | 本地 workerd 建房/加入、服务端裁决、个性化视图、电脑 alarm、重连 |
| `npm run test:worker:restart` | 独立临时 DO 存储，三真人完成初始落子并各自持有资源，终止并重启完整 Wrangler/workerd 后，逐人核对身份/棋盘/回合/私人资源恢复，其他人的隐藏信息仍不可见 |
| `npm run test:integration` | 仅在本地模拟两种生产元信息，验证 A/C 邀请、对应大厅链接、另一服前缀阻断/不跳转，以及手机布局；不冒充真实云端验收 |
| 原大厅 | 7/7 路由/资源；11/11 浏览器，含双大厅整页切换/刷新、模拟六入口/触屏、邀请净化、拒绝卡坦岛观战、错误配置与七种断点；运动会 release typecheck/build 通过 |
| 发布器 | actionlint、Bash/Python 检查及 WSL Linux 离线主机测试 10/10；使用校验过的官方 Node24.22.2 x64 完成 npm ci/构建/Worker dry-run/实际 4.79 MB Linux 包，经生产 unpack_zip/safe_tar 解包后用外置数据目录启动，健康/前端 SHA、HTML、无房间 WS 标记均通过；仅在本机 WSL 临时目录运行 |

截图在本机 `test-results/`，已逐张查看；大厅交付截图在运动会 PR 的 `docs/qa/catan-lobby/`。浏览器测试是 Windows Chromium/Edge 及移动模拟，没有实体 iPhone/Safari 验证。构建报告原有 Three.js 大包提示，不影响完成构建。

## 必须在授权部署后逐环境实测

以下目前均**未进行**，不能用上表本地测试代替：

1. 在实际阿里云和 Cloudflare origin 逐一验证 TLS 证书、页面、JS/CSS/SVG、WebSocket、精确 Origin、限流与错误配置。卡坦岛 DNS/证书/Worker/服务本次初查不存在。
2. 每服分别用三个独立真人身份建房、加入、邀请、准备、完整布局及行动，核对每条邀请都回创建服；把另一服前缀、冲突 server、重复参数与观战邀请交给实际页面，确认拒绝且不跨服找房。
3. 逐人核对自己的手牌与发展卡可见、别人资源/发展卡内容和牌堆不可见；断网重连、刷新、浏览器恢复和 Node 服务/DO 持久化恢复不丢身份或局面。不要求 Cloudflare 迁移到 Node，反之亦然。
4. 受控失败发布/错误配置验证上一代码恢复、最新存档不被覆盖；备份恢复先在隔离目录及 loopback 测试端口进行，不能用生产数据覆盖测试或自动恢复旧房间。
5. 检查原运动会/巫师牌两服与旧 HTTP/IP/8080/8081、预览、身份恢复、存档、备份和回滚保持可用。大厅两个服务器切换、三游戏入口各自进入，手机/桌面检查；完成前卡坦岛入口保持关闭。

## 发布与回滚操作入口

参见 [自动部署](automatic-deployment.md) 与 [阿里云首次准备](aliyun-deployment.md)。上线分为主机/云配置、受检查 main 发布、真实验收、单独批准启用大厅四步。生产发布已保留前版本时可按记录回滚代码；没有前版本或不能安全判定本次 CF 版本时保守停止并人工修复，不删除 DO、不回滚房间。

后台增加健康/版本与不建房 WSS 探针供每次发布自动检查；探针成功只证明部署基本连通，不能替代以上多人/数据验收。

本机可审查的 Linux 打包原始证据：`C:\Game\catan-integration-audit\linux-package-smoke.txt` 与 `linux-package-evidence.json`。该次使用包含所有未提交改动的隔离 smoke checkout，验证功能与打包契约；正式发布仍必须由 main Checks 对实际合并 SHA 重新构建、标记和校验。
