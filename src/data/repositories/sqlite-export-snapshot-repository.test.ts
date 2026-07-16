/** @jest-environment node */

// @ts-expect-error Node 24 provides node:sqlite, while this app intentionally does not install Node typings.
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from '@/data/database/migrations';
import { resolveExportRange } from '@/domain/export/export-range';

import {
  createSQLiteExportSnapshotRepository,
  SQLiteExportSnapshotRepository,
  type ExportSnapshotDatabase,
} from './sqlite-export-snapshot-repository';

const ms = (day: number, hour: number) => new Date(2026, 6, day, hour).getTime();
const hash = 'a'.repeat(64);

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  sqlite.prepare(`INSERT INTO baby (
    id, singleton_key, name, birth_date, created_at_ms, updated_at_ms
  ) VALUES ('baby-1', 1, '小宝', '2026-06-20', ?, ?)`).run(ms(1, 0), ms(1, 0));
  const query = {
    getFirstAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...params: (string | number | null)[]) =>
      sqlite.prepare(sql).all(...params) as T[],
  };
  const database: ExportSnapshotDatabase = {
    withExclusiveTransactionAsync: async (task) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        await task(query);
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, repository: new SQLiteExportSnapshotRepository(database) };
}

function insertBase(sqlite: InstanceType<typeof DatabaseSync>, values: {
  id: string; type: string; eventTimeMs: number; extraColumns?: string; extraPlaceholders?: string; extraValues?: unknown[];
}) {
  sqlite.prepare(`INSERT INTO records (
    id, client_request_id, create_payload_hash, type, event_time_ms, record_date,
    sort_time_ms, created_at_ms, updated_at_ms${values.extraColumns ?? ''}
  ) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d', ? / 1000.0, 'unixepoch', 'localtime'), ?, ?, ?${values.extraPlaceholders ?? ''})`).run(
    values.id, `request-${values.id}`, hash, values.type, values.eventTimeMs, values.eventTimeMs,
    values.eventTimeMs, values.eventTimeMs, values.eventTimeMs, ...(values.extraValues ?? []),
  );
}

describe('SQLiteExportSnapshotRepository host SQLite integration', () => {
  test('uses the Expo exclusive transaction connection for every snapshot query', async () => {
    const transaction = {
      getFirstAsync: jest.fn(async () => ({ name: '小宝', birth_date: '2026-06-20' })),
      getAllAsync: jest.fn(async () => []),
    };
    const database = {
      withExclusiveTransactionAsync: jest.fn(async (task: (value: typeof transaction) => Promise<void>) => task(transaction)),
    };
    const repository = createSQLiteExportSnapshotRepository(database as never);

    await repository.getSnapshot({ kind: 'all' }, ms(11, 12));

    expect(database.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(transaction.getFirstAsync).toHaveBeenCalledTimes(1);
    expect(transaction.getAllAsync).toHaveBeenCalledTimes(1);
  });

  test('reads baby and all five source record types in one snapshot without private fields', async () => {
    const { sqlite, repository } = setup();
    insertBase(sqlite, { id: 'feeding', type: 'feeding', eventTimeMs: ms(11, 1), extraColumns: ', feeding_type, milk_amount_ml', extraPlaceholders: ', ?, ?', extraValues: ['formula', 60] });
    insertBase(sqlite, { id: 'poop', type: 'poop', eventTimeMs: ms(11, 2), extraColumns: ', poop_texture, photo_uri', extraPlaceholders: ', ?, ?', extraValues: ['loose', 'poop-photos/secret.jpg'] });
    insertBase(sqlite, { id: 'pee', type: 'pee', eventTimeMs: ms(11, 3), extraColumns: ', pee_color', extraPlaceholders: ', ?', extraValues: ['pale-yellow'] });
    insertBase(sqlite, { id: 'sleep', type: 'sleep', eventTimeMs: ms(10, 23), extraColumns: ', sleep_start_ms, sleep_end_ms, sleep_status', extraPlaceholders: ', ?, ?, ?', extraValues: [ms(10, 23), ms(11, 2), 'completed'] });
    insertBase(sqlite, { id: 'other', type: 'other', eventTimeMs: ms(11, 4), extraColumns: ', other_title', extraPlaceholders: ', ?', extraValues: ['洗澡'] });

    const snapshot = await repository.getSnapshot({ kind: 'all' }, ms(11, 12));

    expect(snapshot.baby).toEqual({ name: '小宝', birthDate: '2026-06-20' });
    expect(snapshot.records.map((record) => record.id)).toEqual(['sleep', 'feeding', 'poop', 'pee', 'other']);
    expect(snapshot.records.find((record) => record.id === 'poop')).toMatchObject({
      poopTexture: 'soft', hasPhoto: true,
    });
    expect(snapshot.records.find((record) => record.id === 'pee')).toMatchObject({ peeColor: 'light_yellow' });
    expect(JSON.stringify(snapshot)).not.toContain('secret.jpg');
    expect(JSON.stringify(snapshot)).not.toContain('request-');
    sqlite.close();
  });

  test('includes a cross-day sleep once when it overlaps and excludes the end boundary for ordinary records', async () => {
    const { sqlite, repository } = setup();
    insertBase(sqlite, { id: 'cross-day', type: 'sleep', eventTimeMs: ms(10, 23), extraColumns: ', sleep_start_ms, sleep_end_ms, sleep_status', extraPlaceholders: ', ?, ?, ?', extraValues: [ms(10, 23), ms(11, 2), 'completed'] });
    insertBase(sqlite, { id: 'at-start', type: 'other', eventTimeMs: ms(11, 0), extraColumns: ', other_title', extraPlaceholders: ', ?', extraValues: ['开始'] });
    insertBase(sqlite, { id: 'at-end', type: 'other', eventTimeMs: ms(12, 0), extraColumns: ', other_title', extraPlaceholders: ', ?', extraValues: ['结束'] });
    const range = resolveExportRange({ kind: 'date-range', startDate: '2026-07-11', endDate: '2026-07-11' }, '2026-07-11');

    const snapshot = await repository.getSnapshot(range, ms(11, 12));

    expect(snapshot.records.map((record) => record.id)).toEqual(['cross-day', 'at-start']);
    sqlite.close();
  });

  test('uses snapshot time to include an active sleep without exporting a synthetic end', async () => {
    const { sqlite, repository } = setup();
    insertBase(sqlite, { id: 'active', type: 'sleep', eventTimeMs: ms(10, 23), extraColumns: ', sleep_start_ms, sleep_status', extraPlaceholders: ', ?, ?', extraValues: [ms(10, 23), 'sleeping'] });
    const range = resolveExportRange({ kind: 'date-range', startDate: '2026-07-11', endDate: '2026-07-11' }, '2026-07-11');

    const snapshot = await repository.getSnapshot(range, ms(11, 1));

    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]).toMatchObject({ id: 'active', sleepEndMs: null });
    sqlite.close();
  });
});
