---
name: 卡坦岛 · 海岸桌面
description: 以可操作的实体感岛屿为中心的好友桌游界面
colors:
  primary: "#173b3d"
  paper: "#f7f6f0"
  ocean: "#b8d8d2"
  muted: "#65776b"
  accent: "#b65c35"
  wood: "#397456"
  brick: "#ae674a"
  sheep: "#66863e"
  wheat: "#a28027"
  ore: "#637e8c"
typography:
  body:
    fontFamily: "Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  title:
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.4
rounded:
  control: "8px"
  panel: "12px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "11px 15px"
---
# 海岸桌面

## Overview

主界面是操作型桌游界面。海水与低多边形实体棋盘构成主视野，暖白色侧栏承载房间、玩家和操作。棋盘的视觉优先级高于界面装饰。

## Colors

界面颜色由 `src/tokens.css` 管理，与 frontmatter 一致。棋盘实体用相应地形颜色，其明暗由光照决定；数字 token 不受光照影响。海水底色与页面的 ocean 保持一致。

## Typography

操作界面使用 Segoe UI、Microsoft YaHei、system-ui 字体栈。品牌 23px、面板标题 17/15px，桌面主体 14px；说明、计数等次级文字 10–12px。大厅主标题目前使用 Noto Serif SC、Songti SC、SimSun 的衬线回退，43px，手机 31px。

当前标题依赖系统字体，尚未引入独立自托管显示字体；这是首版资产状态，不作为未来必须使用系统显示字体的规范。

## Layout
桌面版顶部为品牌与房间信息，左侧玩家和建造，中央岛屿与手牌，右侧记录与交流。大厅直接展示可转动岛屿和建房/加入表单。手机布局保留完整棋盘，将操作面板和日志顺序下移，按钮触控高度至少 44px。

## Elevation & Depth

普通侧栏用背景色分区。棋盘上方状态条使用 `0 7px 24px #21483b12`，手牌使用 `0 5px 10px #23473a13`，分别表达浮在棋盘上方的物理层级。

## Shapes

普通控制圆角 8px，主要浮动面板 12px。棋盘六边形和游戏棋子尺寸由拓扑/渲染代码定义。

## Components

选择建造后，合法位置出现浅金色标记；点击位置提交一次服务端操作。悬停显示地块产出信息。可旋转/缩放，提供复位按钮和 2D 棋盘备用。状态通过文字、图标和颜色共同表达。二维棋盘上的合法位置可用 Tab 聚焦、Enter 落子。

## Do's and Don'ts

- 保持五种资源的界面颜色、图标与棋盘地形对应。
- 数字标记和合法位置必须优先清晰，不能被景物遮挡。
- 手机保留完整棋盘，将较长的操作和记录放到其后。
Three.js 程序化几何构建六边形地块、树、山、农田、羊、村庄、城市和道路。所有模型源代码在 src/board.js，未来可以将建模函数替换为 Blender 导出的 glTF。没有外部贴图、商业原版图像或运行时字体依赖。
