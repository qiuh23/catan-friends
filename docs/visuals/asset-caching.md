# Catan 内容哈希与浏览器缓存

## 目标及边界

玩家只下载当前需要的模型。浏览器可在刷新、关闭后重开、前端版本更新时继续使用未改变的素材。采用标准 HTTP 磁盘缓存，不增加 Service Worker/Cache Storage 的第二份永久副本，不预取所有素材，也不请求持久存储权限。

不能承诺永不下载：浏览器会因空间压力、隐私模式、用户清理、禁用缓存、强制刷新、过期等原因删除或绕过缓存。国内与海外是两个 origin，缓存不能跨站共享。首次访问仍需要下载，3D 解析和 GPU 内存成本仍然存在。

## 发布前线上只读核查（2026-11-12 UTC 16:24–16:25）

使用 HTTPS HEAD 核查首页、build-info.json、hooded.glb 和 pier_detailed.glb：

- `https://catan.magical-athlete-online.cn`：响应 200，没有 Cache-Control/ETag；GLB 为 application/octet-stream。仓库 Node 静态实现没有缓存头，nginx 模板原样转发；没有读取或修改主机实际 nginx 配置。
- `https://catan-friends.qiuh23.workers.dev`：静态资源为 `public, max-age=0, must-revalidate`，抽查的 GLB 有 ETag，GLB MIME 为 model/gltf-binary。海外原先可条件校验，但固定 URL 不能安全改为长期 immutable。

以上只是原部署状态抽查，不是本改动已部署的证据，也不是国内运营商/真机测速。

## 实现

- 构建读取全部 23 个 GLB，对每个文件的完整内容计算 SHA-256。浏览器使用 `/assets/content/<64位哈希>/<文件名>.glb`，不是按整个版本统一加时间戳。单个模型变化不会让其他模型的 URL 变化；UI 更新不会使所有模型重新下载。
- 映射内嵌在当前 JS 构建中，不多发一个启动清单请求。现有逻辑模型 ID 不变，不改模型外观/落点或道路。外部纹理/缓冲依赖的 GLB 会使构建报错，避免只散列主文件造成依赖更新失效。
- 发布包只保留哈希 GLB，不保留大文件双份。旧固定 URL 通过 Node/Cloudflare 的临时 302 指向当前内容 URL，不给固定 URL immutable。版本清单和旧素材说明 JSON 必须校验。
- Node 对响应字节生成强 ETag，支持 GET/HEAD/If-None-Match（包括弱比较）。只有在构建清单且摘要与实际字节一致的静态资源才设置 `public, max-age=31536000, immutable`。HTML、固定资源、版本清单使用 `public, max-age=0, must-revalidate`。API 继续 no-store。
- Cloudflare 从构建产物 `_headers` 读取精确资源规则。26 个哈希产物（23 GLB + JS/CSS）使用一年 immutable；通配默认必须校验，精确规则先移除默认再设置，不合并出互相冲突的 Cache-Control。规则上限 100，超限构建失败，届时必须升级路由设计，不能悄悄缺少缓存头。
- Cloudflare `not_found_handling=none`，Worker 为正常无扩展名应用链接提供首页，为缺失模型保留 404/no-store，避免把 HTML 长期存为 GLB。Node 同样不会把 `/assets/` 下的缺失路径回退为首页。
- 每页 GLB 内存缓存仍限制 24 MiB、5 分钟闲置过期。HTTP 磁盘缓存可跨页面继续复用；Three.js 资源每块棋盘独立持有/销毁。解析错误清除内存字节，并使下一次显式重试 `cache: reload`，避免反复读到坏 HTTP 缓存。没有无限自动重试。

## 更新、回滚与旧页面

HTML 每次校验并引用本次构建的哈希脚本；没有缓存优先的 Service Worker 把用户锁死在旧首页。回滚恢复完整、同一版本的前后端产物，旧内容自然得到原哈希 URL，浏览器还保留时可以复用。禁止用新内容覆盖旧哈希路径，禁止只回滚 HTML 或只替换一部分 dist。

已有打开的对局不会被强制刷新。当前部署不额外永久保存所有历史素材：切版后旧页面若尚未下载某个已删除的旧哈希，可能收到404；现有程序化回退仍可用，用户结束对局后刷新即可更新。此方案保证不会把新内容冒充旧哈希，不承诺所有旧页面在任意跨版时刻都能补齐历史素材。现有发布回滚保留 current/previous 发布包，不新增无界历史目录。

nginx 无需变更生效配置：保持转发 Node 的 Cache-Control、ETag、304，不增加覆盖上游的 expires/proxy_hide_header，不开启整站/API 缓存。模板仅新增说明，没有线上配置或服务操作。

## 验证

基于已合入道路的 main `7ec8c3c`，最终全量 **224/224** 单测通过；`npm run check`、`npm run build`、Worker deploy dry-run 以及本地 Cloudflare HTTP 烟测通过。Three.js 既有大 chunk 警告仍在，没有为了隐藏提示调阈值。

新增 `tests/asset-cache.test.js` 验证重复构建 URL 稳定、单文件更新、恢复原内容的回滚地址、无双份模型、外部依赖拒绝、缓存头规则上限；通过真实 Node HTTP 请求验证 200/304、0字节304、HEAD、变更HTML、固定路径302、缺失文件404、篡改产物不授予immutable、缓存清理后的重新读取；验证解析失败强制下一次重取和 Worker 缺失哈希处理。

已实际启动本地 Cloudflare Wrangler/Miniflare，验证构建后的规则：

- `/`、`/build-info.json`：200 / `public, max-age=0, must-revalidate`。
- 内容哈希 GLB：200 / `public, max-age=31536000, immutable`。
- 原固定 GLB：302 到对应内容哈希 / `public, max-age=0, must-revalidate`。
- 缺失内容哈希：404 / `no-store`，不是 HTML。
- 已有 ETag 条件请求：304，响应体 0 字节。

复现：

```sh
npm test
npm run check
npm run build
XDG_CONFIG_HOME=/tmp/catan-loading-config npm run worker:check
XDG_CONFIG_HOME=/tmp/catan-loading-config node scripts/asset-cache-http-smoke.mjs
```

实际浏览器磁盘命中、关闭重开、缓存清理、强制刷新、移动端视觉/帧率仍待验。当前 Chromium 所需 socket 被执行环境拒绝，之前经权限升级仍失败，云浏览器也无法访问该工作区本地端口。没有把 HTTP/模拟测试当作真实浏览器磁盘命中证据。上线后须再次抽查国内 nginx 与海外响应头，并在可运行 Chromium、Safari/手机的环境完成上述验收。缓存规则本地验证不等于已生效在线上。

参考：[Cloudflare Workers 静态资源缓存头](https://developers.cloudflare.com/workers/static-assets/headers/)。
