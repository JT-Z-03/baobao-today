import type { BackupThemeMode } from '@/domain/backup/backup-types';

export interface ThemeSettingsRepository {
  get(): Promise<BackupThemeMode>;
  set(mode: BackupThemeMode, nowMs: number): Promise<void>;
}
