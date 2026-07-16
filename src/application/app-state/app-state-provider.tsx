import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { createContext, type PropsWithChildren, use, useCallback, useEffect, useMemo, useState } from 'react';
import { AppState as NativeAppState } from 'react-native';

import { saveBabyProfile } from '@/application/baby/save-baby-profile';
import { createFeedingService, type FeedingService } from '@/application/feeding/feeding-service';
import { createPoopService, type PoopService } from '@/application/poop/poop-service';
import { createPeeService, type PeeService } from '@/application/pee/pee-service';
import { createSleepService, type SleepService } from '@/application/sleep/sleep-service';
import { createOtherService, type OtherService } from '@/application/other/other-service';
import { createExportCsvService, type ExportCsvService } from '@/application/export/export-csv-service';
import { BackupRestoreCoordinator } from '@/application/backup/backup-restore-coordinator';
import { createBackupService, type BackupService } from '@/application/backup/backup-service';
import { createBackupValidationService } from '@/application/backup/backup-validation-service';
import { createRestoreService, type RestoreService } from '@/application/backup/restore-service';
import { createThemeService, type ThemeService } from '@/application/settings/theme-service';
import {
  createFeedingReminderService,
  type FeedingReminderService,
} from '@/application/reminders/feeding-reminder-service';
import {
  reconcileFeedingReminderOnStartup,
  subscribeToFeedingReminderForeground,
} from '@/application/reminders/feeding-reminder-lifecycle';
import type { BabyProfile } from '@/domain/baby/baby';
import type { BabyProfileInput } from '@/domain/baby/baby-profile';
import type { BackupThemeMode } from '@/domain/backup/backup-types';
import { toLocalDateKey } from '@/domain/date/local-date';
import { getDatabase } from '@/data/database/database';
import { createSQLiteBabyRepository } from '@/data/repositories/sqlite-baby-repository';
import { createSQLiteFeedingRepository } from '@/data/repositories/sqlite-feeding-repository';
import { ExpoPhotoStore } from '@/data/photo/expo-photo-store';
import { createSQLitePoopRepository } from '@/data/repositories/sqlite-poop-repository';
import { createSQLitePeeRepository } from '@/data/repositories/sqlite-pee-repository';
import { createSQLiteSleepRepository } from '@/data/repositories/sqlite-sleep-repository';
import { createSQLiteOtherRepository } from '@/data/repositories/sqlite-other-repository';
import { ExpoNotificationGateway, installForegroundNotificationHandler } from '@/data/notifications/expo-notification-gateway';
import { createSQLiteFeedingReminderSettingsRepository } from '@/data/repositories/sqlite-feeding-reminder-settings-repository';
import { createSQLiteExportSnapshotRepository } from '@/data/repositories/sqlite-export-snapshot-repository';
import { ExpoExportFileStore } from '@/data/export/expo-export-file-store';
import { ExpoShareGateway } from '@/data/export/expo-share-gateway';
import { createSQLiteBackupSnapshotRepository } from '@/data/repositories/sqlite-backup-snapshot-repository';
import { createSQLiteRestoreRepository } from '@/data/repositories/sqlite-restore-repository';
import { createSQLiteThemeSettingsRepository } from '@/data/repositories/sqlite-theme-settings-repository';
import { ExpoBackupFileStore } from '@/data/backup/expo-backup-file-store';
import { ExpoArchiveBinaryIo } from '@/data/backup/expo-archive-binary-io';
import { FflateBackupArchiveGateway } from '@/data/backup/fflate-backup-archive-gateway';
import { ExpoBackupPhotoGateway } from '@/data/backup/expo-backup-photo-gateway';
import { ExpoBackupDocumentPickerGateway } from '@/data/backup/expo-backup-document-picker';
import { ExpoBackupShareGateway } from '@/data/backup/expo-backup-share-gateway';
import { ExpoBackupHashGateway } from '@/data/backup/expo-backup-hash-gateway';

installForegroundNotificationHandler();

type AppStatus = 'loading' | 'ready' | 'error';

