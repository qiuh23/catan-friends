# 卡坦岛 · 好友桌
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
作者与朋友，在电脑和手机浏览器中通过邀请链接一起玩桌游。

## Product Purpose
还原卡坦岛基础版，重点是可靠的房间联机和实际可完成的对局。

## Stack
根据用户指定的参考项目选择 JavaScript、Vite、Three.js、WebSocket。Node 本地服务与 Cloudflare Durable Objects 共用规则和房间逻辑。

## Capabilities and Constraints
用户要求先在本地初始化独立项目，再开始实现。个人非商业娱乐。不使用子代理，不进行 A/B 测试。3D 可以使用 Blender，当前以程序化几何模型起步。实现经典 3–4 人基础版；扩展版不在当前范围。部署目标尚未指定，当前不发布到公网。

## Evidence on Hand
用户提供 qiuh23/magical-athlete-online 和 qiuh23/wizard-friends 作为联机实现参考，本地有对应源码。规则核对 CATAN 官方基础版手册和 FAQ。

## Product Principles
- 房间服务裁决操作，客户端呈现玩家自己的视图。
- 建造、交易和得分应能追溯，操作失败给出具体原因。
- 断线保留座位，刷新后可以回到原对局。
