export const RECORD_COLUMNS = [
  'id',
  'client_request_id',
  'create_payload_hash',
  'type',
  'event_time_ms',
  'record_date',
  'sort_time_ms',
  'created_at_ms',
  'updated_at_ms',
  'note',
  'feeding_type',
  'milk_amount_ml',
  'left_duration_min',
  'right_duration_min',
  'poop_color',
  'poop_texture',
  'poop_amount',
  'photo_uri',
  'pee_color',
  'pee_amount',
  'sleep_start_ms',
  'sleep_end_ms',
  'sleep_status',
  'other_title',
] as const;

export const RECORD_COLUMNS_SQL = RECORD_COLUMNS.join(', ');

export const RECORDS_V5_TABLE_SQL = `
  CREATE TABLE records_v5 (
    id TEXT PRIMARY KEY NOT NULL,
    client_request_id TEXT NOT NULL,
    create_payload_hash TEXT NOT NULL CHECK (length(create_payload_hash) = 64),
    type TEXT NOT NULL CHECK (type IN ('feeding', 'poop', 'pee', 'sleep', 'other')),
    event_time_ms INTEGER NOT NULL,
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
        AND sleep_start_ms IS NOT NULL
        AND event_time_ms = sleep_start_ms
        AND sort_time_ms = sleep_start_ms
        AND sleep_status IS NOT NULL
        AND (
          (sleep_status = 'sleeping' AND sleep_end_ms IS NULL)
          OR (sleep_status = 'completed' AND sleep_end_ms IS NOT NULL AND sleep_end_ms > sleep_start_ms)
        )
      )
      OR
      (type <> 'sleep'
        AND sleep_start_ms IS NULL
        AND sleep_end_ms IS NULL
        AND sleep_status IS NULL
      )
    )
  );
`;

export const RECORDS_V5_COPY_SQL = `
  INSERT INTO records_v5 (${RECORD_COLUMNS_SQL})
  SELECT
    id,
    client_request_id,
    create_payload_hash,
    type,
    CASE WHEN type = 'sleep' THEN sleep_start_ms ELSE event_time_ms END,
    CASE WHEN type = 'sleep'
      THEN strftime('%Y-%m-%d', sleep_start_ms / 1000.0, 'unixepoch', 'localtime')
      ELSE record_date END,
    CASE WHEN type = 'sleep' THEN sleep_start_ms ELSE sort_time_ms END,
    created_at_ms,
    updated_at_ms,
    note,
    feeding_type,
    milk_amount_ml,
    left_duration_min,
    right_duration_min,
    poop_color,
    poop_texture,
    poop_amount,
    photo_uri,
    pee_color,
    pee_amount,
    sleep_start_ms,
    sleep_end_ms,
    sleep_status,
    other_title
  FROM records;
`;

export const RECORDS_FINAL_INDEXES_SQL = `
  CREATE UNIQUE INDEX records_client_request_id_unique ON records(client_request_id);
  CREATE INDEX records_date_sort_index ON records(record_date, sort_time_ms DESC);
  CREATE INDEX records_date_type_sort_index ON records(record_date, type, sort_time_ms DESC);
  CREATE INDEX records_type_sort_index ON records(type, sort_time_ms DESC);
  CREATE UNIQUE INDEX records_one_sleeping_unique
    ON records(type) WHERE type = 'sleep' AND sleep_status = 'sleeping';
  CREATE INDEX records_completed_sleep_interval_index
    ON records(sleep_start_ms, sleep_end_ms)
    WHERE type = 'sleep' AND sleep_status = 'completed';
`;

const FEEDING_INVALID = `
  (
    NEW.type = 'feeding' AND (
      COALESCE(
        (NEW.feeding_type = 'formula' AND NEW.milk_amount_ml BETWEEN 1 AND 999
          AND NEW.left_duration_min IS NULL AND NEW.right_duration_min IS NULL)
        OR
        (NEW.feeding_type = 'breast' AND NEW.milk_amount_ml IS NULL
          AND NEW.left_duration_min BETWEEN 0 AND 180 AND NEW.right_duration_min BETWEEN 0 AND 180
          AND NEW.left_duration_min + NEW.right_duration_min > 0)
        OR
        (NEW.feeding_type = 'mixed' AND NEW.milk_amount_ml BETWEEN 1 AND 999
          AND NEW.left_duration_min BETWEEN 0 AND 180 AND NEW.right_duration_min BETWEEN 0 AND 180
          AND NEW.left_duration_min + NEW.right_duration_min > 0),
        0
      ) = 0
      OR NEW.poop_color IS NOT NULL OR NEW.poop_texture IS NOT NULL OR NEW.poop_amount IS NOT NULL
      OR NEW.photo_uri IS NOT NULL OR NEW.pee_color IS NOT NULL OR NEW.pee_amount IS NOT NULL
      OR NEW.sleep_start_ms IS NOT NULL OR NEW.sleep_end_ms IS NOT NULL OR NEW.sleep_status IS NOT NULL
      OR NEW.other_title IS NOT NULL
    )
  )
  OR
  (NEW.type <> 'feeding' AND (
    NEW.feeding_type IS NOT NULL OR NEW.milk_amount_ml IS NOT NULL
    OR NEW.left_duration_min IS NOT NULL OR NEW.right_duration_min IS NOT NULL
  ))
`;

