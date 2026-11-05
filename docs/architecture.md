# 联机实现与参考项目对照

参考的是用户指定仓库及其本地已有源码，未修改或搬动参考项目。

| 参考项目 | 阅读的实现 | 本项目采用的做法 |
| --- | --- | --- |
| magical-athlete-online | `src/server/index.ts`、`src/client/network.ts`；本地 HEAD `febde4a80a148dc9da8e6aae0e7dcd75a639b393` | 同源房间服务、动作唯一 ID、期望版本、服务端串行裁决、个人快照 |
| wizard-friends | `worker/room-authority.js`、`worker/index.js`、`src/room-session.js`、`src/relay-socket.js`、`wrangler.jsonc`；本地 HEAD `78a220f5454ac0e6bac78628b2d82d6b8a2f8951` | 可序列化房间控制器、身份 token 摘要、Durable Object 状态保存与休眠 WebSocket、刷新恢复、服务端电脑回合 |

这里重新实现了卡坦岛专用的规则与房间控制，没有复制参考项目里的另一种桌游规则或专用 UI。Node 与 Cloudflare 使用原生 WebSocket 消息协议，客户端不需要随部署方式切换网络代码。

## 状态流

```text
浏览器 -> POST /api/rooms -> 创建房间与身份
浏览器 -> /api/rooms/:code/ws -> hello(token, name)
房间 -> SHA-256(token) -> 恢复或分配座位
浏览器 -> action(id, revision, action)
房间 -> 去重 -> 校验版本 -> 规则校验 -> 更新状态 -> 保存
房间 -> ack -> 为每个在线座位生成个人快照 -> 广播
```

`state` 包含完整公开棋盘、银行库存、当前阶段、玩家公开数量、当前玩家的私有手牌与合法位置。发展卡牌堆顺序、其他玩家的资源类型和隐藏胜利点不出服务端。结算时公开全部手牌。

本地浏览器只保存昵称、房间码及座位凭证。不会把完整权威牌局保存在浏览器，也不要求房主页面持续在线计算他人的行动。

## 持久化与并发

Node 按房间维护 Promise 队列。每次规则计算在克隆的游戏状态上执行；保存失败回退房间记录并返回错误；保存成功后才确认并广播。每个存档使用同目录 `.tmp` 文件加 rename 更新。

Durable Object 使用相同 `Room`，在构造时通过 `blockConcurrencyWhile` 恢复记录，消息串行处理，写入 `storage` 后广播。连接身份放在 WebSocket attachment；休眠后仍能恢复。AI 定时通过 alarm 调用规则引擎。

身份凭证不进入公开快照和聊天，也不放到查询字符串。消息限制为 8 KB，Node 有请求/连接频率限制，两种后端均限制每连接消息速率。交易与建造都以服务端状态为准，客户端发送的坐标、资源数量和玩家 ID 不作为授权依据。

## 当前边界

Node 是单进程文件存档服务，不应由多个进程同时写同一个 `.data` 目录。Cloudflare 的持久化/休眠机制已有本地模拟验证，实际公网延迟、账户限额和跨地域连接尚未验证。双方服务接口相同，但存档不自动跨后端迁移。

开局后离线玩家保留座位，轮到该玩家时等待重连。没有强制超时托管。待机房间也保留原座位；返回首页不等于删除座位。

参考文档：[Durable Objects WebSocket 接口](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)。
