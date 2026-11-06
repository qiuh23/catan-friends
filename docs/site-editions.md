# 国内与海外独立站点策略

国内：[大厅](https://magical-athlete-online.cn/) · [卡坦岛](https://catan.magical-athlete-online.cn/)。海外：[大厅](https://magical-athlete.qiuh23.workers.dev/lobby/) · [卡坦岛](https://catan-friends.qiuh23.workers.dev/)。大厅由运动会仓库发布；本仓库只发布卡坦岛。

国内只使用 `shared/site-policy.js` 中的建筑与艺术 32 词库，稳定 ID 为 `catan-01` 至 `catan-32`。客户端只能提出 ID，服务端从库生成文字并在同房真人、电脑、离线席位中优先避重；极端耗尽时用独立编号徽标，昵称本体不变。入房后身份恢复和再来一局保持名字，姓名与 player ID、座位和凭据分离；独立 Web Crypto 随机不推进游戏随机流。

国内没有自由昵称输入或改名入口，没有玩家聊天、短句、表情、回应、聊天记录、未读提示及对应发送事件接入。HTTP 创建与 WebSocket 加入拒绝伪造的自由名字/未知昵称 ID；原凭据恢复兼容旧客户端，忽略其旧显示名。房间权威在成功回执查找之前拒绝所有交流请求，固定返回“当前站点不提供玩家交流功能。”，不回显正文。国内 `chat` 同步固定为空。资源数量、报价、接受/取消、银行/港口操作保持结构化；暂停/恢复、游戏记录及动画保持原有机制。卡坦岛现有范围不支持观战。

国内旧档首次加载迁移昵称，保留凭据摘要、player ID、座位、手牌、资源、得分、随机流与进度。无法可靠归属的旧公开日志和动画文字保存在服务器私有 `legacyPublicText` 字段，不再进入公开投影；新的系统记录继续由可信规则事件和固定昵称生成。旧聊天不再下发；独立 `moderation/` 或 DO moderation 键中的私有审计证据不删除。国内不再读取旧站长处置映射，迁移后的固定昵称不会被覆盖；国内举报、留言处置与安全审计入口停用。旧私有账本原样保留，损坏或缺失不影响国内游戏与恢复。浏览器清理旧名字和旧聊天草稿；本地练习使用相同权威流程。海外存档、聊天历史和自定义名字维持原行为。

两站只访问当前 origin 的 API/WebSocket、房间列表和恢复数据。当前构建只包含自己的大厅地址；`A-`/`C-` 邀请不匹配时固定提示“此邀请不属于当前站点，请向房主确认原始邀请链接。”，不探测或跳转另一站。无前缀旧邀请码仍限定当前站点。URL、localStorage、建房参数无法改变服务端策略。

## 构建与生产配置

`npm run build:cn` 与 `npm run build:global` 分别生成 `dist/`；Vite 注入可信常量，`dist/build-info.json` 记录 `siteEdition`。本地 `npm run dev` 默认 global；国内本地开发可用 PowerShell `$env:SITE_EDITION='cn'; npm run dev`。切换开发模式后重启进程，生产不能依赖浏览器参数。

Node 阿里云服务在受保护环境中必须配置 `BACKEND_ID=aliyun`、`SITE_EDITION=cn`，并沿用核实过的 `PUBLIC_ORIGIN`、目录和备案信息。`NODE_ENV=production` 缺少模式报错；阿里云缺少模式、错误模式、静态产物模式不一致均拒绝启动。旧 IP/HTTP 若仍代理该国内服务，执行相同策略；不要另起使用缺失模式的开放服务。

Cloudflare `wrangler.jsonc` 固定 `BACKEND_ID=cloudflare`、`SITE_EDITION=global`，运行时校验静态资源模式，不匹配返回 503。本地 Worker 使用 `wrangler.local.jsonc` 的隔离命名空间。国内限制在两种后端的共用 Room 边界实现；生产 Worker 继续海外功能。

国内按最新要求停用交流及访问/连接安全审计：页面不展示举报与留存提示，`/api/security/contact` 与站长处置接口返回 404，Node/DO 不读取、写入或清理国内 moderation 账本。Nginx 模板 `access_log off`，保留 `error_log`、应用故障与游戏恢复数据；身份认证、协议校验、来源校验和限流继续工作。海外举报、聊天留存及审计维持原行为。

保持原 `main → Checks → Deploy checked Catan backends` 自动链和生产环境门禁，不增加远端工作流。Checks 先生成海外静态资源并 dry-run Worker；`scripts/deploy/package.sh` 保存海外产物后从同一受检查提交生成国内静态资源，分别打包 Worker/global 与 Node/cn。清单、接收器、资产 marker 与公开 HTTP/WSS 发布回读均校验站点模式。

**首次合并发布前运维准备：** 更新主机 `/usr/local/sbin/catan-friends-deploy` 所用的 `ops/deploy.py`，把受保护服务环境增加 `SITE_EDITION=cn`，备份房间及独立 moderation 目录，更新 `ops/backup.py`（历史 moderation 按原始字节私有备份，不校验已停用账本的 schema），安装本游戏 Nginx 与 logrotate 模板并 `nginx -t` 后 reload；不要清空 `.data`、DO、历史 `network.log` 或身份。检查仅本游戏的 cron/timer，停用旧交流/访问审计任务；仓库现有 `catan-friends.cron` 只有游戏备份、磁盘故障监测及故障日志轮转，可保留，轮转模板不再匹配旧 network.log。旧接收器会拒绝新增清单字段，必须先更新。Worker/global 与 Node/cn 清单不混用；回滚目标须支持相同 schema 和站点策略，首次发布没有兼容回滚目标时需要兼容修复发布。

## 本地验证与交付状态

```powershell
npm test
python -m unittest ops/test_deploy.py
npm run build:cn
node scripts/site-edition-browser.mjs cn
npm run build:global
node scripts/site-edition-browser.mjs global
npm run worker:check
node scripts/site-worker-smoke.mjs
npm run test:secure-worker
```

本轮已运行：153 个 Node 测试；Python 接收器 11 项（Windows 上 4 项 Linux 软链接生命周期测试按既有条件跳过）；国内/海外构建；Worker dry-run；国内真实 workerd 的伪造昵称/交流及重试拒绝、电脑/开局/暂停/重启/恢复，以及海外既有 secure-worker 全部通过；Chrome 桌面 1280×800 与手机横屏 844×390 的昵称、换名、建房、加电脑、开局、刷新恢复，海外聊天发送；已查看国内横屏截图。截图在忽略提交的 `test-results/site-edition/`。

覆盖真实 Node HTTP/WebSocket 拒绝交流与旧成功回执重试、身份重启恢复；真实 DO handler 的拒绝与恢复；旧档投影/固定库/审计迁移；现有结构化交易和游戏规则测试。未执行公网发布、真实手机 Safari 或完整浏览器游戏回归。Linux 产物打包依赖 Node 24/Linux，未在 Windows 实际执行整条生产打包/安装链；既有契约测试验证清单与隔离边界。源码完成、本地通过、远端 Checks、合并、实际发布和公网验收应分别记录。

三个游戏 PR 可独立合并。建议先准备各 Node 服务的可信环境和接收器，合并巫师牌与卡坦岛，再合并含两大厅的运动会 PR；最终逐站回读 marker 与验证邀请码。无跨仓库包依赖，不互相触发部署。
