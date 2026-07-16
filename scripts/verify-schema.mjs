import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS } from '../src/data/database/migrations.ts';

const database = new DatabaseSync(':memory:');

try {
  for (const migration of MIGRATIONS) {
    database.exec(migration.sql);
    database.exec(`PRAGMA user_version = ${migration.version}`);
  }

  const insertSleeping = database.prepare(`
    INSERT INTO records (
      id, client_request_id, create_payload_hash, type,
      event_time_ms, record_date, sort_time_ms,
      created_at_ms, updated_at_ms,
      sleep_start_ms, sleep_end_ms, sleep_status
    ) VALUES (?, ?, ?, 'sleep', ?, '1970-01-01', ?, ?, ?, ?, NULL, 'sleeping')
  `);
  insertSleeping.run('host-sleep-1', 'host-request-1', '0'.repeat(64), 1, 1, 1, 1, 1);

  let sleepingConstraintVerified = false;
  try {
    insertSleeping.run('host-sleep-2', 'host-request-2', '1'.repeat(64), 2, 2, 2, 2, 2);
  } catch (error) {
    sleepingConstraintVerified = /UNIQUE constraint failed: records\.type/i.test(String(error));
  }

  if (!sleepingConstraintVerified) {
    throw new Error('Sleeping partial unique index was not enforced');
  }

  let peeConstraintVerified = false;
  try {
    database.prepare(`
      INSERT INTO records (
        id, client_request_id, create_payload_hash, type,
        event_time_ms, record_date, sort_time_ms,
        created_at_ms, updated_at_ms,
        pee_amount, milk_amount_ml
      ) VALUES (?, ?, ?, 'pee', ?, '2000-01-01', ?, ?, ?, 'small', 30)
    `).run('host-pee-invalid', 'host-pee-invalid-request', '2'.repeat(64), 3, 3, 3, 3);
  } catch (error) {
    peeConstraintVerified = /invalid pee fields/i.test(String(error));
  }
  if (!peeConstraintVerified) {
    throw new Error('Pee semantic field isolation was not enforced');
  }

  let otherConstraintVerified = false;
  try {
    database.prepare(`
      INSERT INTO records (
        id, client_request_id, create_payload_hash, type,
        event_time_ms, record_date, sort_time_ms,
        created_at_ms, updated_at_ms, other_title
      ) VALUES (?, ?, ?, 'other', ?, '2000-01-01', ?, ?, ?, '   ')
    `).run('host-other-invalid', 'host-other-invalid-request', '3'.repeat(64), 4, 4, 4, 4);
  } catch (error) {
    otherConstraintVerified = /invalid other fields/i.test(String(error));
  }
  if (!otherConstraintVerified) {
    throw new Error('Other title semantic triggers were not enforced');
  }

  // Simulate re-running the initialization path against an existing business sleep.
  for (const migration of MIGRATIONS) {
    const { user_version: userVersion } = database.prepare('PRAGMA user_version').get();
    if (migration.version > userVersion) {
      database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
    }
  }

  const persisted = database
    .prepare(`
      SELECT
        COUNT(*) AS sleeping_count,
        SUM(CASE WHEN id LIKE 'constraint-probe-%' OR id LIKE 'verification-%' THEN 1 ELSE 0 END)
          AS probe_count
      FROM records
      WHERE type = 'sleep' AND sleep_status = 'sleeping'
    `)
    .get();

  if (persisted.sleeping_count !== 1 || persisted.probe_count !== 0) {
    throw new Error(`Business database reinitialization regression: ${JSON.stringify(persisted)}`);
  }

  console.log('Host SQLite schema compatibility: passed');
  console.log('Sleeping partial unique index: passed');
  console.log('Pee semantic triggers: passed');
  console.log('Other title semantic triggers: passed');
  console.log('Existing sleeping record reinitialization: passed');
  console.log(`Final user_version: ${database.prepare('PRAGMA user_version').get().user_version}`);
} finally {
  database.close();
}
