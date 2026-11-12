# V8 大气依据与许可（仅扩展艺术背景星点）

V8 保留已认可 V7 的大气、日月、云与光照参数，只增加显式艺术背景星点采样。新增 diorama 星点是静态程序布景，不使用真实星表，不归因于官方 Sky 的物理大气。

本模块是依据官方 Three.js Sky 大气模型做的轻量改写，**不是未经修改的官方 Sky，也不是完整物理大气模拟**。

## 实际读取的官方源码

版本：npm `three@0.186.1`。QA 使用同一官方安装包，不把另一份 Three 打包进游戏。

- `examples/jsm/objects/Sky.js`：Rayleigh 波长系数、Mie 系数、Rayleigh 与 Henyey–Greenstein 相函数、Beer–Lambert 消光、8400/1250m 光学长度、视线气团近似、HDR 输出与色调映射顺序。官方类还包括更多经验修正与四层动态云，V6 没有完整照搬。
- `src/lights/DirectionalLight.js`：方向灯模拟无穷远平行光，方向由 position 指向 target，设置 rotation 无效。V6 天空输出的是反向的“棋盘指向光源”单位向量。
- `src/lights/DirectionalLightShadow.js`、`src/lights/LightShadow.js`：方向光阴影使用正交 shadow camera；需按场景尺寸约束范围与分辨率，bias/normalBias 不能随意增大。PCF 只是阴影贴图过滤，不是太阳角尺寸的物理半影模拟。
- `src/math/ColorManagement.js`：默认工作空间 Linear-sRGB；颜色输入按 Three 的颜色管理进入线性工作空间。
- `src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js`、`tonemapping_fragment.glsl.js`、`colorspace_fragment.glsl.js`：HDR 辐射先按宿主映射与曝光处理，再转换输出色彩空间；不能把散射颜色先当 sRGB 再重复 gamma。

官方参考：

- [Sky](https://threejs.org/docs/pages/Sky.html)
- [DirectionalLight](https://threejs.org/docs/pages/DirectionalLight.html)
- [Color management](https://threejs.org/manual/pages/color-management.html)
- [Shadows](https://threejs.org/manual/pages/shadows.html)

## 采用与简化

采用分波段 Rayleigh/Mie 消光、方向相关相函数、太阳入射路径与观察路径的衰减。太阳周围的宽亮区来自 Mie 前向散射，而不是屏幕上叠一个圆形渐变光晕。使用小 HDR 日轮，与散射在同一线性缓冲中合成并共享色调映射。

太阳半径选择 `0.2666°`，直径约 `0.5332°`。没有直接沿用官方 `sunAngularDiameterCos` 的命名：该点积阈值在实现中的实际角度需自行检查，不能把名称当成严格天文校准。月轮半径 `0.38°` 是适度风格化选择，固定艺术相位而非天文历表。

为适合棋盘和手机，V6 不做光线步进、体积云、多次散射、天气下载、星历、真实物理单位曝光标定或动态云循环。两层静态程序云为薄云近似；低画质去除云、星与月海噪声。太阳发光尺度和低于地平线的环境背景颜色是美术参数，文档不把它们包装成测量级模型。

大气 shader 不会自动照亮物件，也不会产生几何阴影。适配层仍须建立暖 DirectionalLight、较冷的天空填光，并使用同一世界源方向。环境贴图和 PMREM 不由该模块创建。

## 许可

Atmospheric coefficients, phase-function structure and gradient-noise portions are adapted from Three.js Sky. Modified for a single background triangle, externally supplied deterministic state, bounded static clouds, explicit orthographic handling, and shared game light directions.

Copyright © 2010–2026 three.js authors. Licensed under the MIT License. The complete, unchanged notice is supplied in `THREE_MIT_LICENSE.txt` and must accompany redistributed substantial adapted portions.