type AppStateValue = {
  status: AppStatus;
  errorMessage: string | null;
  babyProfile: BabyProfile | null;
  feedingService: FeedingService | null;
  feedingReminderService: FeedingReminderService | null;
  poopService: PoopService | null;
  peeService: PeeService | null;
  sleepService: SleepService | null;
  otherService: OtherService | null;
  exportCsvService: ExportCsvService | null;
  backupService: BackupService | null;
  restoreService: RestoreService | null;
  themeMode: BackupThemeMode;
  themeService: ThemeService | null;
  saveInitialBabyProfile(input: BabyProfileInput): ReturnType<typeof saveBabyProfile>;
  retryInitialization(): void;
};

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [babyProfile, setBabyProfile] = useState<BabyProfile | null>(null);
  const [feedingService, setFeedingService] = useState<FeedingService | null>(null);
  const [feedingReminderService, setFeedingReminderService] = useState<FeedingReminderService | null>(null);
  const [poopService, setPoopService] = useState<PoopService | null>(null);
  const [peeService, setPeeService] = useState<PeeService | null>(null);
  const [sleepService, setSleepService] = useState<SleepService | null>(null);
  const [otherService, setOtherService] = useState<OtherService | null>(null);
  const [exportCsvService, setExportCsvService] = useState<ExportCsvService | null>(null);
  const [backupService, setBackupService] = useState<BackupService | null>(null);
  const [restoreService, setRestoreService] = useState<RestoreService | null>(null);
  const [themeMode, setThemeMode] = useState<BackupThemeMode>('system');
  const [themeService, setThemeService] = useState<ThemeService | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const operationCoordinator = useMemo(() => new BackupRestoreCoordinator(), []);

  const retryInitialization = useCallback(() => {
    setStatus('loading');
    setErrorMessage(null);
    setInitializationAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    let active = true;

    getDatabase()
      .then(async (database) => {
        const idDependencies = {
          now: Date.now,
          createId: Crypto.randomUUID,
          createClientRequestId: Crypto.randomUUID,
          operationCoordinator,
        };
        const initializedPoopService = createPoopService(
          createSQLitePoopRepository(database),
          new ExpoPhotoStore(),
          { ...idDependencies, createPhotoId: Crypto.randomUUID },
        );
        try {
          const cleanupResult = await initializedPoopService.cleanupOrphanPhotos();
          if (__DEV__ && (cleanupResult.deleted || cleanupResult.failed)) {
            console.info('[photos] orphan cleanup', cleanupResult);
          }
        } catch (error) {
          console.warn('[photos] orphan cleanup failed', error);
        }
        const exportFileStore = new ExpoExportFileStore();
        try {
          const cleanupResult = await exportFileStore.cleanupExpired(Date.now());
          if (__DEV__ && (cleanupResult.deleted || cleanupResult.failed)) {
            console.info('[exports] expired file cleanup', cleanupResult);
          }
        } catch (error) {
          console.warn('[exports] expired file cleanup failed', error);
        }
        const feedingRepository = createSQLiteFeedingRepository(database);
        const initializedFeedingReminderService = createFeedingReminderService({
          settingsRepository: createSQLiteFeedingReminderSettingsRepository(database),
          feedingRepository,
          notificationGateway: new ExpoNotificationGateway(),
          now: Date.now,
          operationCoordinator,
        });
        try {
          await reconcileFeedingReminderOnStartup(initializedFeedingReminderService);
        } catch (error) {
          console.warn('[reminders] startup reconciliation failed', error);
        }
        const backupFileStore = new ExpoBackupFileStore();
        await backupFileStore.cleanupStaging();
        try {
          await backupFileStore.cleanupExpiredTemporary(Date.now());
        } catch (error) {
          console.warn('[backups] expired file cleanup failed', error);
        }
        const backupArchiveGateway = new FflateBackupArchiveGateway(new ExpoArchiveBinaryIo());
        const backupPhotoGateway = new ExpoBackupPhotoGateway();
        const backupValidationService = createBackupValidationService({
          fileStore: backupFileStore,
          archiveGateway: backupArchiveGateway,
          photoGateway: backupPhotoGateway,
          hashGateway: new ExpoBackupHashGateway(),
        });
        const initializedBackupService = createBackupService({
          snapshotRepository: createSQLiteBackupSnapshotRepository(database),
          fileStore: backupFileStore,
          archiveGateway: backupArchiveGateway,
          photoGateway: backupPhotoGateway,
          shareGateway: new ExpoBackupShareGateway(),
          validationService: backupValidationService,
          coordinator: operationCoordinator,
          now: Date.now,
          createId: Crypto.randomUUID,
          appVersion: Constants.expoConfig?.version ?? '1.0.0',
          timezoneId: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
          timezoneOffsetMinutes: () => new Date().getTimezoneOffset(),
        });
        const initializedRestoreService = createRestoreService({
          validationService: backupValidationService,
          fileStore: backupFileStore,
          restoreRepository: createSQLiteRestoreRepository(database),
          backupService: initializedBackupService,
          photoGateway: backupPhotoGateway,
          documentPicker: new ExpoBackupDocumentPickerGateway(),
          coordinator: operationCoordinator,
          reminderSync: () => initializedFeedingReminderService.syncFeedingReminder({ forceReschedule: true }),
          refreshAppState: async () => retryInitialization(),
          now: Date.now,
          createId: Crypto.randomUUID,
        });
        const themeRepository = createSQLiteThemeSettingsRepository(database);
        const loadedThemeMode = await themeRepository.get();
        const initializedThemeService = createThemeService({
          repository: themeRepository,
          coordinator: operationCoordinator,
          now: Date.now,
          onChanged: setThemeMode,
        });
        return {
          profile: await createSQLiteBabyRepository(database).get(),
          feedingService: createFeedingService(feedingRepository, {
            ...idDependencies,
            syncFeedingReminder: initializedFeedingReminderService.syncFeedingReminder,
          }),
          feedingReminderService: initializedFeedingReminderService,
          poopService: initializedPoopService,
          peeService: createPeeService(createSQLitePeeRepository(database), idDependencies),
          sleepService: createSleepService(createSQLiteSleepRepository(database), idDependencies),
          otherService: createOtherService(createSQLiteOtherRepository(database), idDependencies),
          exportCsvService: createExportCsvService({
            repository: createSQLiteExportSnapshotRepository(database),
            fileStore: exportFileStore,
            shareGateway: new ExpoShareGateway(),
            now: Date.now,
          }),
          backupService: initializedBackupService,
          restoreService: initializedRestoreService,
          themeMode: loadedThemeMode,
          themeService: initializedThemeService,
        };
      })
      .then(({
        profile,
        feedingService: initializedFeedingService,
        feedingReminderService: initializedFeedingReminderService,
        poopService: initializedPoopService,
        peeService: initializedPeeService,
        sleepService: initializedSleepService,
        otherService: initializedOtherService,
        exportCsvService: initializedExportCsvService,
        backupService: initializedBackupService,
        restoreService: initializedRestoreService,
        themeMode: loadedThemeMode,
        themeService: initializedThemeService,
      }) => {
        if (!active) return;
        if (__DEV__) {
          console.info('[database] baby profile loaded from SQLite', {
            exists: profile !== null,
            id: profile?.id ?? null,
            birthDate: profile?.birthDate ?? null,
          });
        }
        setBabyProfile(profile);
        setFeedingService(initializedFeedingService);
        setFeedingReminderService(initializedFeedingReminderService);
        setPoopService(initializedPoopService);
        setPeeService(initializedPeeService);
        setSleepService(initializedSleepService);
        setOtherService(initializedOtherService);
        setExportCsvService(initializedExportCsvService);
        setBackupService(initializedBackupService);
        setRestoreService(initializedRestoreService);
        setThemeMode(loadedThemeMode);
        setThemeService(initializedThemeService);
        setStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(String(error));
        setStatus('error');
      });

    return () => {
      active = false;
    };
  }, [initializationAttempt, operationCoordinator, retryInitialization]);

  useEffect(() => {
    if (!feedingReminderService) return undefined;
    const subscription = subscribeToFeedingReminderForeground(
      feedingReminderService,
      (listener) => NativeAppState.addEventListener('change', listener),
    );
    return () => subscription.remove();
  }, [feedingReminderService]);

  const saveInitialBabyProfile = useCallback(async (input: BabyProfileInput) => {
    const nowMs = Date.now();
    const database = await getDatabase();
    const result = await saveBabyProfile(input, {
      repository: createSQLiteBabyRepository(database),
      todayDate: toLocalDateKey(nowMs),
      nowMs,
      createId: () => Crypto.randomUUID(),
      operationCoordinator,
    });
    if (result.ok) setBabyProfile(result.profile);
    return result;
  }, [operationCoordinator]);

  const value = useMemo<AppStateValue>(
    () => ({
      status,
      errorMessage,
      babyProfile,
      feedingService,
      feedingReminderService,
      poopService,
      peeService,
      sleepService,
      otherService,
      exportCsvService,
      backupService,
      restoreService,
      themeMode,
      themeService,
      saveInitialBabyProfile,
      retryInitialization,
    }),
    [backupService, babyProfile, errorMessage, exportCsvService, feedingReminderService, feedingService, otherService, peeService, poopService, restoreService, retryInitialization, saveInitialBabyProfile, sleepService, status, themeMode, themeService],
  );

  return <AppStateContext value={value}>{children}</AppStateContext>;
}

export function useAppState() {
  const value = use(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
