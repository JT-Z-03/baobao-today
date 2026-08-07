import type {
  BackupBaby,
  BackupData,
  BackupFormatVersion,
  BackupRecord,
  BackupRecordType,
  BackupSettings,
} from './backup-types';
import { BACKUP_FORMAT_VERSION } from './backup-manifest';

export class BackupValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

const recordKeysV2 = [
  'id', 'client_request_id', 'create_payload_hash', 'type', 'event_time_ms', 'record_date',
  'sort_time_ms', 'created_at_ms', 'updated_at_ms', 'note', 'feeding_type', 'milk_amount_ml',
  'breast_milk_amount_ml',
  'left_duration_min', 'right_duration_min', 'poop_color', 'poop_texture', 'poop_amount',
  'photo_backup_entry', 'photo_sha256', 'pee_color', 'pee_amount', 'sleep_start_ms',
  'sleep_end_ms', 'sleep_status', 'other_title',
] as const;
const recordKeysV1 = recordKeysV2.filter((key) => key !== 'breast_milk_amount_ml');

function fail(code: string, message: string): never {
  throw new BackupValidationError(code, message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-structure', `${label}结构无效`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const expected = new Set(keys);
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !expected.has(key))) {
    fail('unexpected-field', `${label}包含不支持的字段`);
  }
}

function text(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'string' || value.length < min || value.length > max) fail('invalid-text', `${label}无效`);
  return value;
}

function nullableText(value: unknown, label: string, max: number) {
  if (value === null) return null;
  return text(value, label, 0, max);
}

function integer(value: unknown, label: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    fail('invalid-number', `${label}无效`);
  }
  return value as number;
}

function nullableInteger(value: unknown, label: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  if (value === null) return null;
  return integer(value, label, min, max);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail('invalid-enum', `${label}无效`);
  return value as T;
}

function nullableEnum<T extends string>(value: unknown, values: readonly T[], label: string): T | null {
  if (value === null) return null;
  return enumValue(value, values, label);
}

function stableId(value: unknown, label: string) {
  const result = text(value, label, 1, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(result)) fail('invalid-id', `${label}格式无效`);
  return result;
}

function sha256(value: unknown, label: string) {
  const result = text(value, label, 64, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) fail('invalid-hash', `${label}无效`);
  return result;
}

export function validateHistoricalDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail('invalid-date', '历史记录日期格式无效');
  }
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() + 1 !== month || candidate.getUTCDate() !== day) {
    fail('invalid-date', '历史记录日期不是有效公历日期');
  }
  return value;
}

function allNull(record: BackupRecord, fields: (keyof BackupRecord)[], label: string) {
  if (fields.some((field) => record[field] !== null)) fail('field-isolation', `${label}包含其他记录类型字段`);
}

