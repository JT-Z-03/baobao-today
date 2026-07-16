export type BackupRecordType = 'feeding' | 'poop' | 'pee' | 'sleep' | 'other';
export type BackupThemeMode = 'system' | 'light' | 'dark';

export interface BackupBaby {
  id: string;
  name: string;
  birth_date: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface BackupRecord {
  id: string;
  client_request_id: string;
  create_payload_hash: string;
  type: BackupRecordType;
  event_time_ms: number;
  record_date: string;
  sort_time_ms: number;
  created_at_ms: number;
  updated_at_ms: number;
  note: string | null;
  feeding_type: 'breast' | 'formula' | 'mixed' | null;
  milk_amount_ml: number | null;
  left_duration_min: number | null;
  right_duration_min: number | null;
  poop_color: 'yellow' | 'green' | 'brown' | 'black' | 'red' | 'other' | null;
  poop_texture: 'watery' | 'loose' | 'pasty' | 'formed' | 'pellet' | null;
  poop_amount: 'small' | 'medium' | 'large' | null;
  photo_backup_entry: string | null;
  photo_sha256: string | null;
  pee_color: 'clear' | 'pale-yellow' | 'yellow' | 'dark-yellow' | null;
  pee_amount: 'small' | 'medium' | 'large' | null;
  sleep_start_ms: number | null;
  sleep_end_ms: number | null;
  sleep_status: 'sleeping' | 'completed' | null;
  other_title: string | null;
}

export interface BackupSettings {
  theme_mode: BackupThemeMode;
  feeding_reminder_enabled: boolean;
  feeding_reminder_interval_minutes: number | null;
}

export interface BackupData {
  baby: BackupBaby;
  records: BackupRecord[];
  settings: BackupSettings;
}

export interface BackupIntegrityEntry {
  path: string;
  byteLength: number;
  sha256: string;
}

export interface BackupRecordCounts {
  feeding: number;
  poop: number;
  pee: number;
  sleep: number;
  other: number;
}

export interface BackupManifest {
  format: 'baobao-today-backup';
  formatVersion: 1;
  backupId: string;
  createdAtMs: number;
  appVersion: string;
  sourceSchemaVersion: number;
  timezoneId: string;
  timezoneOffsetMinutes: number;
  babyId: string;
  recordCounts: BackupRecordCounts;
  totalRecordCount: number;
  photoCount: number;
  photoTotalBytes: number;
  entries: BackupIntegrityEntry[];
}
