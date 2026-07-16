import type { BackupOperationCoordinator } from '@/application/ports/backup';
import type { ThemeSettingsRepository } from '@/application/ports/theme-settings';
import type { BackupThemeMode } from '@/domain/backup/backup-types';

type Dependencies = {
  repository: ThemeSettingsRepository;
  coordinator: BackupOperationCoordinator;
  now(): number;
  onChanged(mode: BackupThemeMode): void;
};

export function createThemeService(dependencies: Dependencies) {
  return {
    getMode: () => dependencies.repository.get(),
    setMode: (mode: BackupThemeMode) => dependencies.coordinator.runExclusive(async () => {
      await dependencies.repository.set(mode, dependencies.now());
      dependencies.onChanged(mode);
      return mode;
    }),
  };
}

export type ThemeService = ReturnType<typeof createThemeService>;