const POOP_INVALID = `
  (
    NEW.type = 'poop' AND (
      NEW.feeding_type IS NOT NULL OR NEW.milk_amount_ml IS NOT NULL
      OR NEW.left_duration_min IS NOT NULL OR NEW.right_duration_min IS NOT NULL
      OR NEW.pee_color IS NOT NULL OR NEW.pee_amount IS NOT NULL
      OR NEW.sleep_start_ms IS NOT NULL OR NEW.sleep_end_ms IS NOT NULL OR NEW.sleep_status IS NOT NULL
      OR NEW.other_title IS NOT NULL
      OR (NEW.photo_uri IS NOT NULL AND (
        NEW.photo_uri NOT GLOB 'poop-photos/*.jpg'
        OR instr(NEW.photo_uri, '..') > 0
        OR instr(substr(NEW.photo_uri, length('poop-photos/') + 1), '/') > 0
      ))
    )
  )
  OR
  (NEW.type <> 'poop' AND (
    NEW.poop_color IS NOT NULL OR NEW.poop_texture IS NOT NULL
    OR NEW.poop_amount IS NOT NULL OR NEW.photo_uri IS NOT NULL
  ))
`;

const PEE_INVALID = `
  (
    NEW.type = 'pee' AND (
      NEW.feeding_type IS NOT NULL OR NEW.milk_amount_ml IS NOT NULL
      OR NEW.left_duration_min IS NOT NULL OR NEW.right_duration_min IS NOT NULL
      OR NEW.poop_color IS NOT NULL OR NEW.poop_texture IS NOT NULL OR NEW.poop_amount IS NOT NULL
      OR NEW.photo_uri IS NOT NULL
      OR NEW.sleep_start_ms IS NOT NULL OR NEW.sleep_end_ms IS NOT NULL OR NEW.sleep_status IS NOT NULL
      OR NEW.other_title IS NOT NULL
    )
  )
  OR (NEW.type <> 'pee' AND (NEW.pee_color IS NOT NULL OR NEW.pee_amount IS NOT NULL))
`;

function sleepInvalid(includeCurrentTimezoneDateCheck: boolean) {
  const dateCheck = includeCurrentTimezoneDateCheck
    ? "OR NEW.record_date <> strftime('%Y-%m-%d', NEW.sleep_start_ms / 1000.0, 'unixepoch', 'localtime')"
    : '';
  return `
  (
    NEW.type = 'sleep' AND (
      NEW.feeding_type IS NOT NULL OR NEW.milk_amount_ml IS NOT NULL
      OR NEW.left_duration_min IS NOT NULL OR NEW.right_duration_min IS NOT NULL
      OR NEW.poop_color IS NOT NULL OR NEW.poop_texture IS NOT NULL OR NEW.poop_amount IS NOT NULL
      OR NEW.photo_uri IS NOT NULL OR NEW.pee_color IS NOT NULL OR NEW.pee_amount IS NOT NULL
      OR NEW.other_title IS NOT NULL
      OR NEW.sleep_start_ms IS NULL OR NEW.event_time_ms <> NEW.sleep_start_ms
      OR NEW.sort_time_ms <> NEW.sleep_start_ms
      ${dateCheck}
      OR NEW.sleep_status NOT IN ('sleeping', 'completed')
      OR (NEW.sleep_status = 'sleeping' AND NEW.sleep_end_ms IS NOT NULL)
      OR (NEW.sleep_status = 'completed' AND (NEW.sleep_end_ms IS NULL OR NEW.sleep_end_ms <= NEW.sleep_start_ms))
    )
  )
  OR (NEW.type <> 'sleep' AND (
    NEW.sleep_start_ms IS NOT NULL OR NEW.sleep_end_ms IS NOT NULL OR NEW.sleep_status IS NOT NULL
  ))
`;
}

const SLEEP_INVALID_V7 = sleepInvalid(true);
const SLEEP_INVALID_V8 = sleepInvalid(false);