function validateRecord(raw: unknown, index: number, formatVersion: BackupFormatVersion): BackupRecord {
  const row = object(raw, `第${index + 1}条记录`);
  exactKeys(row, formatVersion === 1 ? recordKeysV1 : recordKeysV2, `第${index + 1}条记录`);
  const record: BackupRecord = {
    id: stableId(row.id, '记录ID'),
    client_request_id: stableId(row.client_request_id, '请求ID'),
    create_payload_hash: sha256(row.create_payload_hash, '创建载荷hash'),
    type: enumValue(row.type, ['feeding', 'poop', 'pee', 'sleep', 'other'] as const, '记录类型'),
    event_time_ms: integer(row.event_time_ms, '事件时间'),
    record_date: validateHistoricalDate(row.record_date),
    sort_time_ms: integer(row.sort_time_ms, '排序时间'),
    created_at_ms: integer(row.created_at_ms, '创建时间', 0),
    updated_at_ms: integer(row.updated_at_ms, '更新时间', 0),
    note: nullableText(row.note, '备注', 200),
    feeding_type: nullableEnum(
      row.feeding_type,
      formatVersion === 1 ? ['breast', 'formula', 'mixed'] as const : ['breast', 'formula', 'bottle_breast', 'mixed'] as const,
      '喂养方式',
    ),
    milk_amount_ml: nullableInteger(row.milk_amount_ml, '奶量', 0, 999),
    breast_milk_amount_ml: formatVersion === 1
      ? null : nullableInteger(row.breast_milk_amount_ml, '瓶喂母乳量', 0, 999),
    left_duration_min: nullableInteger(row.left_duration_min, '左侧时长', 0, 180),
    right_duration_min: nullableInteger(row.right_duration_min, '右侧时长', 0, 180),
    poop_color: nullableEnum(row.poop_color, ['yellow', 'green', 'brown', 'black', 'red', 'other'] as const, '大便颜色'),
    poop_texture: nullableEnum(row.poop_texture, ['watery', 'loose', 'pasty', 'formed', 'pellet'] as const, '大便状态'),
    poop_amount: nullableEnum(row.poop_amount, ['small', 'medium', 'large'] as const, '大便量'),
    photo_backup_entry: row.photo_backup_entry === null ? null : text(row.photo_backup_entry, '照片引用', 1, 180),
    photo_sha256: row.photo_sha256 === null ? null : sha256(row.photo_sha256, '照片hash'),
    pee_color: nullableEnum(row.pee_color, ['clear', 'pale-yellow', 'yellow', 'dark-yellow'] as const, '小便颜色'),
    pee_amount: nullableEnum(row.pee_amount, ['small', 'medium', 'large'] as const, '小便量'),
    sleep_start_ms: nullableInteger(row.sleep_start_ms, '睡眠开始'),
    sleep_end_ms: nullableInteger(row.sleep_end_ms, '睡眠结束'),
    sleep_status: nullableEnum(row.sleep_status, ['sleeping', 'completed'] as const, '睡眠状态'),
    other_title: nullableText(row.other_title, '其他标题', 30),
  };

  const feedingFields: (keyof BackupRecord)[] = [
    'feeding_type', 'milk_amount_ml', 'breast_milk_amount_ml', 'left_duration_min', 'right_duration_min',
  ];
  const poopFields: (keyof BackupRecord)[] = ['poop_color', 'poop_texture', 'poop_amount', 'photo_backup_entry', 'photo_sha256'];
  const peeFields: (keyof BackupRecord)[] = ['pee_color', 'pee_amount'];
  const sleepFields: (keyof BackupRecord)[] = ['sleep_start_ms', 'sleep_end_ms', 'sleep_status'];

  if (record.type === 'feeding') {
    allNull(record, [...poopFields, ...peeFields, ...sleepFields, 'other_title'], '喝奶记录');
    const total = (record.left_duration_min ?? 0) + (record.right_duration_min ?? 0);
    const directBreast = record.left_duration_min !== null || record.right_duration_min !== null;
    const validDirectBreast = !directBreast || (record.left_duration_min !== null
      && record.right_duration_min !== null && total > 0);
    const valid = formatVersion === 1
      ? (record.feeding_type === 'formula' && record.milk_amount_ml !== null && record.milk_amount_ml > 0
        && record.left_duration_min === null && record.right_duration_min === null)
        || (record.feeding_type === 'breast' && record.milk_amount_ml === null && record.left_duration_min !== null
          && record.right_duration_min !== null && total > 0)
        || (record.feeding_type === 'mixed' && record.milk_amount_ml !== null && record.milk_amount_ml > 0
          && record.left_duration_min !== null && record.right_duration_min !== null && total > 0)
      : (record.feeding_type === 'formula' && record.milk_amount_ml !== null && record.milk_amount_ml > 0
        && record.breast_milk_amount_ml === null && !directBreast)
        || (record.feeding_type === 'breast' && record.milk_amount_ml === null && record.breast_milk_amount_ml === null
          && validDirectBreast && directBreast)
        || (record.feeding_type === 'bottle_breast' && record.milk_amount_ml === null
          && record.breast_milk_amount_ml !== null && record.breast_milk_amount_ml > 0 && !directBreast)
        || (record.feeding_type === 'mixed'
          && (record.milk_amount_ml === null || record.milk_amount_ml > 0)
          && (record.breast_milk_amount_ml === null || record.breast_milk_amount_ml > 0)
          && validDirectBreast
          && Number(record.milk_amount_ml !== null) + Number(record.breast_milk_amount_ml !== null) + Number(directBreast) >= 2);
    if (!valid) fail('invalid-feeding', '喝奶记录语义无效');
  } else if (record.type === 'poop') {
    allNull(record, [...feedingFields, ...peeFields, ...sleepFields, 'other_title'], '大便记录');
    if ((record.photo_backup_entry === null) !== (record.photo_sha256 === null)) fail('invalid-photo-reference', '照片引用不完整');
    if (record.photo_backup_entry && !/^photos\/[A-Za-z0-9][A-Za-z0-9_-]*\.jpg$/.test(record.photo_backup_entry)) {
      fail('invalid-photo-reference', '照片归档路径无效');
    }
  } else if (record.type === 'pee') {
    allNull(record, [...feedingFields, ...poopFields, ...sleepFields, 'other_title'], '小便记录');
  } else if (record.type === 'sleep') {
    allNull(record, [...feedingFields, ...poopFields, ...peeFields, 'other_title'], '睡眠记录');
    if (record.sleep_start_ms === null || record.event_time_ms !== record.sleep_start_ms
      || record.sort_time_ms !== record.sleep_start_ms) fail('invalid-sleep-derived', '睡眠派生字段无效');
    if (record.sleep_status === 'sleeping' && record.sleep_end_ms !== null) fail('invalid-sleep', '进行中睡眠不能有结束时间');
    if (record.sleep_status === 'completed'
      && (record.sleep_end_ms === null || record.sleep_end_ms <= record.sleep_start_ms)) {
      fail('invalid-sleep', '已完成睡眠结束时间无效');
    }
  } else {
    allNull(record, [...feedingFields, ...poopFields, ...peeFields, ...sleepFields], '其他记录');
    if (record.other_title === null || record.other_title.trim().length < 1) fail('invalid-other', '其他记录标题无效');
  }
  if (record.type !== 'sleep' && record.sort_time_ms !== record.event_time_ms) {
    fail('invalid-derived-field', '普通记录排序时间与事件时间不一致');
  }
  return record;
}

