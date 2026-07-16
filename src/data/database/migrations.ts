import {
  RECORD_COLUMNS_SQL,
  RECORDS_FINAL_OBJECT_NAMES,
  RECORDS_FINAL_OBJECTS_SQL,
  RECORDS_OTHER_TRIGGERS_SQL,
  RECORDS_V5_COPY_SQL,
  RECORDS_V5_REBUILD_SQL,
  RECORDS_V5_TABLE_SQL,
  RECORDS_V6_OBJECT_NAMES,
  RECORDS_V8_CREATE_SLEEP_TRIGGERS_SQL,
  RECORDS_V8_DROP_SLEEP_TRIGGERS_SQL,
  RECORDS_V8_SLEEP_TRIGGERS_SQL,
} from './records-schema.ts';

type SQLiteValue = string | number | null;

export interface MigrationTransaction {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: SQLiteValue[]): Promise<unknown>;
}

export interface MigrationDatabase {
  getFirstAsync<T>(sql: string, ...params: SQLiteValue[]): Promise<T | null>;
  withExclusiveTransactionAsync(task: (transaction: MigrationTransaction) => Promise<void>): Promise<void>;
}

export type Migration = {
  version: number;
  sql: string;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE baby (
        id TEXT PRIMARY KEY NOT NULL,
        singleton_key INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (singleton_key = 1),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 20),
        birth_date TEXT NOT NULL CHECK (length(birth_date) = 10),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE app_settings (
        singleton_key INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton_key = 1),
        theme_mode TEXT NOT NULL DEFAULT 'system' CHECK (theme_mode IN ('system', 'light', 'dark')),
        feeding_reminder_minutes INTEGER,
        scheduled_notification_id TEXT,
        notification_permission_prompted INTEGER NOT NULL DEFAULT 0 CHECK (notification_permission_prompted IN (0, 1)),
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE records (
        id TEXT PRIMARY KEY NOT NULL,
        client_request_id TEXT NOT NULL UNIQUE,
        create_payload_hash TEXT NOT NULL CHECK (length(create_payload_hash) = 64),
        type TEXT NOT NULL CHECK (type IN ('feeding', 'poop', 'pee', 'sleep', 'other')),
        event_time_ms INTEGER,
        record_date TEXT NOT NULL CHECK (length(record_date) = 10),
        sort_time_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        note TEXT CHECK (note IS NULL OR length(note) <= 200),

        feeding_type TEXT CHECK (feeding_type IS NULL OR feeding_type IN ('breast', 'formula', 'mixed')),
        milk_amount_ml INTEGER CHECK (milk_amount_ml IS NULL OR milk_amount_ml BETWEEN 0 AND 999),
        left_duration_min INTEGER CHECK (left_duration_min IS NULL OR left_duration_min >= 0),
        right_duration_min INTEGER CHECK (right_duration_min IS NULL OR right_duration_min >= 0),

        poop_color TEXT CHECK (poop_color IS NULL OR poop_color IN ('yellow', 'green', 'brown', 'black', 'red', 'other')),
        poop_texture TEXT CHECK (poop_texture IS NULL OR poop_texture IN ('watery', 'loose', 'pasty', 'formed', 'pellet')),
        poop_amount TEXT CHECK (poop_amount IS NULL OR poop_amount IN ('small', 'medium', 'large')),
        photo_uri TEXT,

        pee_color TEXT CHECK (pee_color IS NULL OR pee_color IN ('clear', 'pale-yellow', 'yellow', 'dark-yellow')),
        pee_amount TEXT CHECK (pee_amount IS NULL OR pee_amount IN ('small', 'medium', 'large')),

        sleep_start_ms INTEGER,
        sleep_end_ms INTEGER,
        sleep_status TEXT CHECK (sleep_status IS NULL OR sleep_status IN ('sleeping', 'completed')),

        other_title TEXT CHECK (other_title IS NULL OR length(trim(other_title)) BETWEEN 1 AND 50),

        CHECK (
          (type = 'sleep'
            AND event_time_ms IS NULL
            AND sleep_start_ms IS NOT NULL
            AND sleep_status IS NOT NULL
            AND (
              (sleep_status = 'sleeping' AND sleep_end_ms IS NULL)
              OR (sleep_status = 'completed' AND sleep_end_ms > sleep_start_ms)
            )
          )
          OR
          (type <> 'sleep'
            AND event_time_ms IS NOT NULL
            AND sleep_start_ms IS NULL
            AND sleep_end_ms IS NULL
            AND sleep_status IS NULL
          )
        )
      );

      CREATE INDEX records_date_sort_index
        ON records(record_date, sort_time_ms DESC);
      CREATE INDEX records_date_type_sort_index
        ON records(record_date, type, sort_time_ms DESC);
      CREATE UNIQUE INDEX records_one_sleeping_unique
        ON records(type)
        WHERE type = 'sleep' AND sleep_status = 'sleeping';

      INSERT INTO app_settings (singleton_key, updated_at_ms) VALUES (1, 0);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE INDEX records_type_sort_index
        ON records(type, sort_time_ms DESC);

      CREATE TRIGGER records_feeding_insert_valid
      BEFORE INSERT ON records
      WHEN
        (
          NEW.type = 'feeding'
          AND COALESCE(
            (
              (NEW.feeding_type = 'formula'
                AND NEW.milk_amount_ml BETWEEN 1 AND 999
                AND NEW.left_duration_min IS NULL
                AND NEW.right_duration_min IS NULL)
              OR
              (NEW.feeding_type = 'breast'
                AND NEW.milk_amount_ml IS NULL
                AND NEW.left_duration_min BETWEEN 0 AND 180
                AND NEW.right_duration_min BETWEEN 0 AND 180
                AND NEW.left_duration_min + NEW.right_duration_min > 0)
              OR
              (NEW.feeding_type = 'mixed'
                AND NEW.milk_amount_ml BETWEEN 1 AND 999
                AND NEW.left_duration_min BETWEEN 0 AND 180
                AND NEW.right_duration_min BETWEEN 0 AND 180
                AND NEW.left_duration_min + NEW.right_duration_min > 0)
            ),
            0
          ) = 0
        )
        OR
        (
          NEW.type <> 'feeding'
          AND (
            NEW.feeding_type IS NOT NULL
            OR NEW.milk_amount_ml IS NOT NULL
            OR NEW.left_duration_min IS NOT NULL
            OR NEW.right_duration_min IS NOT NULL
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid feeding fields');
      END;

      CREATE TRIGGER records_feeding_update_valid
      BEFORE UPDATE ON records
      WHEN
        (
          NEW.type = 'feeding'
          AND COALESCE(
            (
              (NEW.feeding_type = 'formula'
                AND NEW.milk_amount_ml BETWEEN 1 AND 999
                AND NEW.left_duration_min IS NULL
                AND NEW.right_duration_min IS NULL)
              OR
              (NEW.feeding_type = 'breast'
                AND NEW.milk_amount_ml IS NULL
                AND NEW.left_duration_min BETWEEN 0 AND 180
                AND NEW.right_duration_min BETWEEN 0 AND 180
                AND NEW.left_duration_min + NEW.right_duration_min > 0)
              OR
              (NEW.feeding_type = 'mixed'
                AND NEW.milk_amount_ml BETWEEN 1 AND 999
                AND NEW.left_duration_min BETWEEN 0 AND 180
                AND NEW.right_duration_min BETWEEN 0 AND 180
                AND NEW.left_duration_min + NEW.right_duration_min > 0)
            ),
            0
          ) = 0
        )
        OR
        (
          NEW.type <> 'feeding'
          AND (
            NEW.feeding_type IS NOT NULL
            OR NEW.milk_amount_ml IS NOT NULL
            OR NEW.left_duration_min IS NOT NULL
            OR NEW.right_duration_min IS NOT NULL
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid feeding fields');
      END;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TRIGGER records_poop_insert_valid
      BEFORE INSERT ON records
      WHEN
        (
          NEW.type = 'poop'
          AND (
            NEW.feeding_type IS NOT NULL
            OR NEW.milk_amount_ml IS NOT NULL
            OR NEW.left_duration_min IS NOT NULL
            OR NEW.right_duration_min IS NOT NULL
            OR NEW.pee_color IS NOT NULL
            OR NEW.pee_amount IS NOT NULL
            OR NEW.other_title IS NOT NULL
            OR (
              NEW.photo_uri IS NOT NULL
              AND (
                NEW.photo_uri NOT GLOB 'poop-photos/*.jpg'
                OR instr(NEW.photo_uri, '..') > 0
                OR instr(substr(NEW.photo_uri, length('poop-photos/') + 1), '/') > 0
              )
            )
          )
        )
        OR
        (
          NEW.type <> 'poop'
          AND (
            NEW.poop_color IS NOT NULL
            OR NEW.poop_texture IS NOT NULL
            OR NEW.poop_amount IS NOT NULL
            OR NEW.photo_uri IS NOT NULL
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid poop fields');
      END;

      CREATE TRIGGER records_poop_update_valid
      BEFORE UPDATE ON records
      WHEN
        (
          NEW.type = 'poop'
          AND (
            NEW.feeding_type IS NOT NULL
            OR NEW.milk_amount_ml IS NOT NULL
            OR NEW.left_duration_min IS NOT NULL
            OR NEW.right_duration_min IS NOT NULL
            OR NEW.pee_color IS NOT NULL
            OR NEW.pee_amount IS NOT NULL
            OR NEW.other_title IS NOT NULL
            OR (
              NEW.photo_uri IS NOT NULL
              AND (
                NEW.photo_uri NOT GLOB 'poop-photos/*.jpg'
                OR instr(NEW.photo_uri, '..') > 0
                OR instr(substr(NEW.photo_uri, length('poop-photos/') + 1), '/') > 0
              )
            )
          )
        )
        OR
        (
          NEW.type <> 'poop'
          AND (
            NEW.poop_color IS NOT NULL
            OR NEW.poop_texture IS NOT NULL
            OR NEW.poop_amount IS NOT NULL
            OR NEW.photo_uri IS NOT NULL
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid poop fields');
      END;
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TRIGGER records_pee_insert_valid
      BEFORE INSERT ON records
      WHEN
        (
          NEW.type = 'pee'
          AND (
            NEW.feeding_type IS NOT NULL
            OR NEW.milk_amount_ml IS NOT NULL
            OR NEW.left_duration_min IS NOT NULL
            OR NEW.right_duration_min IS NOT NULL
            OR NEW.poop_color IS NOT NULL
            OR NEW.poop_texture IS NOT NULL
            OR NEW.poop_amount IS NOT NULL
            OR NEW.photo_uri IS NOT NULL
            OR NEW.sleep_start_ms IS NOT NULL
            OR NEW.sleep_end_ms IS NOT NULL
            OR NEW.sleep_status IS NOT NULL
            OR NEW.other_title IS NOT NULL
            OR (NEW.pee_color IS NOT NULL AND NEW.pee_color NOT IN ('clear', 'pale-yellow', 'yellow', 'dark-yellow'))
            OR (NEW.pee_amount IS NOT NULL AND NEW.pee_amount NOT IN ('small', 'medium', 'large'))
          )
        )
        OR
        (
          NEW.type <> 'pee'
          AND (
            NEW.pee_color IS NOT NULL
            OR NEW.pee_amount IS NOT NULL
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid pee fields');
      END;

      CREATE TRIGGER records_pee_update_valid
      BEFORE UPDATE ON records
      WHEN
        (
          NEW.type = 'pee'
          AND (
            NEW.feeding_type IS NOT NULL
            OR NEW.milk_amount_ml IS NOT NULL
            OR NEW.left_duration_min IS NOT NULL
            OR NEW.right_duration_min IS NOT NULL
            OR NEW.poop_color IS NOT NULL
            OR NEW.poop_texture IS NOT NULL
            OR NEW.poop_amount IS NOT NULL
            OR NEW.photo_uri IS NOT NULL
            OR NEW.sleep_start_ms IS NOT NULL
            OR NEW.sleep_end_ms IS NOT NULL
            OR NEW.sleep_status IS NOT NULL
            OR NEW.other_title IS NOT NULL
            OR (NEW.pee_color IS NOT NULL AND NEW.pee_color NOT IN ('clear', 'pale-yellow', 'yellow', 'dark-yellow'))
            OR (NEW.pee_amount IS NOT NULL AND NEW.pee_amount NOT IN ('small', 'medium', 'large'))
          )
        )
        OR
        (
          NEW.type <> 'pee'
          AND (
            NEW.pee_color IS NOT NULL
            OR NEW.pee_amount IS NOT NULL
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid pee fields');
      END;
    `,
  },
  {
    version: 5,
    sql: RECORDS_V5_REBUILD_SQL,
  },
  {
    version: 6,
    sql: RECORDS_OTHER_TRIGGERS_SQL,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE app_settings ADD COLUMN feeding_reminder_scheduled_for_ms INTEGER;
      ALTER TABLE app_settings ADD COLUMN feeding_reminder_source_record_id TEXT;
      ALTER TABLE app_settings ADD COLUMN feeding_reminder_sync_error_code TEXT;

      UPDATE app_settings
      SET scheduled_notification_id = NULL,
          feeding_reminder_scheduled_for_ms = NULL,
          feeding_reminder_source_record_id = NULL,
          feeding_reminder_sync_error_code = NULL;

      CREATE TRIGGER app_settings_feeding_reminder_insert_valid
      BEFORE INSERT ON app_settings
      WHEN
        (NEW.feeding_reminder_minutes IS NOT NULL AND (
          typeof(NEW.feeding_reminder_minutes) <> 'integer'
          OR NEW.feeding_reminder_minutes NOT BETWEEN 15 AND 1440
        ))
        OR ((NEW.scheduled_notification_id IS NULL)
          <> (NEW.feeding_reminder_scheduled_for_ms IS NULL))
        OR ((NEW.scheduled_notification_id IS NULL)
          <> (NEW.feeding_reminder_source_record_id IS NULL))
        OR (NEW.feeding_reminder_minutes IS NULL AND NEW.scheduled_notification_id IS NOT NULL)
        OR (NEW.scheduled_notification_id IS NOT NULL AND length(NEW.scheduled_notification_id) = 0)
        OR (NEW.feeding_reminder_scheduled_for_ms IS NOT NULL
          AND NEW.feeding_reminder_scheduled_for_ms <= 0)
        OR (NEW.feeding_reminder_source_record_id IS NOT NULL
          AND length(NEW.feeding_reminder_source_record_id) = 0)
        OR (NEW.feeding_reminder_sync_error_code IS NOT NULL AND
          NEW.feeding_reminder_sync_error_code NOT IN (
            'cancel-failed', 'schedule-failed', 'metadata-failed', 'reconcile-failed'
          ))
      BEGIN SELECT RAISE(ABORT, 'invalid feeding reminder settings'); END;

      CREATE TRIGGER app_settings_feeding_reminder_update_valid
      BEFORE UPDATE ON app_settings
      WHEN
        (NEW.feeding_reminder_minutes IS NOT NULL AND (
          typeof(NEW.feeding_reminder_minutes) <> 'integer'
          OR NEW.feeding_reminder_minutes NOT BETWEEN 15 AND 1440
        ))
        OR ((NEW.scheduled_notification_id IS NULL)
          <> (NEW.feeding_reminder_scheduled_for_ms IS NULL))
        OR ((NEW.scheduled_notification_id IS NULL)
          <> (NEW.feeding_reminder_source_record_id IS NULL))
        OR (NEW.feeding_reminder_minutes IS NULL AND NEW.scheduled_notification_id IS NOT NULL)
        OR (NEW.scheduled_notification_id IS NOT NULL AND length(NEW.scheduled_notification_id) = 0)
        OR (NEW.feeding_reminder_scheduled_for_ms IS NOT NULL
          AND NEW.feeding_reminder_scheduled_for_ms <= 0)
        OR (NEW.feeding_reminder_source_record_id IS NOT NULL
          AND length(NEW.feeding_reminder_source_record_id) = 0)
        OR (NEW.feeding_reminder_sync_error_code IS NOT NULL AND
          NEW.feeding_reminder_sync_error_code NOT IN (
            'cancel-failed', 'schedule-failed', 'metadata-failed', 'reconcile-failed'
          ))
      BEGIN SELECT RAISE(ABORT, 'invalid feeding reminder settings'); END;
    `,
  },
  {
    version: 8,
    sql: RECORDS_V8_SLEEP_TRIGGERS_SQL,
  },
] as const;

export type MigrationFailurePoint =
  | 'after-copy'
  | 'after-drop'
  | 'after-schema-objects'
  | 'after-v8-trigger-drop'
  | 'after-v8-trigger-create';

type MigrationOptions = {
  failurePoint?: MigrationFailurePoint;
  targetVersion?: number;
};

type CountRow = { count: number };
type VersionRow = { user_version: number };
type SchemaObjectRow = { name: string; type: string; sql: string };

function injectedFailure(point: MigrationFailurePoint, options: MigrationOptions) {
  if (options.failurePoint === point) throw new Error(`Injected migration failure: ${point}`);
}

async function requireZero(
  transaction: MigrationTransaction,
  sql: string,
  message: string,
) {
  const row = await transaction.getFirstAsync<CountRow>(sql);
  if ((row?.count ?? 0) !== 0) throw new Error(message);
}

async function runMigrationV5(
  transaction: MigrationTransaction,
  options: MigrationOptions,
) {
  const version = await transaction.getFirstAsync<VersionRow>('PRAGMA user_version');
  if (version?.user_version !== 4) {
    throw new Error(`records migration v5 requires user_version 4, received ${version?.user_version ?? 'unknown'}`);
  }

  const foreignKeyReferences = await transaction.getAllAsync<{ name: string }>(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      AND lower(COALESCE(sql, '')) LIKE '%references records%'
  `);
  if (foreignKeyReferences.length) {
    throw new Error(`records migration v5 does not support existing foreign-key references: ${foreignKeyReferences.map((row) => row.name).join(', ')}`);
  }

  const oldObjects = await transaction.getAllAsync<SchemaObjectRow>(`
    SELECT name, type, sql FROM sqlite_schema
    WHERE tbl_name = 'records' AND type IN ('index', 'trigger') AND sql IS NOT NULL
    ORDER BY name
  `);
  if (!oldObjects.length) throw new Error('records migration v5 could not record v4 schema objects');

  const invalidSleep = await transaction.getFirstAsync<{ id: string; failed_rule: string }>(`
    SELECT id,
      CASE
        WHEN sleep_start_ms IS NULL THEN 'sleep_start_ms must not be null'
        WHEN sleep_status NOT IN ('sleeping', 'completed') OR sleep_status IS NULL THEN 'invalid sleep_status'
        WHEN sleep_status = 'sleeping' AND sleep_end_ms IS NOT NULL THEN 'sleeping sleep_end_ms must be null'
        WHEN sleep_status = 'completed' AND (sleep_end_ms IS NULL OR sleep_end_ms <= sleep_start_ms)
          THEN 'completed sleep_end_ms must be greater than sleep_start_ms'
      END AS failed_rule
    FROM records
    WHERE type = 'sleep' AND (
      sleep_start_ms IS NULL
      OR sleep_status NOT IN ('sleeping', 'completed') OR sleep_status IS NULL
      OR (sleep_status = 'sleeping' AND sleep_end_ms IS NOT NULL)
      OR (sleep_status = 'completed' AND (sleep_end_ms IS NULL OR sleep_end_ms <= sleep_start_ms))
    )
    LIMIT 1
  `);
  if (invalidSleep) {
    throw new Error(`records migration v5 rejected sleep ${invalidSleep.id}: ${invalidSleep.failed_rule}`);
  }

  await transaction.execAsync(RECORDS_V5_TABLE_SQL);
  await transaction.execAsync(RECORDS_V5_COPY_SQL);

  await requireZero(transaction, `
    SELECT COUNT(*) AS count FROM (
      SELECT type, COUNT(*) AS amount FROM records GROUP BY type
      EXCEPT SELECT type, COUNT(*) AS amount FROM records_v5 GROUP BY type
    )
  `, 'records migration v5 type counts differ after copy');
  await requireZero(transaction, `
    SELECT COUNT(*) AS count FROM (
      SELECT ${RECORD_COLUMNS_SQL} FROM records_v5
      EXCEPT
      SELECT
        id, client_request_id, create_payload_hash, type,
        CASE WHEN type = 'sleep' THEN sleep_start_ms ELSE event_time_ms END,
        CASE WHEN type = 'sleep'
          THEN strftime('%Y-%m-%d', sleep_start_ms / 1000.0, 'unixepoch', 'localtime')
          ELSE record_date END,
        CASE WHEN type = 'sleep' THEN sleep_start_ms ELSE sort_time_ms END,
        created_at_ms, updated_at_ms, note,
        feeding_type, milk_amount_ml, left_duration_min, right_duration_min,
        poop_color, poop_texture, poop_amount, photo_uri, pee_color, pee_amount,
        sleep_start_ms, sleep_end_ms, sleep_status, other_title
      FROM records
    )
  `, 'records migration v5 copied values differ from the explicit field mapping');
  await requireZero(transaction, `
    SELECT COUNT(*) AS count FROM (
      SELECT id FROM records EXCEPT SELECT id FROM records_v5
      UNION ALL
      SELECT id FROM records_v5 EXCEPT SELECT id FROM records
    )
  `, 'records migration v5 record ID sets differ after copy');
  injectedFailure('after-copy', options);

  await transaction.execAsync('DROP TABLE records;');
  injectedFailure('after-drop', options);
  await transaction.execAsync('ALTER TABLE records_v5 RENAME TO records;');
  await transaction.execAsync(RECORDS_FINAL_OBJECTS_SQL);
  injectedFailure('after-schema-objects', options);

  const finalObjects = await transaction.getAllAsync<{ name: string }>(`
    SELECT name FROM sqlite_schema
    WHERE tbl_name = 'records' AND type IN ('index', 'trigger') AND sql IS NOT NULL
    ORDER BY name
  `);
  const finalNames = new Set(finalObjects.map((row) => row.name));
  for (const requiredName of RECORDS_FINAL_OBJECT_NAMES) {
    if (!finalNames.has(requiredName)) throw new Error(`records migration v5 missing schema object ${requiredName}`);
  }
  for (const oldObject of oldObjects) {
    if (!oldObject.name.startsWith('sqlite_') && !finalNames.has(oldObject.name)) {
      throw new Error(`records migration v5 did not recreate existing ${oldObject.type} ${oldObject.name}`);
    }
  }

  await requireZero(transaction, `
    SELECT COUNT(*) AS count FROM records
    WHERE type = 'sleep' AND (
      event_time_ms <> sleep_start_ms OR sort_time_ms <> sleep_start_ms
      OR record_date <> strftime('%Y-%m-%d', sleep_start_ms / 1000.0, 'unixepoch', 'localtime')
    )
  `, 'records migration v5 sleep derived fields are inconsistent');
  const foreignKeyProblems = await transaction.getAllAsync<Record<string, SQLiteValue>>('PRAGMA foreign_key_check');
  if (foreignKeyProblems.length) throw new Error('records migration v5 foreign_key_check failed');
  const integrity = await transaction.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  if (integrity?.integrity_check !== 'ok') {
    throw new Error(`records migration v5 integrity_check failed: ${integrity?.integrity_check ?? 'no result'}`);
  }
}

async function runMigrationV8(
  transaction: MigrationTransaction,
  options: MigrationOptions,
) {
  const version = await transaction.getFirstAsync<VersionRow>('PRAGMA user_version');
  if (version?.user_version !== 7) {
    throw new Error(`timezone migration v8 requires user_version 7, received ${version?.user_version ?? 'unknown'}`);
  }

  await transaction.execAsync(RECORDS_V8_DROP_SLEEP_TRIGGERS_SQL);
  injectedFailure('after-v8-trigger-drop', options);
  await transaction.execAsync(RECORDS_V8_CREATE_SLEEP_TRIGGERS_SQL);
  injectedFailure('after-v8-trigger-create', options);

  const objects = await transaction.getAllAsync<SchemaObjectRow>(`
    SELECT name, type, sql FROM sqlite_schema
    WHERE tbl_name = 'records' AND type IN ('index', 'trigger') AND sql IS NOT NULL
  `);
  const byName = new Map(objects.map((row) => [row.name, row]));
  for (const requiredName of [...RECORDS_FINAL_OBJECT_NAMES, ...RECORDS_V6_OBJECT_NAMES]) {
    if (!byName.has(requiredName)) throw new Error(`timezone migration v8 missing schema object ${requiredName}`);
  }
  const insertTrigger = byName.get('records_sleep_insert_valid')?.sql ?? '';
  const updateTrigger = byName.get('records_sleep_update_valid')?.sql ?? '';
  if (/strftime|localtime/i.test(`${insertTrigger}\n${updateTrigger}`)) {
    throw new Error('timezone migration v8 retained current-timezone sleep date validation');
  }
  const sleepingIndex = byName.get('records_one_sleeping_unique')?.sql ?? '';
  if (!/unique index[\s\S]*where type = 'sleep' and sleep_status = 'sleeping'/i.test(sleepingIndex)) {
    throw new Error('timezone migration v8 changed the sleeping partial unique index');
  }
  const integrity = await transaction.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  if (integrity?.integrity_check !== 'ok') {
    throw new Error(`timezone migration v8 integrity_check failed: ${integrity?.integrity_check ?? 'no result'}`);
  }
}

export async function runMigrations(database: MigrationDatabase, options: MigrationOptions = {}) {
  const row = await database.getFirstAsync<VersionRow>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    if (options.targetVersion !== undefined && migration.version > options.targetVersion) break;

    await database.withExclusiveTransactionAsync(async (transaction) => {
      if (migration.version === 5) await runMigrationV5(transaction, options);
      else if (migration.version === 8) await runMigrationV8(transaction, options);
      else await transaction.execAsync(migration.sql);
      await transaction.execAsync(`PRAGMA user_version = ${migration.version}`);
      if (migration.version === 5) {
        const committedVersion = await transaction.getFirstAsync<VersionRow>('PRAGMA user_version');
        if (committedVersion?.user_version !== 5) throw new Error('records migration v5 could not set user_version');
      }
      if (migration.version === 8) {
        const committedVersion = await transaction.getFirstAsync<VersionRow>('PRAGMA user_version');
        if (committedVersion?.user_version !== 8) throw new Error('timezone migration v8 could not set user_version');
      }
    });
  }
}
