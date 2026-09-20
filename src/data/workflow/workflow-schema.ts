export const WORKFLOW_SCHEMA_VERSION = 1;
export const WORKFLOW_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workflow_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL CHECK (json_valid(value) AND json_extract(value, '$.format') = 1)
);
PRAGMA user_version = 1;
`;