function validateBaby(raw: unknown): BackupBaby {
  const value = object(raw, '宝宝资料');
  exactKeys(value, ['id', 'name', 'birth_date', 'created_at_ms', 'updated_at_ms'], '宝宝资料');
  const name = text(value.name, '宝宝昵称', 1, 20);
  if (!name.trim()) fail('invalid-baby', '宝宝昵称不能为空');
  return {
    id: stableId(value.id, '宝宝ID'),
    name,
    birth_date: validateHistoricalDate(value.birth_date),
    created_at_ms: integer(value.created_at_ms, '宝宝资料创建时间', 0),
    updated_at_ms: integer(value.updated_at_ms, '宝宝资料更新时间', 0),
  };
}

function validateSettings(raw: unknown): BackupSettings {
  const value = object(raw, '设置');
  exactKeys(value, ['theme_mode', 'feeding_reminder_enabled', 'feeding_reminder_interval_minutes'], '设置');
  const theme_mode = enumValue(value.theme_mode, ['system', 'light', 'dark'] as const, '主题模式');
  if (typeof value.feeding_reminder_enabled !== 'boolean') fail('invalid-settings', '提醒启用状态无效');
  const feeding_reminder_interval_minutes = nullableInteger(
    value.feeding_reminder_interval_minutes, '提醒间隔', 15, 1440,
  );
  if (value.feeding_reminder_enabled !== (feeding_reminder_interval_minutes !== null)) {
    fail('invalid-settings', '提醒启用状态与间隔不一致');
  }
  return { theme_mode, feeding_reminder_enabled: value.feeding_reminder_enabled, feeding_reminder_interval_minutes };
}

export function validateBackupData(
  raw: unknown,
  formatVersion: BackupFormatVersion = BACKUP_FORMAT_VERSION,
): BackupData {
  const value = object(raw, '备份数据');
  exactKeys(value, ['baby', 'records', 'settings'], '备份数据');
  if (!Array.isArray(value.records) || value.records.length > 100_000) fail('invalid-records', '记录列表无效或过大');
  const records = value.records.map((record, index) => validateRecord(record, index, formatVersion));
  const ids = new Set<string>();
  const requests = new Set<string>();
  const photos = new Set<string>();
  let sleeping = 0;
  for (const record of records) {
    if (ids.has(record.id)) fail('duplicate-record-id', '备份中存在重复记录ID');
    if (requests.has(record.client_request_id)) fail('duplicate-request-id', '备份中存在重复请求ID');
    ids.add(record.id);
    requests.add(record.client_request_id);
    if (record.sleep_status === 'sleeping' && ++sleeping > 1) fail('multiple-sleeping', '备份中存在多条进行中睡眠');
    if (record.photo_backup_entry) {
      if (photos.has(record.photo_backup_entry)) fail('duplicate-photo-reference', '同一照片被多条记录引用');
      photos.add(record.photo_backup_entry);
    }
  }
  return { baby: validateBaby(value.baby), records, settings: validateSettings(value.settings) };
}

export function countBackupRecords(records: readonly BackupRecord[]) {
  const counts: Record<BackupRecordType, number> = { feeding: 0, poop: 0, pee: 0, sleep: 0, other: 0 };
  for (const record of records) counts[record.type] += 1;
  return counts;
}
