# 旅游规划平台 Logo 候选

日期：2026-11-04。

面向本平台的六个视觉方向：

| 编号 | 方向 | 主要意象 |
| --- | --- | --- |
| A | 折叠地图 | 地图折面与串联目的地的路线 |
| B | 等高线 | 地形轮廓与进入山地的路径 |
| C | 山水日出 | 山峰、日出与河流/路线 |
| D | 丝带路线 | 连续路线与多个途经点 |
| E | 指南针 | 方向与目标定位 |
| F | 地图拼片 | 组合行程与地图图层 |

本组采用无文字图形标志，便于平台名称确定后组合字标。

当前状态：六款 SVG 矢量原稿和 PNG 透明预览均已完成，并已检查总览排版。

## 预览与文件

- [编号对比图 PNG](comparison.png) / [编号对比图 SVG](comparison.svg)
- [本地交互预览](preview.html)：浏览器打开，可切换图标预览底色。
- 每款单独提供 SVG 原稿与 512×512 RGBA 透明背景 PNG，文件名前缀 a–f 对应 A–F。
- [颜色、概念与文件名清单](concepts.json)
- [可复现构建脚本](build_logos.py)：使用本机 Microsoft Edge 渲染，无需在线图像 API。

| 编号 | SVG | PNG |
| --- | --- | --- |
| A | [折叠地图](a-folded-map.svg) | [透明预览](a-folded-map.png) |
| B | [等高线](b-terrain-contours.svg) | [透明预览](b-terrain-contours.png) |
| C | [山水日出](c-mountain-sunrise.svg) | [透明预览](c-mountain-sunrise.png) |
| D | [丝带路线](d-journey-ribbon.svg) | [透明预览](d-journey-ribbon.png) |
| E | [指南针](e-compass-route.svg) | [透明预览](e-compass-route.png) |
| F | [地图拼片](f-map-mosaic.svg) | [透明预览](f-map-mosaic.png) |

SVG 图形无外部图片、字体或脚本依赖，颜色与路径可编辑；对比页的文字使用系统中文字体。当前不修改应用中的 logo/favicon，等待用户选定方向。

## 生成方式记录

内置 image_gen 尝试因连接错误未返回图像。用户随后明确选择 SVG 矢量方式，最终成果为程序化绘制的 SVG 和本机浏览器渲染的 PNG，并非图像模型生成的位图。

最初准备的完整提示词保留在 [PROMPTS.md](PROMPTS.md)，最终图形、颜色及轮廓以 SVG 和 concepts.json 为准。本次未调用图像 API 备用方案，也未读取 OPENAI_API_KEY。

