import type { FeedingType } from '@/domain/feeding/feeding';
import type { OtherRecord } from '@/domain/other/other';
import type { PeeAmount, PeeColor } from '@/domain/pee/pee';
import type { PoopAmount, PoopColor, PoopTexture } from '@/domain/poop/poop';
import type { SleepStatus } from '@/domain/sleep/sleep';

export const CSV_EXPORT_COLUMNS = [
  'record_id', 'baby_name', 'baby_birth_date', 'record_type', 'record_type_label',
  'record_date', 'event_time', 'feeding_type', 'feeding_type_label', 'milk_amount_ml',
  'left_duration_min', 'right_duration_min', 'poop_color', 'poop_color_label',
  'poop_texture', 'poop_texture_label', 'poop_amount', 'poop_amount_label', 'has_photo',
  'pee_color', 'pee_color_label', 'pee_amount', 'pee_amount_label', 'sleep_status',
  'sleep_status_label', 'sleep_start_time', 'sleep_end_time', 'sleep_duration_minutes',
  'other_title', 'note', 'created_at', 'updated_at',
] as const;

type ExportRecordBase = {
  id: string;
  eventTimeMs: number;
  recordDate: string;
  createdAtMs: number;
  updatedAtMs: number;
  note: string | null;
};

export type ExportRecord =
  | (ExportRecordBase & {
      type: 'feeding';
      feedingType: FeedingType;
      milkAmountMl: number | null;
      leftDurationMin: number | null;
      rightDurationMin: number | null;
    })
  | (ExportRecordBase & {
      type: 'poop';
      poopColor: PoopColor | null;
      poopTexture: PoopTexture | null;
      poopAmount: PoopAmount | null;
      hasPhoto: boolean;
    })
  | (ExportRecordBase & {
      type: 'pee';
      peeColor: PeeColor | null;
      peeAmount: PeeAmount | null;
    })
  | (ExportRecordBase & {
      type: 'sleep';
      sleepStatus: SleepStatus;
      sleepStartMs: number;
      sleepEndMs: number | null;
    })
  | Pick<OtherRecord, 'id' | 'type' | 'eventTimeMs' | 'recordDate' | 'createdAtMs' | 'updatedAtMs' | 'title' | 'note'>;

export type ExportSnapshot = {
  capturedAtMs: number;
  baby: { name: string; birthDate: string };
  records: readonly ExportRecord[];
};

const recordTypeLabels = {
  feeding: '喝奶', poop: '大便', pee: '小便', sleep: '睡眠', other: '其他',
} as const;
const feedingTypeLabels = { formula: '奶粉', breast: '母乳', mixed: '混合' } as const;
const poopColorLabels = {
  yellow: '黄色', green: '绿色', brown: '棕色', black: '黑色', red: '红色', other: '其他',
} as const;
const poopTextureLabels = {
  watery: '稀', soft: '稀软', mushy: '糊状', formed: '成形', pellet: '颗粒',
} as const;
const amountLabels = { small: '少', medium: '中', large: '多' } as const;
const peeColorLabels = {
  clear: '透明', light_yellow: '淡黄', yellow: '黄色', dark_yellow: '深黄',
} as const;
const sleepStatusLabels = { sleeping: '进行中', completed: '已完成' } as const;
const USER_CONTROLLED_TEXT_COLUMNS = new Set([1, 28, 29]);

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function formatLocalDateTime(timestampMs: number) {
  const value = new Date(timestampMs);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function protectUserText(value: string) {
  const firstNonSpace = value.replace(/^ +/, '')[0];
  return firstNonSpace && /^[=+\-@\t\r]$/.test(firstNonSpace) ? `'${value}` : value;
}

function encodeCell(value: string | number | boolean | null | undefined, userText = false) {
  if (value === null || value === undefined) return '';
  const text = userText ? protectUserText(String(value)) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowFor(record: ExportRecord, snapshot: ExportSnapshot) {
  const values: (string | number | boolean | null | undefined)[] = [
    record.id,
    snapshot.baby.name,
    snapshot.baby.birthDate,
    record.type,
    recordTypeLabels[record.type],
    record.recordDate,
    formatLocalDateTime(record.eventTimeMs),
  ];

  if (record.type === 'feeding') {
    values.push(record.feedingType, feedingTypeLabels[record.feedingType], record.milkAmountMl,
      record.leftDurationMin, record.rightDurationMin);
  } else values.push(null, null, null, null, null);

  if (record.type === 'poop') {
    values.push(record.poopColor, record.poopColor ? poopColorLabels[record.poopColor] : null,
      record.poopTexture, record.poopTexture ? poopTextureLabels[record.poopTexture] : null,
      record.poopAmount, record.poopAmount ? amountLabels[record.poopAmount] : null, record.hasPhoto);
  } else values.push(null, null, null, null, null, null, null);

  if (record.type === 'pee') {
    values.push(record.peeColor, record.peeColor ? peeColorLabels[record.peeColor] : null,
      record.peeAmount, record.peeAmount ? amountLabels[record.peeAmount] : null);
  } else values.push(null, null, null, null);

  if (record.type === 'sleep') {
    values.push(
      record.sleepStatus,
      sleepStatusLabels[record.sleepStatus],
      formatLocalDateTime(record.sleepStartMs),
      record.sleepEndMs === null ? null : formatLocalDateTime(record.sleepEndMs),
      record.sleepEndMs === null ? null : Math.floor((record.sleepEndMs - record.sleepStartMs) / 60_000),
    );
  } else values.push(null, null, null, null, null);

  values.push(record.type === 'other' ? record.title : null, record.note,
    formatLocalDateTime(record.createdAtMs), formatLocalDateTime(record.updatedAtMs));

  return values.map((value, index) => encodeCell(value, USER_CONTROLLED_TEXT_COLUMNS.has(index))).join(',');
}

export function encodeExportSnapshotCsv(snapshot: ExportSnapshot) {
  const sorted = [...snapshot.records].sort((left, right) =>
    left.eventTimeMs - right.eventTimeMs
    || left.createdAtMs - right.createdAtMs
    || left.id.localeCompare(right.id));
  const rows = [CSV_EXPORT_COLUMNS.join(','), ...sorted.map((record) => rowFor(record, snapshot))];
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
