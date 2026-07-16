# 第三方声明

本文件记录已经核实、会随项目源码或应用资产使用的主要第三方内容。它不为《宝宝今天》的原创应用代码授予许可；应用代码的版权说明见 `README.md`。

公共源码根目录不提供开源 `LICENSE`。下列第三方许可证只适用于对应的第三方内容，不会把整个应用重新许可为 MIT、Apache-2.0 或其他开源许可证。

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
