import { CSV_EXPORT_COLUMNS, encodeExportSnapshotCsv, type ExportSnapshot } from './csv-encoder';

const localMs = (day: number, hour: number, minute = 0) =>
  new Date(2026, 6, day, hour, minute).getTime();

function snapshot(records: ExportSnapshot['records']): ExportSnapshot {
  return {
    capturedAtMs: localMs(11, 12),
    baby: { name: '小宝', birthDate: '2026-06-20' },
    records,
  };
}

describe('CSV encoder', () => {
  test('keeps the original 32 columns and appends bottled breast milk as column 33', () => {
    expect(CSV_EXPORT_COLUMNS).toHaveLength(33);
    expect(CSV_EXPORT_COLUMNS.slice(0, 32)).toEqual([
      'record_id', 'baby_name', 'baby_birth_date', 'record_type', 'record_type_label',
      'record_date', 'event_time', 'feeding_type', 'feeding_type_label', 'milk_amount_ml',
      'left_duration_min', 'right_duration_min', 'poop_color', 'poop_color_label',
      'poop_texture', 'poop_texture_label', 'poop_amount', 'poop_amount_label', 'has_photo',
      'pee_color', 'pee_color_label', 'pee_amount', 'pee_amount_label', 'sleep_status',
      'sleep_status_label', 'sleep_start_time', 'sleep_end_time', 'sleep_duration_minutes',
      'other_title', 'note', 'created_at', 'updated_at',
    ]);
    expect(CSV_EXPORT_COLUMNS[32]).toBe('breast_milk_amount_ml');
  });

  test('uses a fixed 33-column header, UTF-8 BOM, and CRLF for an empty snapshot', () => {
    const csv = encodeExportSnapshotCsv(snapshot([]));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe(`\uFEFF${CSV_EXPORT_COLUMNS.join(',')}\r\n`);
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
  });

  test('exports bottle and formula amounts independently for mixed feeding', () => {
    const csv = encodeExportSnapshotCsv(snapshot([{
      id: 'mixed', type: 'feeding', eventTimeMs: localMs(11, 1), recordDate: '2026-07-11',
      createdAtMs: localMs(11, 1), updatedAtMs: localMs(11, 1), note: null,
      feedingType: 'mixed', milkAmountMl: 40, breastMilkAmountMl: 80,
      leftDurationMin: null, rightDurationMin: null,
    }]));
    const row = csv.split('\r\n')[1]!.split(',');
    expect(row[7]).toBe('mixed');
    expect(row[9]).toBe('40');
    expect(row[32]).toBe('80');
  });

  test('labels bottle_breast feeding as 瓶喂母乳', () => {
    const csv = encodeExportSnapshotCsv(snapshot([{
      id: 'bottle-breast', type: 'feeding', eventTimeMs: localMs(11, 1), recordDate: '2026-07-11',
      createdAtMs: localMs(11, 1), updatedAtMs: localMs(11, 1), note: null,
      feedingType: 'bottle_breast', milkAmountMl: null, breastMilkAmountMl: 80,
      leftDurationMin: null, rightDurationMin: null,
    }]));
    const row = csv.split('\r\n')[1]!.split(',');
    expect(row[7]).toBe('bottle_breast');
    expect(row[8]).toBe('瓶喂母乳');
  });

  test('maps all five source record types without internal identifiers or photo paths', () => {
    const csv = encodeExportSnapshotCsv(snapshot([
      {
        id: 'feeding-1', type: 'feeding', eventTimeMs: localMs(11, 1), recordDate: '2026-07-11',
        createdAtMs: localMs(11, 1), updatedAtMs: localMs(11, 1), note: null,
        feedingType: 'mixed', milkAmountMl: 60, breastMilkAmountMl: null, leftDurationMin: 10, rightDurationMin: 0,
      },
      {
        id: 'poop-1', type: 'poop', eventTimeMs: localMs(11, 2), recordDate: '2026-07-11',
        createdAtMs: localMs(11, 2), updatedAtMs: localMs(11, 2), note: null,
        poopColor: 'yellow', poopTexture: 'soft', poopAmount: 'medium', hasPhoto: true,
      },
      {
        id: 'pee-1', type: 'pee', eventTimeMs: localMs(11, 3), recordDate: '2026-07-11',
        createdAtMs: localMs(11, 3), updatedAtMs: localMs(11, 3), note: null,
        peeColor: 'light_yellow', peeAmount: 'small',
      },
      {
        id: 'sleep-1', type: 'sleep', eventTimeMs: localMs(10, 23), recordDate: '2026-07-10',
        createdAtMs: localMs(10, 23), updatedAtMs: localMs(11, 2), note: null,
        sleepStatus: 'completed', sleepStartMs: localMs(10, 23), sleepEndMs: localMs(11, 2),
      },
      {
        id: 'other-1', type: 'other', eventTimeMs: localMs(11, 4), recordDate: '2026-07-11',
        createdAtMs: localMs(11, 4), updatedAtMs: localMs(11, 4), title: '洗澡', note: '完成',
      },
    ]));

    expect(csv).toContain('feeding-1,小宝,2026-06-20,feeding,喝奶');
    expect(csv).toContain('mixed,混合,60,10,0');
    expect(csv).toContain('poop,大便');
    expect(csv).toContain('yellow,黄色,soft,稀软,medium,中,true');
    expect(csv).toContain('pee,小便');
    expect(csv).toContain('light_yellow,淡黄,small,少');
    expect(csv).toContain('sleep,睡眠');
    expect(csv).toContain('completed,已完成,2026-07-10 23:00:00,2026-07-11 02:00:00,180');
    expect(csv).toContain('other,其他');
    expect(csv).not.toContain('client_request_id');
    expect(csv).not.toContain('create_payload_hash');
    expect(csv).not.toContain('poop-photos/');
  });

  test('keeps active sleep end and duration empty', () => {
    const csv = encodeExportSnapshotCsv(snapshot([{
      id: 'sleeping-1', type: 'sleep', eventTimeMs: localMs(11, 5), recordDate: '2026-07-11',
      createdAtMs: localMs(11, 5), updatedAtMs: localMs(11, 5), note: null,
      sleepStatus: 'sleeping', sleepStartMs: localMs(11, 5), sleepEndMs: null,
    }]));
    expect(csv).toContain('sleeping,进行中,2026-07-11 05:00:00,,,');
  });

  test('quotes comma, quote, and multiline Chinese text with CRLF row endings', () => {
    const csv = encodeExportSnapshotCsv(snapshot([{
      id: 'other-escape', type: 'other', eventTimeMs: localMs(11, 4), recordDate: '2026-07-11',
      createdAtMs: localMs(11, 4), updatedAtMs: localMs(11, 4),
      title: '洗澡,擦身', note: '宝宝说"嗯"\n第二行备注',
    }]));
    expect(csv).toContain('"洗澡,擦身"');
    expect(csv).toContain('"宝宝说""嗯""\n第二行备注"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  test.each(['=1+1', '+123', '-10', '@test', '\tcmd', '\rnext'])(
    'protects formula-like user text %p without changing ordinary numeric fields',
    (dangerous) => {
      const csv = encodeExportSnapshotCsv(snapshot([{
        id: 'formula-1', type: 'feeding', eventTimeMs: localMs(11, 4), recordDate: '2026-07-11',
        createdAtMs: localMs(11, 4), updatedAtMs: localMs(11, 4),
        feedingType: 'formula', milkAmountMl: 60, breastMilkAmountMl: null, leftDurationMin: null, rightDurationMin: null,
        note: dangerous,
      }]));
      expect(csv).toContain(`'${dangerous}`);
      expect(csv).toContain(',60,');
    },
  );

  test('protects a formula-like baby name in every exported row', () => {
    const value = snapshot([{
      id: 'other-1', type: 'other', eventTimeMs: localMs(11, 4), recordDate: '2026-07-11',
      createdAtMs: localMs(11, 4), updatedAtMs: localMs(11, 4), title: '洗澡', note: null,
    }]);
    value.baby.name = '=1+1';

    const csv = encodeExportSnapshotCsv(value);

    expect(csv).toContain("other-1,'=1+1,2026-06-20");
    expect(value.baby.name).toBe('=1+1');
  });

  test('maps formula and breast feeding, a photo-free poop, and same-day completed sleep', () => {
    const csv = encodeExportSnapshotCsv(snapshot([
      {
        id: 'formula', type: 'feeding', eventTimeMs: localMs(11, 1), recordDate: '2026-07-11',
        createdAtMs: localMs(11, 1), updatedAtMs: localMs(11, 1), note: null,
        feedingType: 'formula', milkAmountMl: 70, breastMilkAmountMl: null, leftDurationMin: null, rightDurationMin: null,
      },
      {
        id: 'breast', type: 'feeding', eventTimeMs: localMs(11, 2), recordDate: '2026-07-11',
        createdAtMs: localMs(11, 2), updatedAtMs: localMs(11, 2), note: null,
        feedingType: 'breast', milkAmountMl: null, breastMilkAmountMl: null, leftDurationMin: 12, rightDurationMin: 8,
      },
      {
        id: 'poop-none', type: 'poop', eventTimeMs: localMs(11, 3), recordDate: '2026-07-11',
        createdAtMs: localMs(11, 3), updatedAtMs: localMs(11, 3), note: null,
        poopColor: null, poopTexture: null, poopAmount: null, hasPhoto: false,
      },
      {
        id: 'sleep-same', type: 'sleep', eventTimeMs: localMs(11, 4), recordDate: '2026-07-11',
        createdAtMs: localMs(11, 4), updatedAtMs: localMs(11, 5), note: null,
        sleepStatus: 'completed', sleepStartMs: localMs(11, 4), sleepEndMs: localMs(11, 5),
      },
    ]));

    expect(csv).toContain('formula,奶粉,70,,,');
    expect(csv).toContain('breast,亲喂母乳,,12,8');
    const poopRow = csv.split('\r\n').find((row) => row.startsWith('poop-none,'));
    expect(poopRow?.split(',')[18]).toBe('false');
    expect(csv).toContain('completed,已完成,2026-07-11 04:00:00,2026-07-11 05:00:00,60');
  });

  test('sorts by event time, then created time, then id without mutating the snapshot', () => {
    const records: ExportSnapshot['records'] = [
      { id: 'b', type: 'other', eventTimeMs: localMs(11, 2), recordDate: '2026-07-11', createdAtMs: 2, updatedAtMs: 2, title: 'B', note: null },
      { id: 'c', type: 'other', eventTimeMs: localMs(11, 2), recordDate: '2026-07-11', createdAtMs: 1, updatedAtMs: 1, title: 'C', note: null },
      { id: 'a', type: 'other', eventTimeMs: localMs(11, 2), recordDate: '2026-07-11', createdAtMs: 1, updatedAtMs: 1, title: 'A', note: null },
      { id: 'early', type: 'other', eventTimeMs: localMs(11, 1), recordDate: '2026-07-11', createdAtMs: 3, updatedAtMs: 3, title: '早', note: null },
    ];
    const csv = encodeExportSnapshotCsv(snapshot(records));
    const ids = csv.split('\r\n').slice(1, -1).map((row) => row.split(',')[0]);
    expect(ids).toEqual(['early', 'a', 'c', 'b']);
    expect(records.map((record) => record.id)).toEqual(['b', 'c', 'a', 'early']);
  });
});
