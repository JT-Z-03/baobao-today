# 宝宝今天

《宝宝今天》是一款面向主要照护者的新生儿日常记录应用，重点是在抱娃、换尿布、冲奶和夜间照护时，用尽量少的操作完成记录并回顾当天情况。

A privacy-first, local-first newborn care tracking app, currently implemented and validated for Android.

Android 版现已提供安装包，支持 Android 7.0 及以上。iOS 仍在计划中，尚未开始构建或验收。

## 下载与安装

**[下载宝宝今天 1.1.1 · Android APK](https://github.com/JT-Z-03/baobao-today/releases/download/v1.1.1/baobao-today-1.1.1-code6.apk)** · [发布说明与校验文件](https://github.com/JT-Z-03/baobao-today/releases/tag/v1.1.1)

1. 在 Android 手机上下载上面的 `.apk` 文件，打开并按系统提示安装。若系统询问，允许当前浏览器或文件管理器安装此应用。
2. 已安装旧版的用户可直接覆盖升级；不要先卸载，以免删除手机中的本地记录。
3. 安装后直接使用，无需注册账号。宝宝资料、记录和照片保存在当前手机，可在设置中创建完整备份。

GitHub 自动附带的 `Source code (zip/tar.gz)` 是开发源码，不能直接安装到手机。当前安装包为 `1.1.1 / code 6`；通用 APK 已包含 ARM 和 x86 架构，无需按手机型号选择。

## 当前源码状态

- Current source version: Android 1.1.1 / versionCode 6
- 小便记录页直接展示尿量、颜色和备注，均为选填；取消“更多信息”的展开步骤，与大便记录页一致。
- API 36 edge-to-edge safe-area fix included
- Android functional baseline validated through automated tests, an API 36 emulator, and an Android 14 same-signature code 3→4 upgrade
- Soft-rose UI: API 36 emulator checks and a 2026-09-12 Android 14 same-signature code 4→5 installation with launch, navigation, profile and keyboard smoke checks; the latter is not a full product regression
- iOS has not been built or tested
- Signed Android APK and SHA-256 checksum are available in GitHub Releases; binaries are not committed to Git history

安装包沿用已对齐的 SDK 57 依赖，包含此前 Hermes 已知回归与版本匹配问题的修复。Expo Doctor 21/21及574项测试通过，验证范围见 [测试说明](docs/TESTING.md)。

## 功能

- 宝宝基础资料：昵称和出生日期。
- 五类日常记录：喝奶、大便、小便、睡眠和其他事项；喝奶支持奶粉、亲喂母乳、瓶喂母乳和混合。
- 今天页与历史页：按本地日期查看统一时间线。
- 大便照片：拍照或从相册选择后保存在应用管理的本地目录。
- 喝奶提醒：由 Android 本地通知安排，不使用推送服务。
- 浅色、深色和跟随系统主题。
- CSV 导出：用于查看和分享表格数据。
- ZIP 完整备份与恢复：包含宝宝资料、五类记录、设置和大便照片。

## 界面截图

淡桃粉界面使用奶白背景、柔和的主题色和统一的记录图标，支持浅色与深色。以下为 Android API 36 模拟器实际运行截图，使用虚构宝宝“小满”和虚构记录；不是设计稿，也不代表新的真机安装包验收。

| 今天（浅色） | 今天（深色） |
| --- | --- |
| ![今天浅色](docs/screenshots/soft-rose/01-today-light.png) | ![今天深色](docs/screenshots/soft-rose/01-today-dark.png) |

| 喝奶记录 | 历史记录 |
| --- | --- |
| ![喝奶记录](docs/screenshots/soft-rose/02-feeding-light.png) | ![历史记录](docs/screenshots/soft-rose/03-records-light.png) |

| 设置 | 睡眠记录 |
| --- | --- |
| ![设置](docs/screenshots/soft-rose/04-settings-light.png) | ![睡眠记录](docs/screenshots/soft-rose/07-sleep-light.png) |

[完整七页浅深色图库](docs/screenshots/soft-rose/README.md)还包括大便、小便及对应深色界面。[更新说明](docs/RELEASE-NOTES.md)记录本次变化与验证边界。

`docs/screenshots` 根目录的旧截图保留为早期功能示例，其中界面样式不代表本次改版。

## 技术栈

- Expo SDK 57.0.22
- React Native 0.86.3 / React 19.2.3
- TypeScript 6.0.3 / Expo Router 57.0.21
- Expo SQLite 57.0.3
- Jest 29.7.0 / jest-expo 57.0.5

依赖的精确版本以 `package-lock.json` 为准。Expo SDK 57 的版本化文档见 [Expo SDK 57 文档](https://docs.expo.dev/versions/v57.0.0/)。

## 本地数据架构

SQLite 是业务数据的事实来源，当前 `user_version=9`。完整备份新建时写入 `formatVersion=2`，可恢复历史 `formatVersion=1` 和当前 `formatVersion=2`；CSV 固定 33 列，前 32 列保持兼容，第 33 列为 `breast_milk_amount_ml`。代码按职责分为：

- `src/domain`：业务类型、校验、日期、统计和导出/备份格式规则。
- `src/application`：用例服务，协调数据仓库、照片、通知和文件能力。
- `src/data`：SQLite 仓库及 Expo 文件、分享、照片和通知适配器。
- `src/features`：功能界面与交互。
- `src/app`：Expo Router 路由入口。

应用没有产品服务器、远程 API 或云数据库。更完整的设计见 [架构说明](docs/ARCHITECTURE.md)。

## 隐私设计

- 无账号、无服务器、无云数据库、无多设备同步。
- 不集成广告、分析服务或 Expo Push Token。
- 宝宝资料和五类记录默认保存在当前设备的本地 SQLite 数据库中；大便照片保存在应用管理的本地文件目录中。
- CSV 仅用于查看和分享，不包含照片，也不是完整备份。
- ZIP 是完整本地备份，但当前未加密，需要用户自行安全保存。
- Android 系统级自动备份或设备迁移可能按系统策略处理应用数据；这与应用主动上传或产品同步不同。

详情见 [隐私说明](PRIVACY.md) 和 [数据导出与备份](docs/DATA-PORTABILITY.md)。

## 开发环境

建议使用：

- Node.js 22.13 或更高版本（封板验证使用 Node.js 24）
- npm 11
- JDK 17
- Android Studio、Android SDK，以及 Android 模拟器或已授权的真机

在 Windows 上建议把项目克隆到名称较短、仅含 ASCII 字符的目录，以减少原生工具链的路径兼容问题。

安装依赖：

```bash
npm ci
```

## 启动方式

首次创建并安装 Android development build：

```bash
npm run android
```

之后仅修改 JavaScript/TypeScript 时，启动 Metro 并从设备打开已安装的 development build：

```bash
npm run start:dev-client
```

项目使用原生模块，普通开发以 development build 为准。安装或升级原生依赖、修改 config plugin 或原生配置后，需要重新运行 `npm run android`。

## 自动测试

```bash
npm test -- --runInBand
npm run test:schema
npm run typecheck
npm run lint
npm run test:assets
npm run test:ui-assets
npx expo-doctor
npx expo config --type public
npx expo export --platform android --output-dir dist
```

`test:schema` 检查宿主 SQLite 的迁移与 schema 契约；它不替代 Android 上的原生 SQLite 集成验证。测试范围和 Android 验证边界见 [测试说明](docs/TESTING.md)。

## Android 开发构建

`npm run android` 使用 Expo 的本地 Android 工具链生成并编译 development build。普通开发构建不需要 release keystore，也不需要仓库外的签名配置。生成的 `android/`、Gradle 缓存和构建产物均被忽略，不应提交。

维护者签名的 APK 通过 GitHub Releases 提供；签名密钥和本地构建配置不公开，APK/AAB 不提交到 Git。应用商店上架不在当前发布范围内。

## 当前限制

- 当前仅完成 Android 版本；iOS、Web 均未完成产品验收。
- 面向单设备上的一名主要照护者，没有家庭协作或多设备同步。
- 本地通知受权限、省电、勿扰和设备厂商后台策略影响，不保证精确送达。
- CSV 不包含照片，不能用于完整恢复。
- ZIP 备份未加密；系统分享后的文件处理由用户选择的应用负责。
- 不提供账号恢复、云端恢复或远程数据删除能力。
- 当前通过 GitHub Releases 提供 Android APK，尚未通过应用商店分发。

## 路线图

1. 收集 Android 安装包和源码的公开反馈并进行必要维护。
2. 单独规划和实施 iOS 构建、设备验证与发布准备。
3. 持续维护 GitHub Releases 的 Android APK、版本说明和校验文件。

## AI 辅助开发说明

本项目在需求梳理、实现建议、测试设计和文档整理中使用了 AI 辅助工具。产品取舍、代码审查、验收标准、真机验证和最终发布决策由维护者负责。AI 生成内容不替代人工审查、设备测试或专业意见。

## 非医疗产品免责声明

《宝宝今天》是日常记录工具，不是医疗器械，不提供诊断、治疗、用药、喂养或健康风险判断。界面中的颜色、数量、间隔和统计仅用于记录与回顾。如对宝宝健康有疑问，请及时咨询合格的医疗专业人员。

## 版权与许可

Copyright © 2026 ZestJT（钟锦涛）。

本项目原创代码和文档采用 [MIT License](LICENSE)。MIT 允许使用、复制、修改、分发、再许可和商业使用，但必须保留版权与许可声明，且软件按“原样”提供、不附带担保。

第三方组件、字体和素材仍分别适用其原始许可证，见 [第三方声明](THIRD_PARTY_NOTICES.md)；项目名称、图标和品牌资产不因代码采用 MIT 而自动获得商标授权。
