import { createContext, use, type ReactNode } from 'react';

import type { BackupThemeMode } from '@/domain/backup/backup-types';

const ThemeModeContext = createContext<BackupThemeMode>('system');

export function ThemeModeProvider({ children, mode }: { children: ReactNode; mode: BackupThemeMode }) {
  return <ThemeModeContext.Provider value={mode}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode() {
  return use(ThemeModeContext);
}