function triggerPair(name: string, message: string, invalid: string) {
  return `
    CREATE TRIGGER records_${name}_insert_valid BEFORE INSERT ON records
    WHEN ${invalid}
    BEGIN SELECT RAISE(ABORT, '${message}'); END;

    CREATE TRIGGER records_${name}_update_valid BEFORE UPDATE ON records
    WHEN ${invalid}
    BEGIN SELECT RAISE(ABORT, '${message}'); END;
  `;
}

const SLEEP_TRIGGERS_SQL = `
  CREATE TRIGGER records_sleep_insert_valid BEFORE INSERT ON records
  WHEN ${SLEEP_INVALID_V7}
  BEGIN SELECT RAISE(ABORT, 'invalid sleep fields'); END;

  CREATE TRIGGER records_sleep_update_valid BEFORE UPDATE ON records
  WHEN ${SLEEP_INVALID_V7}
    OR (OLD.type = 'sleep' AND OLD.sleep_status = 'completed'
      AND (NEW.type <> 'sleep' OR NEW.sleep_status <> 'completed'))
  BEGIN SELECT RAISE(ABORT, 'invalid sleep fields or state transition'); END;
`;

export const RECORDS_V8_DROP_SLEEP_TRIGGERS_SQL = `
  DROP TRIGGER records_sleep_insert_valid;
  DROP TRIGGER records_sleep_update_valid;
`;

export const RECORDS_V8_CREATE_SLEEP_TRIGGERS_SQL = `
  CREATE TRIGGER records_sleep_insert_valid BEFORE INSERT ON records
  WHEN ${SLEEP_INVALID_V8}
  BEGIN SELECT RAISE(ABORT, 'invalid sleep fields'); END;

  CREATE TRIGGER records_sleep_update_valid BEFORE UPDATE ON records
  WHEN ${SLEEP_INVALID_V8}
    OR (OLD.type = 'sleep' AND OLD.sleep_status = 'completed'
      AND (NEW.type <> 'sleep' OR NEW.sleep_status <> 'completed'))
  BEGIN SELECT RAISE(ABORT, 'invalid sleep fields or state transition'); END;
`;

export const RECORDS_V8_SLEEP_TRIGGERS_SQL =
  `${RECORDS_V8_DROP_SLEEP_TRIGGERS_SQL}\n${RECORDS_V8_CREATE_SLEEP_TRIGGERS_SQL}`;

export const RECORDS_FINAL_TRIGGERS_SQL = [
  triggerPair('feeding', 'invalid feeding fields', FEEDING_INVALID),
  triggerPair('poop', 'invalid poop fields', POOP_INVALID),
  triggerPair('pee', 'invalid pee fields', PEE_INVALID),
  SLEEP_TRIGGERS_SQL,
].join('\n');

export const RECORDS_FINAL_OBJECTS_SQL = `${RECORDS_FINAL_INDEXES_SQL}\n${RECORDS_FINAL_TRIGGERS_SQL}`;

export const RECORDS_V5_REBUILD_SQL = `
  ${RECORDS_V5_TABLE_SQL}
  ${RECORDS_V5_COPY_SQL}
  DROP TABLE records;
  ALTER TABLE records_v5 RENAME TO records;
  ${RECORDS_FINAL_OBJECTS_SQL}
`;

export const RECORDS_FINAL_OBJECT_NAMES = [
  'records_client_request_id_unique',
  'records_completed_sleep_interval_index',
  'records_date_sort_index',
  'records_date_type_sort_index',
  'records_feeding_insert_valid',
  'records_feeding_update_valid',
  'records_one_sleeping_unique',
  'records_pee_insert_valid',
  'records_pee_update_valid',
  'records_poop_insert_valid',
  'records_poop_update_valid',
  'records_sleep_insert_valid',
  'records_sleep_update_valid',
  'records_type_sort_index',
] as const;

export const RECORDS_OTHER_TRIGGERS_SQL = `
  CREATE TRIGGER records_other_insert_valid BEFORE INSERT ON records
  WHEN
    (NEW.type = 'other' AND (
      NEW.other_title IS NULL
      OR length(trim(NEW.other_title)) NOT BETWEEN 1 AND 30
    ))
    OR (NEW.type <> 'other' AND NEW.other_title IS NOT NULL)
  BEGIN SELECT RAISE(ABORT, 'invalid other fields'); END;

  CREATE TRIGGER records_other_update_valid BEFORE UPDATE ON records
  WHEN
    (NEW.type = 'other' AND (
      NEW.other_title IS NULL
      OR length(trim(NEW.other_title)) NOT BETWEEN 1 AND 30
    ))
    OR (NEW.type <> 'other' AND NEW.other_title IS NOT NULL)
  BEGIN SELECT RAISE(ABORT, 'invalid other fields'); END;
`;

export const RECORDS_V6_OBJECT_NAMES = [
  'records_other_insert_valid',
  'records_other_update_valid',
] as const;
