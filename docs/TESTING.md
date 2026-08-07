# 测试说明

## 自动化基线

当前 Android 1.0.1 源码基线包含 91 个 Jest test suites、524 个测试，以及独立的 SQLite schema 检查。当前数据合同为 SQLite `user_version=9`；完整备份新建时写入 `formatVersion=2`，可恢复历史 `formatVersion=1` 和当前 `formatVersion=2`；CSV 固定 33 列，前 32 列保持兼容，第 33 列为 `breast_milk_amount_ml`；喝奶方式为奶粉、亲喂母乳、瓶喂母乳和混合。公共导出需要在干净目录重新安装依赖并复跑全部检查，不能复用私有工作目录中的缓存或忽略文件。

常用命令：

```bash
npm ci
npm test -- --runInBand
npm run test:schema
npm run typecheck
npm run lint
npm run test:assets
npx expo-doctor
npx expo config --type public
npx expo export --platform android --output-dir dist
```

当前 Expo Doctor 基线为 19/20。未通过的是依赖版本匹配检查：`react-native-screens` 为 minor mismatch，另有 28 个 Expo/相关包为 patch mismatch，共 29 个包落后于 SDK 57 当前建议版本；本轮不把它伪报为 20/20，也不在源码发布中顺带升级依赖。

## 各检查的职责

- Jest：覆盖领域校验、日期与时间线、五类服务、SQLite repository、迁移、提醒、CSV、备份恢复和主要界面行为。
- `test:schema`：在宿主 SQLite 中顺序执行迁移并核对 schema、约束和最终 `user_version=9`。
- TypeScript：检查静态类型边界。
- ESLint：检查源码和配置的代码质量规则。
- Expo Doctor：检查 Expo SDK 与依赖兼容性。
- Expo public config：确认公开配置可解析且不含私有 Expo/EAS 项目关联。
- Android asset contract：核对正式图标/启动图的路径、尺寸、SHA-256 和封板配置。
- Android export：验证 Metro 能为 Android 生成生产 JS/asset bundle；它不是签名 APK 构建。

`test:schema` 使用宿主 SQLite，不冒充 Android 原生集成测试。涉及 `expo-sqlite` 原生能力、文件系统、系统分享、相机/相册、通知和主题的行为仍需在 Android development build 上验证。

## Android 验证摘要

当前 Android 1.0.1 / `versionCode=4` 源码已完成自动化、API 36 模拟器和 Android 14 真机验证；使用同一长期签名完成 code 3→4 原位覆盖升级，签名 APK/AAB 只保存在仓库外，不随源码发布：

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
