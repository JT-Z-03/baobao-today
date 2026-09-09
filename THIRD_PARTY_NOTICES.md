# 第三方声明

本文件记录已经核实、会随项目源码或应用资产使用的主要第三方内容。《宝宝今天》的原创代码和文档采用根目录 `LICENSE` 中的 MIT License；下列第三方内容继续适用各自的许可证和声明。

## Expo 模板来源内容

项目最初基于 Expo 模板建立，保留的模板来源代码适用以下 MIT 声明：

```text
The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Expo 模板自带但未被产品使用的示例图、徽标和教程素材不包含在公共导出中。

## Material Symbols

Android 界面通过 `@expo/material-symbols` 使用 Google Material Symbols 的 Android XML 图标。`@expo/material-symbols` 包元数据声明为 MIT；其中的 Material Symbols 图标来源为 [Google Material Design Icons](https://github.com/google/material-design-icons)，适用 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)。上游包包含的原始 NOTICE 为：

```text
This package includes icons derived from Google's Material Symbols:
https://github.com/google/material-design-icons

Material Symbols are licensed under the Apache License, Version 2.0.
You may obtain a copy of the license at:
https://www.apache.org/licenses/LICENSE-2.0
```

Android bundle 还会包含 `@expo-google-fonts/material-symbols` 0.4.38 提供的 `MaterialSymbols_400Regular.ttf`。该包代码适用 MIT License（Copyright (c) 2020 Expo），字体随包的 `LICENSE_FONT` 为完整的 Apache License 2.0。字体来源与许可证说明见 [Expo Google Fonts 的 Material Symbols 包](https://github.com/expo/google-fonts/tree/master/font-packages/material-symbols)。

## 运行时与构建依赖

项目直接使用 Expo、React、React Native 和 fflate 等第三方包；它们当前的包元数据均声明为 MIT，具体版本锁定在 `package-lock.json`。`npm ci` 安装的每个包仍适用其随包提供的许可证和声明。

本文件不手工枚举整个 npm 依赖树，以避免与锁文件实际内容漂移。源码仓库不提交 `node_modules`。如后续发布 APK，应从用于构建该二进制的精确锁文件和已安装包重新生成并复核完整依赖许可证清单。

## 项目品牌资产

`assets/images` 中公共导出保留的应用图标、Android adaptive/monochrome icon 和浅/深色启动图属于项目正式品牌资产，不是 Expo 模板素材，也不因上述第三方许可证而获得额外授权。

## 2026-09-09 界面插画与图标

`assets/ui` 中的 12 张运行 PNG 用于已确认的淡桃粉界面。逐项尺寸、着色方式、来源和 SHA-256 记录在 [素材清单](assets/ui/manifest.json)，由 `npm run test:ui-assets` 独立校验；原有 `npm run test:assets` Android 正式品牌资产门禁继续保留。运行素材目录仅保留这 12 张 PNG 与清单，公开制作来源见 [UI 素材说明](docs/UI-ASSETS.md)。

| 运行素材 | 实际制作来源 |
| --- | --- |
| `baby-smile.png`、`baby-sleeping.png`、`happiness-note.png` | 以用户确认的首页、睡眠页生图为参考，使用内置 `image_gen` 生成独立插画或手写文案。用户随后明确授权本地抠图、裁边与等比缩放，才转换为运行所需的 RGBA 透明图片。 |
| `feeding.png`、`poop-light.png`、`poop-dark.png`、`pee.png`、`sleep.png`、`other.png`、`milk-volume.png`、`breastfeeding.png`、`brand-flower.png` | 在用户明确授权后，直接从已确认的 01 首页、02 喝奶、05 大便、06 小便、07 睡眠生图中裁取对应图形并提取 alpha；深色尿布复用相同轮廓和透明通道，调整为浅绿与金棕。未用其他生成候选替换定稿图标。 |

本次公开同步只包含最终运行 PNG、素材清单、制作来源说明和虚构数据的应用截图。设计原图、生成提示词及内部处理记录没有包含在公开源码中。运行应用仅引用成品 PNG，不使用整页参考图作为页面背景。

这些素材的来源不同于上述 Expo 模板与 Material Symbols，不能依据它们的 MIT 或 Apache 声明推定新增素材获得同样的第三方授权。用户提供的图标样式截图只作为设计参考，本记录不将其原始来源或第三方权利状态描述为已经核实。本次源码公开不改变上述来源说明，也不宣称这些图形是 Expo 或 Google 提供的素材。
