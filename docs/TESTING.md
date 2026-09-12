# 测试说明

## 自动化基线

当前 Android 1.1.1 / code 6 源码基线包含 97 个 Jest test suites、574 个测试，以及独立的 SQLite schema 检查。当前数据合同为 SQLite `user_version=9`；完整备份新建时写入 `formatVersion=2`，可恢复历史 `formatVersion=1` 和当前 `formatVersion=2`；CSV 固定 33 列，前 32 列保持兼容，第 33 列为 `breast_milk_amount_ml`；喝奶方式为奶粉、亲喂母乳、瓶喂母乳和混合。公共导出需要在干净目录重新安装依赖并复跑全部检查，不能复用私有工作目录中的缓存或忽略文件。

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

2026-09-12 为 Android 新版安装升级到 `expo@57.0.22`、`react-native@0.86.3`、Hermes compiler `250829098.0.17`、Reanimated `4.5.1` 和 Worklets `0.10.1`，并对齐 SDK 57 相关依赖。最新 Expo Doctor **21/21 通过**，`expo install --check` 确认版本匹配；573项测试、schema9、typecheck、lint、两套素材检查、公开配置、Android生产导出和Windows构建脚本测试均通过。`@react-native/jest-preset` 显式固定为 `0.86.3`，与 React Native 的精确 peer 要求一致。

2026-09-09 源码预览时 Expo Doctor 为 **19/21，两项未通过**，以下问题已由上述补丁升级解决：

- Hermes V1：当时的 `expo@57.0.4` / `react-native@0.86.0` 使用受已知内存回归影响的Hermes版本。官方说明在 `expo@57.0.9` / React Native 0.86.2及后续版本修复；后续补丁还修复了开发启动变慢的问题，见 [SDK57已知回归](https://expo.dev/changelog/sdk-57#known-regressions)。
- 依赖匹配：29个包落后于SDK57当前建议值，其中 `react-native-screens` 为minor差异，其他为patch差异。

2026-09-12 在公开仓重新执行 `npm ci` 后，97组573项测试、schema9、typecheck、lint、两套素材检查、Expo Doctor 21/21、公开配置和Android export通过。首次并行检查中有一项设置页测试触及默认5秒超时；随后单独复查该组9项测试，并在其他检查结束后重跑完整573项，均通过，没有放宽超时或改动测试。公开源码和签名构建所用的运行文件与依赖一致，素材清单仅保留公开来源说明。

1.1.1 的小便表单回归覆盖：新增和编辑时直接显示选填字段、只记时间保存、填写及取消选择、旧记录回显和保存防重入。修复先以同签名测试包覆盖安装到 Android 14 手机，由使用者确认测试无问题；正式发布调整为 `1.1.1 / code 6`，功能源码与该测试包一致。这不代表对正式版本包重新开展全部真机回归。

最新安装包通过 `v1.1.1` Release 提供；`v1.1.0` 及 `ui-soft-rose-2026-09-09` 标签保留历史版本。2026-08-07 的19/20仅为历史检查记录。

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

2026-09-12 的 `1.1.0 / code 5` 正式签名 APK/AAB 构建成功。在已连接的 Android 14 真机执行 code 4→5 覆盖安装，核对包名、版本、签名、原首次安装时间和数据目录标识；宝宝资料、提醒及主题设置仍然显示。检查首页、记录、设置、喝奶表单、键盘弹出与返回，并冷启动复查；安装后 crash buffer 未发现本应用新增崩溃。此次未写入测试记录、替换数据或执行备份恢复，也没有对整库和照片做字节比较，不替代完整产品回归。

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
