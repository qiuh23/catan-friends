# 程序化地形、手机布局与性能验收

基线：`qiuh23/catan-friends` main `061ee3eff1972205a8956eb4002d21671c15ff99`。来源核对：2026-11-05；本地验收：2026-11-06。独立工作区开发，原有目录及其未提交内容未修改；未使用子代理、未做 A/B 测试。本 PR 不修改规则、服务端、人数扩充、部署工作流，也不执行公网部署。

## 来源、许可与实际使用

| 来源 | 已核对的许可或权利说明 | 本次实际用途及分发情况 |
|---|---|---|
| [Kenney Hexagon Kit](https://kenney.nl/assets/hexagon-kit)，2.0，70 个模型 | 作者页面标明 [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) | 阅读作者预览，参考切面造型、有限色板和沙色地块断面。没有导入或再分发模型、贴图或预览图。 |
| [Bunkerbewohner/threejs-hex-map](https://github.com/Bunkerbewohner/threejs-hex-map)，`examples/random/view.ts` 与示例截图 | [MIT](https://github.com/Bunkerbewohner/threejs-hex-map/blob/master/LICENSE.txt)，Copyright (c) 2016 Goldsaucer Ltd. | 阅读示例，参考地形、海岸与资源层次的区分；没有复制代码、纹理图集或截图进项目。 |
| 用户的 CATAN 资料库，A005 近景与中文汇总第 7 节 | [CATAN IP 政策](https://www.catan.com/guidelines-dealing-intellectual-property-catan)保留官方美术、文字和商标权利；未找到本项目可重用官方图片的开放许可 | 仅在本地检查数字概率点、道路留白、地形资源语义与暖色桌游氛围。没有复制、裁切、描摹、热链或将官方图作为纹理、卡面。 |
| 既有 Three.js 0.186.1 和 OrbitControls | MIT，Copyright © 2010–2026 three.js authors | 继续使用现有依赖，没有新增运行时依赖；完整声明随构建复制到 [third-party-notices.txt](../public/third-party-notices.txt)。 |
| 本次几何、布局、配色和代码绘制的标签 | 项目既有授权说明；未给整个项目新增或宣称 CC0/MIT 许可 | `src/terrain.js` 与 `src/board3d.js` 的程序化实现。不是 Blender 导出模型；无远端贴图、字体或模型请求。 |

核对过的本地参考文件：

| 文件 | SHA-256 |
|---|---|
| `CATAN资料库/美术素材/官方产品图/A005_CATAN_Boardcloseshot.jpg` | `9bf62e2827dc13adf5bae22d6fc40075378c1fd559080c1f13f9974642cb1480`，与 `来源记录/images_index.json` 一致；[原始来源](https://www.catan.com/sites/default/files/2025-04/CATAN_Boardcloseshot.jpg) |
| [Kenney 作者预览](https://kenney.nl/media/pages/assets/hexagon-kit/cfcf478d4f-1706007664/preview.png) | `767cef76b8a5c235c24a7bf36e6e6acd44ce9b6ff929b2631497aa2a1af08ed1` |
| [Three.js 六角地图示例截图](https://raw.githubusercontent.com/Bunkerbewohner/threejs-hex-map/master/examples/random/screenshot.jpg) | `3cc6672c7aceb0576b2b8f337a07ea501f50e5ac6aca0a851ce2bd3578f1ab78` |

后两张预览只保留在忽略的 `.local/references/`。来源明确不等于获得官方素材的使用许可；本次原创几何不改变项目既有品牌或发行授权状态。资料库其它未核对文件也未引入。

## 美术和信息层级

- 浅沙色断面与地形表层形成清楚边界。森林有双色分层树冠、树干和林下碎石；矿山有高低岩峰、浅色矿脉与碎石；砖土用红褐色分层台地和黏土碎块。
- 麦田有朝向不同的地垄、交替色麦行和少量麦束；草场有低矮草丘、三只羊和草簇；沙漠是低缓沙丘与碎石。海岸根据真实边界生成浅滩、断续浪线、礁石，港口配木板栈桥。
- 每块地按坐标、编号和资源生成确定的局部变化。聊天、重连和切换视图不改变装饰分布；无需传输额外随机数据。
- 中央留数字净空，边缘留道路与交点通道。数字和概率点、港口、玩家色棋子、合法落点按明确显示层级绘制，装饰不能遮挡它们。强盗偏离数字中心。
- 初始视角适配实际地块及港口标签的投影范围；去除大厅和等待房间会裁切港口的负边距。保留手动旋转、缩放、复位、2D 键盘操作与 19/30 地块扩充。

## 手机操作布局

竖屏采用紧凑房间状态、中央棋盘和两行建造/回合操作。横屏高度不足时，棋盘使用左侧完整高度，状态与操作进入右侧轨道；待处理表单占用右侧可滚动区域。玩家、记事、聊天均可展开，输入草稿和展开状态在消息更新或旋转后保留。

`requiredTask` 单独判断当前用户的弃牌、偷取对象、收到报价和暂停状态，不依赖“是否轮到你”。这些内容位于始终展开的操作区域，同时有醒目状态提示及“去处理”入口；关闭日志和聊天不影响它们。房主恢复对局直接显示在暂停操作区域。

使用动态视口、VisualViewport 和安全区内边距；数字输入保持 16px、主要按钮至少 44px。键盘压缩视口时让正在编辑的输入保持可见，不强制横屏、不申请方向锁定或全屏。3D 触控使用屏幕坐标的 22px 命中半径；相邻落点不明确时提示放大，不猜测落子。拖动和多指缩放不会被当作点击。

## 渲染和释放

- 地形、海岸和重复装饰按几何/材质批量实例化；每实例保存变换和色彩。合法落点的圆片与边圈各一次 draw call。
- 棋盘静态内容、棋子、合法落点分别比较内容签名，只有相关内容变化才更新对应层。聊天、普通手牌/状态更新不会创建新的 3D 层，也不会安排多余渲染。
- 按需 RAF，仅相机交互、尺寸和相关场景变化时绘制。阻尼停止后不再循环；页面隐藏或棋盘滚出视口时停止安排绘制。没有常驻水面、树木或光影动画。
- 触控/小屏幕 DPR 上限 1.35、约 120 万像素预算，关闭实时阴影；其余设备 DPR 上限 1.75、约 200 万像素预算。桌面阴影降为 1024，关闭自动更新，仅相关层或配置变化时更新。
- 每个棋盘独立拥有几何、材质、标签纹理池。重建层只释放实例缓冲，切到 2D 或销毁时统一释放所有池、阴影、渲染器和 WebGL 上下文，并移除事件、观察器与 RAF。异步图标加载在销毁后不会重新上传纹理。
- 实例化采用 [Three.js 官方 InstancedMesh 接口](https://threejs.org/docs/pages/InstancedMesh.html)，包括实例矩阵、颜色与实例资源释放。

## 本地验证与限制

Windows，Node.js 26.13.0，Playwright 1.64.1 / Chromium 156.0.8078.4，ANGLE Vulkan SwiftShader 软件渲染。环境明细保留于 `test-results/terrain-environment.json`。运行方式：

```powershell
npm ci
npm test
npm run build
npm run worker:check
# 独立本地服务正在运行后；可用 TEST_URL 指向其它 loopback 端口
npm run test:browser
npm run test:multiplayer
npm run test:integration
node scripts/room-experience-browser.js
npm run test:terrain
```

`npm test` 79/79 通过；生产构建、Worker dry-run、本地浏览器 smoke、多浏览器、双服务器入口及房间体验脚本通过。原房间脚本补充了手机展开玩家/房间管理的真实操作步骤，没有移除原断言。既有远端 CI 文件未修改，新增地形检查只在本地运行。

`test:terrain` 覆盖 3/4/5/6 人各自的 1440×960、390×844、844×390，另加 320×568、667×375、768×1024 和 1280×720，共 16 组。触控模拟 DPR 3，并核实实际绘制上限为 1.35。测试覆盖普通消息及空闲不重建/不绘制、五轮 2D/3D 切换的有界资源与旧上下文释放、滚出视口后暂停绘制及恢复、输入草稿、旋转、压缩视口模拟键盘、非当前回合弃牌、报价处理、3D 建村/铺路/城市/强盗、近邻误触拦截、拖动防误落、2D 触控与键盘落点、WebGL 不可用时自动回退。

下表是初始化布置完成后的固定本地场景，包含已有道路和建筑。桌面的统计包括阴影通道；这些计数不是 FPS 或真机耗电指标。

| 棋盘 | 手机 draw calls / 三角形 | 桌面 draw calls / 三角形 |
|---|---|---|
| 3 人，19 地块 | 39 / 13,186 | 45 / 25,038 |
| 4 人，19 地块 | 39 / 13,298 | 45 / 25,150 |
| 5 人，30 地块 | 51 / 19,858 | 57 / 37,942 |
| 6 人，30 地块 | 51 / 19,970 | 57 / 38,054 |

同一组六人场景五次切换后，当前渲染器仍为 9 份已上传几何、17 份纹理（含渲染器内部纹理），只有一个 canvas。聊天/普通输入更新前后，地形、棋子、落点重建计数及绘制次数相同；空闲观察期间绘制次数不增加。完整计数在忽略的 `test-results/terrain-performance.json`，截图在 `test-results/terrain-*.png`，已实际打开检查桌面、手机竖横屏及弃牌/交易截图。

提交了三张程序化场景的审查截图，均为六人测试夹具、CSS 像素尺寸；不包含资料库原图：

| 桌面 1440×960 | 手机竖屏 390×844 | 手机横屏 844×390 |
|---|---|---|
| [截图](screenshots/terrain-desktop.png) | [截图](screenshots/terrain-portrait.png) | [截图](screenshots/terrain-landscape.png) |

手机检查属于桌面浏览器触控模拟。未测试物理 iPhone/Android、真实 Safari、系统软键盘、刘海/折叠屏设备、发热、续航或移动网络；没有据此声称真机帧率和电量改善。安全区代码和压缩视口测试也不等同于真机验收。
