import {
  BackupValidationError,
  validateBackupData,
  validateHistoricalDate,
} from './backup-validation';

const hash = 'a'.repeat(64);

function baseRecord(type: 'feeding' | 'poop' | 'pee' | 'sleep' | 'other', id: string = type) {
  return {
    id,
    client_request_id: `request-${id}`,
    create_payload_hash: hash,
    type,
    event_time_ms: 1000,
    record_date: '2026-07-10',
    sort_time_ms: 1000,
    created_at_ms: 1000,
    updated_at_ms: 1000,
    note: null,
    feeding_type: null,
    milk_amount_ml: null,
    left_duration_min: null,
    right_duration_min: null,
    poop_color: null,
    poop_texture: null,
    poop_amount: null,
    photo_backup_entry: null,
    photo_sha256: null,
    pee_color: null,
    pee_amount: null,
    sleep_start_ms: null,
    sleep_end_ms: null,
    sleep_status: null,
    other_title: null,
  };
}

function validData(): any {
  return {
    baby: {
      id: 'baby-1', name: '小宝', birth_date: '2026-06-01', created_at_ms: 1, updated_at_ms: 2,
    },
    records: [
      { ...baseRecord('feeding'), feeding_type: 'mixed', milk_amount_ml: 60, left_duration_min: 5, right_duration_min: 0 },
      { ...baseRecord('poop'), poop_color: 'yellow', photo_backup_entry: 'photos/photo-poop.jpg', photo_sha256: hash },
      { ...baseRecord('pee'), pee_color: 'pale-yellow', pee_amount: 'small' },
      { ...baseRecord('sleep'), event_time_ms: 2000, sort_time_ms: 2000, sleep_start_ms: 2000,
        sleep_end_ms: 3000, sleep_status: 'completed', record_date: '2026-07-09' },
      { ...baseRecord('other'), other_title: '洗澡' },
    ],
    settings: { theme_mode: 'dark', feeding_reminder_enabled: true, feeding_reminder_interval_minutes: 120 },
  };
}

describe('backup business data validation', () => {
  test('accepts one baby, five isolated record types, historical dates, and allowlisted settings', () => {
    expect(validateBackupData(validData())).toEqual(validData());
  });

  test.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-7-01', 'not-a-date'])(
    'rejects invalid historical date %s',
    (value) => expect(() => validateHistoricalDate(value)).toThrow(BackupValidationError),
  );

  test('does not rederive a historical record date from the current timezone', () => {
    const input = validData();
    const sleep = input.records[3];
    sleep.record_date = '1969-12-31';
    sleep.event_time_ms = 18_000_000;
    sleep.sort_time_ms = 18_000_000;
    sleep.sleep_start_ms = 18_000_000;
    sleep.sleep_end_ms = 21_600_000;
    expect(validateBackupData(input).records[3]).toMatchObject({
      record_date: '1969-12-31', event_time_ms: 18_000_000, sleep_start_ms: 18_000_000,
    });
  });

  test.each([
    ['duplicate id', (input: ReturnType<typeof validData>) => { input.records[1].id = input.records[0].id; }],
    ['duplicate request id', (input: ReturnType<typeof validData>) => { input.records[1].client_request_id = input.records[0].client_request_id; }],
    ['bad payload hash', (input: ReturnType<typeof validData>) => { input.records[0].create_payload_hash = 'short'; }],
    ['feeding pollution', (input: ReturnType<typeof validData>) => { input.records[0].pee_amount = 'small'; }],
    ['non-poop photo', (input: ReturnType<typeof validData>) => {
      input.records[4].photo_backup_entry = 'photos/other.jpg'; input.records[4].photo_sha256 = hash;
    }],
    ['missing photo hash', (input: ReturnType<typeof validData>) => { input.records[1].photo_sha256 = null; }],
    ['duplicate photo reference', (input: ReturnType<typeof validData>) => {
      input.records.push({ ...baseRecord('poop', 'poop-2'), photo_backup_entry: input.records[1].photo_backup_entry,
        photo_sha256: hash });
    }],
    ['two sleeping', (input: ReturnType<typeof validData>) => {
      const first = input.records[3]; first.sleep_status = 'sleeping'; first.sleep_end_ms = null;
      input.records.push({ ...first, id: 'sleep-2', client_request_id: 'request-sleep-2' });
    }],
    ['sleep event mismatch', (input: ReturnType<typeof validData>) => { input.records[3].event_time_ms = 1999; }],
    ['sleep sort mismatch', (input: ReturnType<typeof validData>) => { input.records[3].sort_time_ms = 1999; }],
    ['completed without end', (input: ReturnType<typeof validData>) => { input.records[3].sleep_end_ms = null; }],
    ['sleeping with end', (input: ReturnType<typeof validData>) => { input.records[3].sleep_status = 'sleeping'; }],
    ['completed end before start', (input: ReturnType<typeof validData>) => { input.records[3].sleep_end_ms = 1999; }],
    ['missing baby', (input: ReturnType<typeof validData>) => { input.baby = null; }],
    ['multiple babies', (input: ReturnType<typeof validData>) => { input.baby = [input.baby, input.baby]; }],
    ['unknown baby field', (input: ReturnType<typeof validData>) => { input.baby.remote_id = 'server'; }],
    ['unknown record field', (input: ReturnType<typeof validData>) => { input.records[0].sync_status = 'pending'; }],
    ['invalid record type', (input: ReturnType<typeof validData>) => { input.records[0].type = 'medical'; }],
    ['invalid feeding enum', (input: ReturnType<typeof validData>) => { input.records[0].feeding_type = 'bottle'; }],
    ['invalid poop enum', (input: ReturnType<typeof validData>) => { input.records[1].poop_color = 'blue'; }],
    ['invalid pee enum', (input: ReturnType<typeof validData>) => { input.records[2].pee_amount = 'huge'; }],
    ['invalid sleep status', (input: ReturnType<typeof validData>) => { input.records[3].sleep_status = 'paused'; }],
    ['blank other title', (input: ReturnType<typeof validData>) => { input.records[4].other_title = '   '; }],
  ])('rejects %s', (_label, mutate) => {
    const input = validData();
    mutate(input);
    expect(() => validateBackupData(input)).toThrow(BackupValidationError);
  });

  test.each([
    { theme_mode: 'purple', feeding_reminder_enabled: false, feeding_reminder_interval_minutes: null },
    { theme_mode: 'system', feeding_reminder_enabled: true, feeding_reminder_interval_minutes: 14 },
    { theme_mode: 'system', feeding_reminder_enabled: true, feeding_reminder_interval_minutes: null },
    { theme_mode: 'system', feeding_reminder_enabled: false, feeding_reminder_interval_minutes: 120 },
    { theme_mode: 'system', feeding_reminder_enabled: false, feeding_reminder_interval_minutes: null, notification_identifier: 'secret' },
  ])('rejects invalid or non-allowlisted settings %#', (settings) => {
    expect(() => validateBackupData({ ...validData(), settings })).toThrow(BackupValidationError);
  });
});
