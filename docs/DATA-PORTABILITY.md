# 数据导出与备份

《宝宝今天》提供两种用途不同的数据携带方式：CSV 用于查看和分享，ZIP 用于完整备份与恢复。两者不能互相替代。

## CSV：查看和分享

CSV 包含宝宝资料和五类记录，不包含照片文件，只以 `has_photo` 表示大便记录是否带照片。当前 Android 1.0.1 源码的列契约固定为 32 列，顺序如下：

```text
record_id,baby_name,baby_birth_date,record_type,record_type_label,
record_date,event_time,feeding_type,feeding_type_label,milk_amount_ml,
left_duration_min,right_duration_min,poop_color,poop_color_label,
poop_texture,poop_texture_label,poop_amount,poop_amount_label,has_photo,
pee_color,pee_color_label,pee_amount,pee_amount_label,sleep_status,
sleep_status_label,sleep_start_time,sleep_end_time,sleep_duration_minutes,
other_title,note,created_at,updated_at
```

文件使用 UTF-8 BOM、逗号分隔和 CRLF 行尾。记录按事件时间、创建时间和记录 ID 稳定排序；用户输入字段会处理常见的表格公式注入前缀。

CSV 不能导回应用，不能恢复照片、主题或提醒设置，因此不是完整备份。

## ZIP：完整备份

当前完整备份格式为 `formatVersion=1`，归档包含：

- `manifest.json`：格式、版本、应用/schema 信息、记录计数、照片计数、总大小和 SHA-256 完整性信息。
- `baby.json`：宝宝资料。
- `records.json`：五类记录及照片归档引用。
- `settings.json`：主题和喝奶提醒设置。
- `photos/*.jpg`：受管的大便照片。

ZIP 不包含通知权限、系统通知 ID、开发环境、构建信息或签名材料。备份文件当前未加密；任何能够读取该 ZIP 的人都可能看到其中的家庭数据和照片。请由用户自行把它保存在可信、受访问控制的位置。

## 恢复语义

恢复是“替换当前数据”，不是合并：

1. 在应用私有暂存区检查 ZIP 结构、路径、单项/总大小和允许的文件类型。
2. 校验 manifest、JSON 字段、记录约束、计数和 SHA-256。
3. 向用户展示恢复摘要并再次确认。
4. 创建当前数据的恢复前安全备份。
5. 复制新照片，并在 SQLite 事务中替换业务数据。
6. 提交后协调旧照片清理、提醒重建和界面刷新。

SQLite 提交前发生失败时，当前业务数据不会被部分替换；已复制的新照片会尽量补偿清理。提交后的非关键清理如失败，会在后续启动继续协调。

## 恢复前安全备份与撤销

应用保留最近一次恢复前的本地安全备份，并通过同一套校验、预览和确认流程支持撤销最近一次恢复。它位于应用私有目录，可能随卸载、系统清理或设备故障而丢失，不能代替用户自行保存的 ZIP。

再次恢复可能更新可撤销的安全副本。需要长期保留多个时间点时，应在恢复前主动创建 ZIP 并安全保存到应用外的受控位置。

## 日期与时区

每条记录保留创建时的本地 `record_date`。把备份恢复到其他时区不会按新设备时区重写历史日期；manifest 中的来源时区和偏移只用于说明。

## 安全保存建议

- 不要把 ZIP 或 CSV 提交到源码仓库、公开 Issue 或聊天记录。
- 不要把真实数据作为 bug 复现附件。
- 分享前确认接收应用和接收人，并在不再需要时删除副本。
- 系统云备份、设备迁移、手动 ZIP 和 CSV 分享是不同的数据流，应分别管理。
