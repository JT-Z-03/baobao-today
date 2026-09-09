# 测试说明

## 自动化基线

当前 Android 1.0.1 源码基线包含 97 个 Jest test suites、573 个测试，以及独立的 SQLite schema 检查。当前数据合同为 SQLite `user_version=9`；完整备份新建时写入 `formatVersion=2`，可恢复历史 `formatVersion=1` 和当前 `formatVersion=2`；CSV 固定 33 列，前 32 列保持兼容，第 33 列为 `breast_milk_amount_ml`；喝奶方式为奶粉、亲喂母乳、瓶喂母乳和混合。公共导出需要在干净目录重新安装依赖并复跑全部检查，不能复用私有工作目录中的缓存或忽略文件。

常用命令：

```bash
npm ci
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

2026-09-09 在公开源码的干净目录执行 `npm ci` 后，97组573项测试、schema9、typecheck、lint、6张品牌素材、12张UI素材、Expo public config和Android export均通过。公开配置不包含私有Expo/EAS项目关联；Android导出包含1631模块及65个素材，其中包含全部12张UI PNG。

最新 Expo Doctor 为 **19/21，两项未通过**：

- Hermes V1：当前 `expo@57.0.4` / `react-native@0.86.0` 使用受已知内存回归影响的Hermes版本。官方说明在 `expo@57.0.9` / React Native 0.86.2及后续版本修复；后续补丁还修复了开发启动变慢的问题，见 [SDK57已知回归](https://expo.dev/changelog/sdk-57#known-regressions)。本项目依赖Reanimated/Worklets，不将该提醒当作无关警告。
- 依赖匹配：29个包落后于SDK57当前建议值，其中 `react-native-screens` 为minor差异，其他为patch差异。

这些问题来自未变更的基础依赖，不是本轮新增的UI依赖；本次源码同步没有升级或忽略它们。本轮发布标记为源码预览版，不能据此声明可发布正式安装包。正式构建前需升级匹配的Expo/React Native及相关依赖、重建development build，并复验数据、键盘、导航及真机行为。2026-08-07 的19/20仅为历史检查记录。

## 各检查的职责

- Jest：覆盖领域校验、日期与时间线、五类服务、SQLite repository、迁移、提醒、CSV、备份恢复和主要界面行为。
- `test:schema`：在宿主 SQLite 中顺序执行迁移并核对 schema、约束和最终 `user_version=9`。
- TypeScript：检查静态类型边界。
- ESLint：检查源码和配置的代码质量规则。
- Expo Doctor：检查 Expo SDK 与依赖兼容性。
- Expo public config：确认公开配置可解析且不含私有 Expo/EAS 项目关联。
- Android asset contract：核对正式图标/启动图的路径、尺寸、SHA-256 和封板配置。
- UI asset contract：核对12张运行PNG的尺寸、透明度、留白、来源说明和SHA-256。
- Android export：验证 Metro 能为 Android 生成生产 JS/asset bundle；它不是签名 APK 构建。

`test:schema` 使用宿主 SQLite，不冒充 Android 原生集成测试。涉及 `expo-sqlite` 原生能力、文件系统、系统分享、相机/相册、通知和主题的行为仍需在 Android development build 上验证。

## Android 验证摘要

2026-09-09 淡桃粉 UI 已完成API 36模拟器七页浅深色、输入保存、返回与前后台、部分小屏和大字状态走查；本次未新构建APK/AAB或完成新的真机覆盖升级。Android 普通展示文字关闭长按选择以规避原生崩溃，输入框保留手动编辑与选择；喂养数值框关闭Android聚焦自动全选以避免首位数字被覆盖。下列真机记录仅属于改版前的功能基线。

2026-08-07 的 Android 1.0.1 / `versionCode=4` 功能基线已完成自动化、API 36 模拟器和 Android 14 真机验证；使用同一长期签名完成 code 3→4 原位覆盖升级，签名 APK/AAB 只保存在仓库外，不随源码发布：

- App 能安装和启动，公开配置与已安装包显示 `1.0.1` / `versionCode=4`。
- SQLite `user_version=9` 升级和四种喝奶方式通过自动化检查；模拟器与真机使用虚构数据验证瓶喂母乳毫升数、混合喂养数量、今日统计、编辑和删除闭环。
- 今天、记录和设置三个 Native Tabs 一级页面的 API 36 顶部、底部安全区正常。
- 喝奶与睡眠表单、CSV 导出页、完整备份与恢复页可以打开并正常布局；真机验证 CSV 与完整备份能够进入系统分享面板。
- production-like bundle 使用 `dev=false`、`minify=true`，不显示开发验收工具、Expo、Metro 或 LogBox 浮层。
- 验证过程没有 App crash；真机验证首次通知权限、提醒重排、强关重开后的单一提醒收敛和系统分享入口。相机以及跨设备真实备份文件恢复仍沿用既有验收和自动测试，不在本次功能回归中重新声明。

公开说明不包含设备序列号、家庭数据、原始设备日志或内部验收文件。不同 Android 厂商的通知和后台策略可能不同，贡献者应记录系统版本和设备类别，但不要提交唯一设备标识。

## Pull Request 最小检查

提交源码改动前至少运行 Jest、schema、TypeScript、ESLint 和资产契约。涉及 Expo 配置或依赖时，再运行 Expo Doctor、public config 和 Android export；涉及原生能力时，补充使用虚构数据的 Android development build 验证。

普通开发和测试不需要 release keystore。不得把 APK、AAB、JKS/keystore、`key.properties`、数据库、CSV、ZIP、照片或设备原始证据提交到仓库。
