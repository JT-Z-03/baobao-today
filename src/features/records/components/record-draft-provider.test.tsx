import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { useEffect } from 'react';
import type { OtherRepository } from '@/application/ports/other-repository';
import type { OtherRecord } from '@/domain/other/other';
import { AppStateProvider, useAppState } from '@/application/app-state/app-state-provider';
import { RecordDraftBoundary } from '@/features/records/components/record-draft-boundary';
import { PendingRecordsEntry } from '@/features/records/components/pending-records-entry';
import { OtherForm } from '@/features/other/components/other-form';
import { createRecordDraftService } from '@/application/drafts/record-draft-service';
import { emptyWorkflowState, type WorkflowStateStore } from '@/application/ports/workflow-state';
import { TodayScreen } from '@/features/today/screens/today-screen';

let mockWorkflow = emptyWorkflowState('dataset');
const mockWorkflowStore: WorkflowStateStore = {
  read: async () => structuredClone(mockWorkflow),
  transaction: async (update) => {
    const state = structuredClone(mockWorkflow); const result = update(state); mockWorkflow = state; return result;
  },
};
const mockGetWorkflowStore = jest.fn(async () => mockWorkflowStore);
const mockDraftPhotoRemove = jest.fn(async (_uri: string): Promise<void> => undefined);
let mockCurrent: ReturnType<typeof useAppState>;
let mockProfile = { id: 'baby', name: '虚构宝宝', birthDate: '2026-01-01', createdAtMs: 1, updatedAtMs: 1 };
let mockSaved: OtherRecord | null = null;
const mockOtherRepository: OtherRepository = {
  create: jest.fn(async ({ id, clientRequestId, input, nowMs }) => {
    mockSaved = { ...input, id, clientRequestId, createPayloadHash: 'a'.repeat(64), type: 'other',
      recordDate: '2026-10-04', sortTimeMs: input.eventTimeMs, createdAtMs: nowMs, updatedAtMs: nowMs };
    return mockSaved;
  }),
  getById: async () => mockSaved, getByClientRequestId: async () => mockSaved,
  update: jest.fn(async (_id, input, nowMs) => { mockSaved = { ...mockSaved!, ...input, updatedAtMs: nowMs }; return mockSaved; }),
  delete: jest.fn(async () => { mockSaved = null; }), listByDate: async () => mockSaved ? [mockSaved] : [],
};
const mockBack = jest.fn();
let mockPrepare = jest.fn();
const mockSafety = jest.fn(async () => ({ uri: 'memory://safety.zip', filename: 'backup.zip' }));
const mockReplace = jest.fn(async (data) => { mockProfile = { ...mockProfile, id: data.baby.id, name: data.baby.name }; });
const mockCleanupStaging = jest.fn(async () => undefined);
let mockUnmounts = 0;
let mockGeneratedId = 0;
let mockRealRouter = false;
let mockPendingMounts = 0;
let mockPendingUnmounts = 0;
const mockFeedingDashboard = jest.fn(async (_date: string) => ({
  latest: null, timeline: [], summary: { feedingCount: 0, formulaTotalMl: 0, breastMilkTotalMl: 0, measurableTotalMl: 0 }, refreshedAtMs: 1,
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => `provider-${++mockGeneratedId}` }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useRouter: () => mockRealRouter ? jest.requireActual('expo-router').useRouter() : ({ back: mockBack, replace: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      const useFocus = mockRealRouter ? jest.requireActual('expo-router').useFocusEffect : React.useEffect;
      return useFocus(...(mockRealRouter ? [callback] : [callback, [callback]]));
    },
  };
});
jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => mockRealRouter ? jest.requireActual('expo-router/react-navigation').useNavigation() : ({ dispatch: jest.fn() }),
  usePreventRemove: (...args: unknown[]) => mockRealRouter ? jest.requireActual('expo-router/react-navigation').usePreventRemove(...args) : undefined,
}));
jest.mock('@/features/records/components/pending-records-entry', () => {
  const React = jest.requireActual('react');
  const { PendingRecordsEntry: ActualEntry } = jest.requireActual('@/features/records/components/pending-records-entry');
  return { PendingRecordsEntry: function LifecycleCountedEntry() {
    // Instrument the real component lifecycle; no instance or state survives this wrapper's unmount.
    React.useEffect(() => { mockPendingMounts++; return () => { mockPendingUnmounts++; }; }, []);
    return React.createElement(ActualEntry);
  } };
});
jest.mock('@/features/records/components/record-save-feedback', () => ({ showRecordSaved: jest.fn() }));
jest.mock('@/data/database/database', () => ({ getDatabase: async () => ({}) }));
jest.mock('@/data/workflow/workflow-database', () => ({ getWorkflowStore: () => mockGetWorkflowStore() }));
jest.mock('@/data/workflow/expo-draft-attachment-store', () => ({ ExpoDraftAttachmentStore: class {
  cleanup = async () => undefined; remove = mockDraftPhotoRemove;
} }));
jest.mock('@/data/repositories/sqlite-baby-repository', () => ({ createSQLiteBabyRepository: () => ({ get: async () => mockProfile }) }));
jest.mock('@/data/repositories/sqlite-other-repository', () => ({ createSQLiteOtherRepository: () => mockOtherRepository }));
jest.mock('@/data/repositories/sqlite-poop-repository', () => ({ createSQLitePoopRepository: () => ({}) }));
jest.mock('@/data/repositories/sqlite-feeding-repository', () => ({ createSQLiteFeedingRepository: () => ({}) }));
jest.mock('@/data/repositories/sqlite-pee-repository', () => ({ createSQLitePeeRepository: () => ({}) }));
jest.mock('@/data/repositories/sqlite-sleep-repository', () => ({ createSQLiteSleepRepository: () => ({}) }));
jest.mock('@/data/repositories/sqlite-export-snapshot-repository', () => ({ createSQLiteExportSnapshotRepository: () => ({}) }));
jest.mock('@/data/repositories/sqlite-backup-snapshot-repository', () => ({ createSQLiteBackupSnapshotRepository: () => ({}) }));
jest.mock('@/data/repositories/sqlite-feeding-reminder-settings-repository', () => ({ createSQLiteFeedingReminderSettingsRepository: () => ({}) }));
jest.mock('@/data/repositories/sqlite-theme-settings-repository', () => ({ createSQLiteThemeSettingsRepository: () => ({ get: async () => 'light' }) }));
jest.mock('@/data/repositories/sqlite-restore-repository', () => ({ createSQLiteRestoreRepository: () => ({
  hasCurrentData: async () => true, listReferencedPhotoPaths: async () => [], replaceAll: mockReplace,
}) }));
jest.mock('@/data/photo/expo-photo-store', () => ({ ExpoPhotoStore: class {} }));
jest.mock('@/application/poop/poop-service', () => ({ createPoopService: () => ({ cleanupOrphanPhotos: async () => ({ deleted: 0, failed: 0 }), getHistory: async () => [], getDailyCount: async () => 0 }) }));
jest.mock('@/application/feeding/feeding-service', () => ({ createFeedingService: () => ({ getDashboard: mockFeedingDashboard }) }));
jest.mock('@/application/pee/pee-service', () => ({ createPeeService: () => ({ getHistory: async () => [], getDailyCount: async () => 0 }) }));
jest.mock('@/application/sleep/sleep-service', () => ({ createSleepService: () => ({ getDashboard: async () => ({ active: null, timeline: [], completedTotalMs: 0, refreshedAtMs: 1 }) }) }));
jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));
jest.mock('@/components/ui/app-illustration', () => ({ AppIllustration: () => null }));
jest.mock('@/components/ui/brand-mark', () => ({ BrandMark: () => null }));
jest.mock('@/data/notifications/expo-notification-gateway', () => ({ ExpoNotificationGateway: class {}, installForegroundNotificationHandler: jest.fn() }));
jest.mock('@/application/reminders/feeding-reminder-service', () => ({ createFeedingReminderService: () => ({ syncFeedingReminder: async () => undefined }) }));
jest.mock('@/application/reminders/feeding-reminder-lifecycle', () => ({
  reconcileFeedingReminderOnStartup: async () => undefined, subscribeToFeedingReminderForeground: () => ({ remove: jest.fn() }),
}));
jest.mock('@/data/export/expo-export-file-store', () => ({ ExpoExportFileStore: class { cleanupExpired = async () => ({ deleted: 0, failed: 0 }); } }));
jest.mock('@/data/export/expo-share-gateway', () => ({ ExpoShareGateway: class {} }));
jest.mock('@/data/backup/expo-backup-file-store', () => ({ ExpoBackupFileStore: class {
  cleanupStaging = mockCleanupStaging; cleanupExpiredTemporary = async () => undefined;
  getSafetyArchiveUri = async () => 'memory://last.zip'; promoteSafetyArchive = async () => undefined; deleteArchive = async () => undefined;
} }));
jest.mock('@/data/backup/expo-archive-binary-io', () => ({ ExpoArchiveBinaryIo: class {} }));
jest.mock('@/data/backup/fflate-backup-archive-gateway', () => ({ FflateBackupArchiveGateway: class {} }));
jest.mock('@/data/backup/expo-backup-photo-gateway', () => ({ ExpoBackupPhotoGateway: class { deleteManaged = async () => undefined; } }));
jest.mock('@/data/backup/expo-backup-document-picker', () => ({ ExpoBackupDocumentPickerGateway: class {
  pickBackup = async () => ({ canceled: false, uri: 'memory://picked.zip', name: 'picked.zip', size: 100 });
} }));
jest.mock('@/data/backup/expo-backup-share-gateway', () => ({ ExpoBackupShareGateway: class {} }));
jest.mock('@/data/backup/expo-backup-hash-gateway', () => ({ ExpoBackupHashGateway: class {} }));
jest.mock('@/data/backup/expo-backup-export-gateway', () => ({ ExpoBackupExportGateway: class {} }));
jest.mock('@/application/backup/backup-service', () => ({ createBackupService: () => ({ createSafetyArchive: mockSafety }) }));
jest.mock('@/application/backup/backup-validation-service', () => ({ createBackupValidationService: () => ({ prepare: (...args: unknown[]) => mockPrepare(...args) }) }));
jest.mock('@/application/backup/backup-export-service', () => ({ createBackupExportService: () => ({ reconcilePending: async () => undefined }) }));

// Load the Router's native module graph before individual tests' unchanged timeout begins.
const mockActualRouter = jest.requireActual<typeof import('expo-router')>('expo-router');
const mockRouterTesting = jest.requireActual<typeof import('expo-router/testing-library')>('expo-router/testing-library');
const mockActualTabsLayout = jest.requireActual<typeof import('@/app/(tabs)/_layout')>('@/app/(tabs)/_layout').default;
const mockActualTodayRoute = jest.requireActual<typeof import('@/app/(tabs)/today')>('@/app/(tabs)/today').default;
const mockActualNewOtherRoute = jest.requireActual<typeof import('@/app/other/new')>('@/app/other/new').default;

function Form() {
  const app = useAppState();
  // Same loading gate used by RootNavigator, without native navigation or real files.
  if (app.status !== 'ready') return <Text>{app.status}</Text>;
  return <MountedForm />;
}
function MountedForm() {
  const app = useAppState();
  useEffect(() => () => { mockUnmounts++; }, []);
  return <RecordDraftBoundary kind="other"><OtherForm initialInput={{ eventTimeMs: 50, title: '', note: null }}
    clientRequestId="unused" onSave={async (input, requestId) => {
      if (!requestId) throw new Error('A durable request ID is required');
      await app.otherService!.create(input, requestId);
    }} /></RecordDraftBoundary>;
}
function Probe({ form = false }: { form?: boolean }) {
  const app = useAppState();
  useEffect(() => { mockCurrent = app; }, [app]);
  return form ? <Form /> : <Text>{app.status}</Text>;
}
beforeEach(() => {
  jest.restoreAllMocks(); jest.clearAllMocks(); mockWorkflow = emptyWorkflowState('dataset'); mockSaved = null; mockUnmounts = 0; mockGeneratedId = 0;
  mockGetWorkflowStore.mockReset().mockResolvedValue(mockWorkflowStore);
  mockDraftPhotoRemove.mockReset().mockResolvedValue(undefined);
  mockFeedingDashboard.mockReset().mockResolvedValue({ latest: null, timeline: [], summary: { feedingCount: 0, formulaTotalMl: 0, breastMilkTotalMl: 0, measurableTotalMl: 0 }, refreshedAtMs: 1 });
  mockRealRouter = false; mockPendingMounts = 0; mockPendingUnmounts = 0;
  mockProfile = { id: 'baby', name: '虚构宝宝', birthDate: '2026-01-01', createdAtMs: 1, updatedAtMs: 1 };
});

test('R15: actual Provider regenerates services after last quarantined draft is discarded; stale guard stays closed', async () => {
  let id = 0;
  const drafts = createRecordDraftService(mockWorkflowStore, () => 1_000, () => `draft-${++id}`);
  await drafts.create({ babyId: 'baby', kind: 'other' }, { eventTimeMs: 50, title: '旧草稿', note: '' });
  await drafts.beginRestore('interrupted');
  const screen = await render(<AppStateProvider><Probe form /></AppStateProvider>);
  await screen.findByText('旧草稿需核对');
  const oldOther = mockCurrent.otherService!; const oldDraft = mockCurrent.draftService;
  await fireEvent.press(screen.getByText('放弃草稿'));
  await screen.findByLabelText('标题');
  await waitFor(() => expect(mockCurrent.status).toBe('ready'));
  expect(mockCurrent.otherService).not.toBe(oldOther);
  expect(mockCurrent.draftService).not.toBe(oldDraft);
  expect(mockUnmounts).toBe(1);
  expect(mockWorkflow.restore).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('标题'), '当前记录');
  await fireEvent.press(screen.getByLabelText('保存其他记录'));
  await waitFor(() => expect(mockOtherRepository.create).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  await expect(mockCurrent.otherService!.update(mockSaved!.id, { eventTimeMs: 50, title: '编辑后', note: null })).resolves.toMatchObject({ title: '编辑后' });
  await expect(mockCurrent.otherService!.delete(mockSaved!.id)).resolves.toBeUndefined();
  await expect(oldOther.create({ eventTimeMs: 50, title: '旧服务迟到', note: null }, 'stale')).rejects.toThrow('资料已恢复');
  expect(mockOtherRepository.create).toHaveBeenCalledTimes(1);
  expect(mockOtherRepository.update).toHaveBeenCalledTimes(1);
  expect(mockOtherRepository.delete).toHaveBeenCalledTimes(1);
});

test('R15: one read failure after committed discard enters safe initialization retry and permits guarded CRUD', async () => {
  let id = 0;
  const drafts = createRecordDraftService(mockWorkflowStore, () => 1_000, () => `draft-${++id}`);
  await drafts.create({ babyId: 'baby', kind: 'other' }, { eventTimeMs: 50, title: '旧草稿', note: '' });
  await drafts.beginRestore('interrupted');
  const screen = await render(<AppStateProvider><Probe form /></AppStateProvider>);
  await screen.findByText('旧草稿需核对');
  const oldOther = mockCurrent.otherService!;
  const transact = mockWorkflowStore.transaction;
  jest.spyOn(mockWorkflowStore, 'transaction').mockImplementationOnce(async (update) => {
    const result = await transact(update);
    // Only the next read fails, after the durable removal and generation change have committed.
    jest.spyOn(mockWorkflowStore, 'read').mockRejectedValueOnce(new Error('transient SQLite read failure'));
    return result;
  });
  await fireEvent.press(screen.getByText('放弃草稿'));
  await screen.findByText('本机草稿暂不可用，原资料已保留，请重试');
  expect(mockWorkflow.restore).toBeNull(); expect(mockWorkflow.drafts).toEqual({});
  expect(mockWorkflow.generation).not.toBe('dataset');
  expect(mockOtherRepository.create).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('重试'));
  await screen.findByLabelText('标题');
  await waitFor(() => expect(mockCurrent.status).toBe('ready'));
  expect(mockCurrent.draftError).toBeNull();
  expect(mockCurrent.otherService).not.toBe(oldOther);
  await fireEvent.changeText(screen.getByLabelText('标题'), '重试后当前记录');
  await fireEvent.press(screen.getByLabelText('保存其他记录'));
  await waitFor(() => expect(mockOtherRepository.create).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  await expect(mockCurrent.otherService!.update(mockSaved!.id, { eventTimeMs: 50, title: '重试后编辑', note: null }))
    .resolves.toMatchObject({ title: '重试后编辑' });
  await expect(mockCurrent.otherService!.delete(mockSaved!.id)).resolves.toBeUndefined();
  await expect(oldOther.create({ eventTimeMs: 50, title: '旧服务迟到', note: null }, 'stale')).rejects.toThrow('资料已恢复');
  expect(mockOtherRepository.create).toHaveBeenCalledTimes(1);
  expect(mockOtherRepository.update).toHaveBeenCalledTimes(1); expect(mockOtherRepository.delete).toHaveBeenCalledTimes(1);
});

test('R15: a failed discard transaction preserves the prompt and succeeds on the second attempt', async () => {
  let id = 0;
  const drafts = createRecordDraftService(mockWorkflowStore, () => 1_000, () => `draft-${++id}`);
  await drafts.create({ babyId: 'baby', kind: 'other' }, { eventTimeMs: 50, title: '待保留草稿', note: '待保留备注' });
  await drafts.beginRestore('interrupted'); const before = structuredClone(mockWorkflow);
  const screen = await render(<AppStateProvider><Probe form /></AppStateProvider>);
  await screen.findByText('旧草稿需核对'); const oldOther = mockCurrent.otherService!;
  jest.spyOn(mockWorkflowStore, 'transaction').mockRejectedValueOnce(new Error('disk unavailable'));
  await fireEvent.press(screen.getByText('放弃草稿'));
  await screen.findByText('草稿暂未保存，请重试；当前输入仍保留');
  expect(mockWorkflow).toEqual(before); expect(mockCurrent.otherService).toBe(oldOther);
  expect(mockOtherRepository.create).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('放弃草稿'));
  await screen.findByLabelText('标题');
  expect(mockWorkflow.restore).toBeNull(); expect(mockWorkflow.drafts).toEqual({});
  expect(mockCurrent.otherService).not.toBe(oldOther);
  await fireEvent.changeText(screen.getByLabelText('标题'), '二次放弃后当前记录');
  await fireEvent.press(screen.getByLabelText('保存其他记录'));
  await waitFor(() => expect(mockOtherRepository.create).toHaveBeenCalledTimes(1));
  await expect(oldOther.create({ eventTimeMs: 50, title: '旧服务迟到', note: null }, 'stale')).rejects.toThrow('资料已恢复');
  expect(mockOtherRepository.create).toHaveBeenCalledTimes(1);
});

function PendingPhotoFlow() {
  const app = useAppState();
  if (app.status !== 'ready') return <Text>{app.status}</Text>;
  return <PendingRecordsEntry />;
}

const draftPhotoUri = 'file:///review-fixture/documents/draft-attachments/photo.image';
const committedDiscardMessage = '这条草稿已经放弃，后续处理未完成；请重试重新载入当前资料。';
const currentInput = { eventTimeMs: 50, title: '当前记录', note: '待保存的完整备注，保留空格 和 emoji 🍼' };

async function preparePhotoDraft() {
  let id = 0;
  const drafts = createRecordDraftService(mockWorkflowStore, () => 1_000, () => `draft-${++id}`);
  const draft = await drafts.create({ babyId: 'baby', kind: 'poop' }, {
    eventTimeMs: 50, color: null, texture: null, amount: null, note: '照片旧草稿',
    photoChange: { kind: 'replace', source: { uri: draftPhotoUri, width: 1, height: 1 } },
    previewUri: draftPhotoUri,
  });
  return { drafts, draft };
}

async function openPendingPhoto() {
  const screen = await render(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  await fireEvent.press(await screen.findByText(/大便记录 · 旧草稿需核对/));
  return screen;
}

async function expectCurrentSaveAndStaleGuard(oldOther: NonNullable<ReturnType<typeof useAppState>['otherService']>) {
  await expect(mockCurrent.otherService!.create(currentInput, 'current')).resolves.toMatchObject(currentInput);
  expect(mockOtherRepository.create).toHaveBeenCalledTimes(1);
  expect(mockOtherRepository.create).toHaveBeenCalledWith(expect.objectContaining({ input: currentInput, clientRequestId: 'current' }));
  expect(mockSaved).toEqual(expect.objectContaining(currentInput));
  await expect(oldOther.create({ ...currentInput, title: '旧服务迟到' }, 'stale')).rejects.toThrow('资料已恢复');
  expect(mockOtherRepository.create).toHaveBeenCalledTimes(1);
}

test('R17: normal pending photo discard refreshes services and preserves the complete save payload', async () => {
  const { drafts } = await preparePhotoDraft();
  await drafts.beginRestore('interrupted');
  const screen = await openPendingPhoto(); const oldOther = mockCurrent.otherService!;
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
  expect(mockWorkflow.restore).toBeNull(); expect(mockWorkflow.drafts).toEqual({});
  expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  expect(mockDraftPhotoRemove).toHaveBeenCalledWith(draftPhotoUri);
  await expectCurrentSaveAndStaleGuard(oldOther);
});

test('R17: an in-flight photo discard retains its progress and prevents duplicate or conflicting actions', async () => {
  const { drafts } = await preparePhotoDraft();
  await drafts.beginRestore('interrupted');
  const screen = await openPendingPhoto(); const oldOther = mockCurrent.otherService!;
  let finishRemoval: () => void = () => undefined;
  mockDraftPhotoRemove.mockImplementationOnce(() => new Promise<void>((resolve) => { finishRemoval = resolve; }));
  const transaction = jest.spyOn(mockWorkflowStore, 'transaction');
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1));
  try {
    const discard = screen.getByRole('button', { name: '放弃这条旧草稿' });
    expect(discard.props.accessibilityState).toEqual(expect.objectContaining({ busy: true, disabled: true }));
    expect(screen.getByRole('button', { name: '作为新草稿恢复' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '暂时保留' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(discard);
    expect(transaction).toHaveBeenCalledTimes(1); expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
    expect(mockCurrent.otherService).toBe(oldOther); expect(mockOtherRepository.create).not.toHaveBeenCalled();
  } finally {
    await act(async () => { finishRemoval(); });
  }
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
  await expectCurrentSaveAndStaleGuard(oldOther);
});

test('R17: a committed discard with photo cleanup failure stays explicit and retry restores saving without repeating cleanup', async () => {
  const { drafts } = await preparePhotoDraft();
  await drafts.beginRestore('interrupted');
  const screen = await openPendingPhoto(); const oldOther = mockCurrent.otherService!;
  mockDraftPhotoRemove.mockRejectedValueOnce(new Error('synthetic transient file delete failure'));
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await screen.findByText('放弃失败，请重试');
  expect(mockWorkflow.restore).toBeNull(); expect(mockWorkflow.drafts).toEqual({});
  expect(mockWorkflow.generation).not.toBe('dataset');
  expect(mockCurrent.otherService).toBe(oldOther);
  expect(screen.getByText(committedDiscardMessage)).toBeTruthy();
  expect(screen.getByText(/照片旧草稿/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '作为新草稿恢复' }).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByRole('button', { name: '暂时保留' }).props.accessibilityState.disabled).toBe(true);
  expect(mockOtherRepository.create).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(screen.queryByText('放弃这条旧草稿')).toBeNull());
  expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  await expectCurrentSaveAndStaleGuard(oldOther);
});

test('R17: repeated pre-commit transaction failures keep the original draft and permit a later retry', async () => {
  const { drafts } = await preparePhotoDraft();
  await drafts.beginRestore('interrupted'); const before = structuredClone(mockWorkflow);
  const screen = await openPendingPhoto(); const oldOther = mockCurrent.otherService!;
  const transaction = jest.spyOn(mockWorkflowStore, 'transaction')
    .mockRejectedValueOnce(new Error('synthetic disk unavailable'))
    .mockRejectedValueOnce(new Error('synthetic disk still unavailable'));
  for (let attempt = 1; attempt <= 2; attempt++) {
    await fireEvent.press(screen.getByText('放弃这条旧草稿'));
    await waitFor(() => expect(transaction).toHaveBeenCalledTimes(attempt));
    await screen.findByText('放弃失败，请重试');
    expect(mockWorkflow).toEqual(before); expect(mockCurrent.otherService).toBe(oldOther);
    expect(screen.getByText(/照片旧草稿/)).toBeTruthy();
    expect(screen.queryByText(committedDiscardMessage)).toBeNull();
    expect(mockDraftPhotoRemove).not.toHaveBeenCalled(); expect(mockOtherRepository.create).not.toHaveBeenCalled();
  }
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
  expect(mockWorkflow.restore).toBeNull(); expect(mockWorkflow.drafts).toEqual({});
  expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  await expectCurrentSaveAndStaleGuard(oldOther);
});

test('R17: a failed post-commit retry retains reload intent and input until a subsequent retry succeeds', async () => {
  const { drafts } = await preparePhotoDraft();
  await drafts.beginRestore('interrupted');
  const screen = await openPendingPhoto(); const oldOther = mockCurrent.otherService!;
  mockDraftPhotoRemove.mockRejectedValueOnce(new Error('synthetic file delete failure'));
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await screen.findByText('放弃失败，请重试'); const committed = structuredClone(mockWorkflow);
  const transaction = jest.spyOn(mockWorkflowStore, 'transaction').mockRejectedValueOnce(new Error('synthetic retry transaction failure'));
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(transaction).toHaveBeenCalledTimes(1));
  await screen.findByText('放弃失败，请重试');
  expect(mockWorkflow).toEqual(committed); expect(mockCurrent.otherService).toBe(oldOther);
  expect(screen.getByText(committedDiscardMessage)).toBeTruthy(); expect(screen.getByText(/照片旧草稿/)).toBeTruthy();
  expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  const unsavedInput = structuredClone(currentInput);
  await expect(oldOther.create(unsavedInput, 'current')).rejects.toThrow('资料已恢复');
  expect(unsavedInput).toEqual(currentInput); expect(mockOtherRepository.create).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
  expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1); expect(mockWorkflow).toEqual(committed);
  await expectCurrentSaveAndStaleGuard(oldOther);
});

test('R17: retry of a nonfinal photo discard preserves other quarantined contents and keeps saving guarded', async () => {
  const { drafts } = await preparePhotoDraft();
  const other = await drafts.create({ babyId: 'baby', kind: 'other' }, { eventTimeMs: 60, title: '仍待核对', note: '其它草稿的完整内容' });
  await drafts.beginRestore('interrupted'); const otherBefore = structuredClone(mockWorkflow.drafts[other.key]);
  const screen = await openPendingPhoto(); const oldOther = mockCurrent.otherService!;
  mockDraftPhotoRemove.mockRejectedValueOnce(new Error('synthetic file delete failure'));
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await screen.findByText('放弃失败，请重试');
  expect(mockWorkflow.drafts[other.key]).toEqual(otherBefore); expect(mockWorkflow.generation).toBe('dataset');
  expect(mockWorkflow.restore).toEqual({ id: 'interrupted', previousGeneration: 'dataset' });
  expect(screen.getByRole('button', { name: /其他记录 · 旧草稿需核对/ }).props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
  expect(mockWorkflow.drafts[other.key]).toEqual(otherBefore); expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  await expect(mockCurrent.otherService!.create(currentInput, 'current')).rejects.toThrow('资料已恢复');
  expect(mockOtherRepository.create).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByText(/其他记录 · 旧草稿需核对/));
  const quarantinedOther = mockCurrent.otherService!;
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(quarantinedOther));
  expect(mockWorkflow.restore).toBeNull(); expect(mockWorkflow.drafts).toEqual({});
  expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  await expectCurrentSaveAndStaleGuard(oldOther);
});

test('R17: a read failure during reload after retry remains guarded and the existing initialization retry restores saving', async () => {
  const { drafts } = await preparePhotoDraft();
  await drafts.beginRestore('interrupted');
  const screen = await openPendingPhoto(); const oldOther = mockCurrent.otherService!;
  mockDraftPhotoRemove.mockRejectedValueOnce(new Error('synthetic file delete failure'));
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await screen.findByText('放弃失败，请重试'); const committed = structuredClone(mockWorkflow);
  // Fault only the newly initialized Provider's first read, not the old entry's subscription read.
  mockGetWorkflowStore.mockResolvedValueOnce({ ...mockWorkflowStore,
    read: jest.fn(mockWorkflowStore.read).mockRejectedValueOnce(new Error('synthetic SQLite initialization read failure')),
  });
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.draftError).toBe('本机草稿暂不可用，原资料已保留，请重试'));
  expect(mockWorkflow).toEqual(committed); expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  await expect(mockCurrent.otherService!.create(currentInput, 'current')).rejects.toThrow('草稿状态暂不可用');
  expect(mockOtherRepository.create).not.toHaveBeenCalled();
  await screen.rerender(<AppStateProvider><Probe form /></AppStateProvider>);
  await fireEvent.press(await screen.findByText('重试'));
  await screen.findByLabelText('标题'); await waitFor(() => expect(mockCurrent.status).toBe('ready'));
  expect(mockCurrent.draftError).toBeNull(); expect(mockWorkflow).toEqual(committed);
  await expectCurrentSaveAndStaleGuard(oldOther);
});

async function failPendingPhotoRemoval(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(await screen.findByText(/大便记录 · 旧草稿需核对/));
  const oldOther = mockCurrent.otherService!;
  mockDraftPhotoRemove.mockRejectedValueOnce(new Error('synthetic file delete failure'));
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await screen.findByText('放弃失败，请重试');
  expect(mockOtherRepository.create).not.toHaveBeenCalled();
  return oldOther;
}

test('R19: the actual home midnight reload unmounts the entry and remounts its committed-discard retry', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 9, 5, 23, 59));
  try {
    const { drafts } = await preparePhotoDraft(); await drafts.beginRestore('interrupted');
    const screen = await render(<AppStateProvider><Probe /><TodayScreen /></AppStateProvider>);
    const oldOther = await failPendingPhotoRemoval(screen); const committed = structuredClone(mockWorkflow);
    expect(mockPendingMounts).toBe(1); expect(mockPendingUnmounts).toBe(0);
    let finishDashboard: (value: Awaited<ReturnType<typeof mockFeedingDashboard>>) => void = () => undefined;
    mockFeedingDashboard.mockImplementationOnce(() => new Promise((resolve) => { finishDashboard = resolve; }));
    await act(async () => { jest.advanceTimersByTime(60_000); });
    await screen.findByText('正在读取今天的记录');
    expect(mockFeedingDashboard).toHaveBeenLastCalledWith('2026-10-06');
    expect(mockPendingUnmounts).toBe(1); expect(screen.queryByText('放弃失败，请重试')).toBeNull();
    await act(async () => { finishDashboard({ latest: null, timeline: [], summary: { feedingCount: 0, formulaTotalMl: 0, breastMilkTotalMl: 0, measurableTotalMl: 0 }, refreshedAtMs: 1 }); });
    await screen.findByText('今天还没有记录');
    await screen.findByText(committedDiscardMessage);
    expect(mockPendingMounts).toBe(2); expect(mockWorkflow).toEqual(committed);
    expect(mockCurrent.otherService).toBe(oldOther);
    await fireEvent.press(screen.getByText('放弃这条旧草稿'));
    await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
    expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
    await expectCurrentSaveAndStaleGuard(oldOther);
    await screen.unmount();
  } finally { jest.useRealTimers(); }
});

test('R19: foreground date reload can fail truthfully and later remount the retained discard retry', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date(2026, 9, 5, 23, 59));
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener as (state: string) => void); return { remove: jest.fn() };
  });
  try {
    const { drafts } = await preparePhotoDraft(); await drafts.beginRestore('interrupted');
    const screen = await render(<AppStateProvider><Probe /><TodayScreen /></AppStateProvider>);
    const oldOther = await failPendingPhotoRemoval(screen); const committed = structuredClone(mockWorkflow);
    mockFeedingDashboard.mockRejectedValueOnce(new Error('synthetic dashboard read failure'));
    jest.setSystemTime(new Date(2026, 9, 6, 0, 5));
    await act(async () => { listeners.forEach((listener) => listener('active')); });
    await screen.findByText('今日记录加载失败，请重试。');
    expect(mockPendingUnmounts).toBe(1); expect(mockPendingMounts).toBe(1);
    expect(mockWorkflow).toEqual(committed); expect(mockCurrent.otherService).toBe(oldOther);
    await fireEvent.press(screen.getByText('重新加载'));
    await screen.findByText(committedDiscardMessage); expect(mockPendingMounts).toBe(2);
    await fireEvent.press(screen.getByText('放弃这条旧草稿'));
    await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
    expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
    await expectCurrentSaveAndStaleGuard(oldOther);
    await screen.unmount();
  } finally { jest.useRealTimers(); }
});

test('R19: repeated retry failure across real unmounts retains the discarded snapshot without restoring its contents', async () => {
  const { drafts } = await preparePhotoDraft(); await drafts.beginRestore('interrupted');
  const screen = await render(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  const oldOther = await failPendingPhotoRemoval(screen); const committed = structuredClone(mockWorkflow);
  for (let attempt = 0; attempt < 2; attempt++) {
    await screen.rerender(<AppStateProvider><Probe /></AppStateProvider>);
    expect(mockPendingUnmounts).toBe(attempt + 1);
    await screen.rerender(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
    await screen.findByText(committedDiscardMessage);
    expect(mockPendingMounts).toBe(attempt + 2);
    jest.spyOn(mockWorkflowStore, 'transaction').mockRejectedValueOnce(new Error(`synthetic retry failure ${attempt}`));
    await fireEvent.press(screen.getByText('放弃这条旧草稿'));
    await screen.findByText('放弃失败，请重试');
    expect(screen.getByText(/照片旧草稿/)).toBeTruthy();
    expect(mockWorkflow).toEqual(committed); expect(mockCurrent.otherService).toBe(oldOther);
    expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1); expect(mockOtherRepository.create).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '作为新草稿恢复' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '暂时保留' }).props.accessibilityState.disabled).toBe(true);
  }
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
  await expectCurrentSaveAndStaleGuard(oldOther);
  expect(mockWorkflow.drafts).toEqual({}); expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  await screen.rerender(<AppStateProvider><Probe /></AppStateProvider>);
  await screen.rerender(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  await waitFor(() => expect(screen.queryByText(committedDiscardMessage)).toBeNull());
  expect(screen.queryByText('放弃这条旧草稿')).toBeNull(); expect(screen.queryByText(/照片旧草稿/)).toBeNull();
  expect(mockOtherRepository.create).toHaveBeenCalledTimes(1); expect(mockSaved).toEqual(expect.objectContaining(currentInput));
});

test('R19: an in-flight photo discard stays locked after unmount and its new instance receives the eventual error', async () => {
  const { drafts } = await preparePhotoDraft(); await drafts.beginRestore('interrupted');
  const screen = await openPendingPhoto(); const oldOther = mockCurrent.otherService!;
  let failRemoval: (error: Error) => void = () => undefined;
  mockDraftPhotoRemove.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failRemoval = reject; }));
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1));
  const committed = structuredClone(mockWorkflow);
  await screen.rerender(<AppStateProvider><Probe /></AppStateProvider>);
  expect(mockPendingUnmounts).toBe(1);
  await screen.rerender(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  await screen.findByText('放弃这条旧草稿'); expect(mockPendingMounts).toBe(2);
  const retry = screen.getByRole('button', { name: '放弃这条旧草稿' });
  expect(retry.props.accessibilityState).toEqual(expect.objectContaining({ busy: true, disabled: true }));
  expect(screen.getByRole('button', { name: '暂时保留' }).props.accessibilityState.disabled).toBe(true);
  const transaction = jest.spyOn(mockWorkflowStore, 'transaction');
  await fireEvent.press(retry);
  expect(transaction).not.toHaveBeenCalled(); expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  await act(async () => { failRemoval(new Error('synthetic delayed delete failure')); });
  await screen.findByText('放弃失败，请重试'); await screen.findByText(committedDiscardMessage);
  expect(screen.getByRole('button', { name: '放弃这条旧草稿' }).props.accessibilityState.disabled).toBe(false);
  expect(mockWorkflow).toEqual(committed); expect(mockCurrent.otherService).toBe(oldOther);
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
  expect(transaction).toHaveBeenCalledTimes(1); expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  await expectCurrentSaveAndStaleGuard(oldOther);
});

test('R19: remounted nonfinal photo discard protects another draft and the valid photo it references', async () => {
  const { drafts } = await preparePhotoDraft();
  const validPhotoUri = 'file:///review-fixture/documents/poop-photos/valid-photo.jpg';
  const formalPhotoRecord = { id: 'formal-photo-record', photoUri: validPhotoUri, updatedAtMs: 1 };
  const other = await drafts.create({ babyId: 'baby', kind: 'poop', recordId: formalPhotoRecord.id }, {
    eventTimeMs: 60, color: null, texture: null, amount: null, note: '另一个有效照片及完整备注',
    photoChange: { kind: 'keep' }, previewUri: validPhotoUri,
  }, formalPhotoRecord);
  await drafts.beginRestore('interrupted'); const otherBefore = structuredClone(mockWorkflow.drafts[other.key]);
  const screen = await render(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  const oldOther = await failPendingPhotoRemoval(screen);
  await screen.rerender(<AppStateProvider><Probe /></AppStateProvider>);
  await screen.rerender(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  await screen.findByText(committedDiscardMessage);
  expect(screen.getByRole('button', { name: /大便修改 · 旧草稿需核对/ }).props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
  expect(mockWorkflow.drafts[other.key]).toEqual(otherBefore); expect(mockWorkflow.restore).not.toBeNull();
  expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1); expect(mockDraftPhotoRemove).not.toHaveBeenCalledWith(validPhotoUri);
  await expect(mockCurrent.otherService!.create(currentInput, 'blocked')).rejects.toThrow('资料已恢复');
  expect(mockOtherRepository.create).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByText(/大便修改 · 旧草稿需核对/));
  expect(screen.getByText(/另一个有效照片及完整备注/)).toBeTruthy();
  expect(screen.queryByText('放弃失败，请重试')).toBeNull(); expect(screen.queryByText(committedDiscardMessage)).toBeNull();
  const currentOther = mockCurrent.otherService!;
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(currentOther));
  expect(mockWorkflow.restore).toBeNull(); expect(mockWorkflow.drafts).toEqual({});
  expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1); expect(mockDraftPhotoRemove).not.toHaveBeenCalledWith(validPhotoUri);
  expect(formalPhotoRecord).toEqual({ id: 'formal-photo-record', photoUri: validPhotoUri, updatedAtMs: 1 });
  await expectCurrentSaveAndStaleGuard(oldOther);
});

test('R19: a pre-commit failure may be temporarily retained and does not leak selection or error into another draft', async () => {
  const { drafts, draft } = await preparePhotoDraft();
  const other = await drafts.create({ babyId: 'baby', kind: 'other' }, { eventTimeMs: 60, title: '另一条待核对', note: '另一条备注' });
  await drafts.beginRestore('interrupted'); const before = structuredClone(mockWorkflow);
  const screen = await openPendingPhoto();
  jest.spyOn(mockWorkflowStore, 'transaction').mockRejectedValueOnce(new Error('synthetic transaction failure before commit'));
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await screen.findByText('放弃失败，请重试'); expect(mockWorkflow).toEqual(before);
  await fireEvent.press(screen.getByText('暂时保留'));
  await screen.rerender(<AppStateProvider><Probe /></AppStateProvider>);
  await screen.rerender(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  await fireEvent.press(await screen.findByText(/其他记录 · 旧草稿需核对/));
  expect(screen.queryByText('放弃失败，请重试')).toBeNull(); expect(screen.queryByText(/照片旧草稿/)).toBeNull();
  expect(screen.getByText(/另一条备注/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '作为新草稿恢复' }).props.accessibilityState.disabled).toBe(false);
  expect(mockWorkflow.drafts[draft.key]).toEqual(before.drafts[draft.key]);
  expect(mockWorkflow.drafts[other.key]).toEqual(before.drafts[other.key]);
  expect(mockDraftPhotoRemove).not.toHaveBeenCalled(); expect(mockOtherRepository.create).not.toHaveBeenCalled();
});

test('R19: a successful recovered retry clears the session for other records and later Provider initialization', async () => {
  const { drafts } = await preparePhotoDraft(); await drafts.beginRestore('interrupted');
  const screen = await render(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  const oldOther = await failPendingPhotoRemoval(screen);
  await screen.rerender(<AppStateProvider><Probe /></AppStateProvider>);
  await screen.rerender(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  await screen.findByText(committedDiscardMessage);
  await fireEvent.press(screen.getByText('放弃这条旧草稿'));
  await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
  const other = await mockCurrent.draftService!.create({ babyId: 'baby', kind: 'other' }, { eventTimeMs: 60, title: '独立新草稿', note: '新的完整内容' });
  const independent = structuredClone(mockWorkflow.drafts[other.key]);
  await screen.rerender(<AppStateProvider><Probe /></AppStateProvider>);
  await screen.rerender(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  await screen.findByText(/其他记录 ·/);
  expect(screen.queryByText('放弃失败，请重试')).toBeNull(); expect(screen.queryByText(committedDiscardMessage)).toBeNull();
  expect(screen.queryByText('放弃这条旧草稿')).toBeNull(); expect(mockWorkflow.drafts[other.key]).toEqual(independent);
  expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
  await screen.unmount();
  const reopened = await render(<AppStateProvider><Probe /><PendingPhotoFlow /></AppStateProvider>);
  await reopened.findByText(/其他记录 ·/);
  expect(reopened.queryByText(committedDiscardMessage)).toBeNull(); expect(reopened.queryByText(/照片旧草稿/)).toBeNull();
  expect(mockWorkflow.drafts[other.key]).toEqual(independent); expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
});

test('R19: normal form exit still persists input and explicit abandonment does not revive it after remount', async () => {
  const screen = await render(<AppStateProvider><Probe form /></AppStateProvider>);
  await fireEvent.changeText(await screen.findByLabelText('标题'), '用户暂存的标题');
  await fireEvent.changeText(screen.getByLabelText('备注'), currentInput.note);
  await screen.rerender(<AppStateProvider><Probe /></AppStateProvider>);
  await waitFor(() => expect(Object.values(mockWorkflow.drafts)[0]?.values).toEqual(expect.objectContaining({ title: '用户暂存的标题', note: currentInput.note })));
  await screen.rerender(<AppStateProvider><Probe form /></AppStateProvider>);
  await screen.findByText('有一条未完成的其他记录');
  await fireEvent.press(screen.getByText('继续填写'));
  await waitFor(() => expect(screen.getByLabelText('标题').props.value).toBe('用户暂存的标题'));
  expect(screen.getByLabelText('备注').props.value).toBe(currentInput.note);
  const transaction = jest.spyOn(mockWorkflowStore, 'transaction').mockRejectedValueOnce(new Error('synthetic draft write failure'));
  await fireEvent.changeText(screen.getByLabelText('标题'), '用户明确放弃的标题');
  await fireEvent(screen.getByLabelText('标题'), 'blur');
  await screen.findByText('草稿暂未保存，请重试；当前输入仍保留');
  expect(transaction).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText('放弃本次内容'));
  await waitFor(() => expect(mockWorkflow.drafts).toEqual({}));
  await screen.rerender(<AppStateProvider><Probe /></AppStateProvider>);
  await screen.rerender(<AppStateProvider><Probe form /></AppStateProvider>);
  await screen.findByLabelText('标题');
  expect(screen.getByLabelText('标题').props.value).toBe(''); expect(screen.getByLabelText('备注').props.value).toBe('');
  expect(screen.queryByText('有一条未完成的其他记录')).toBeNull();
  expect(mockOtherRepository.create).not.toHaveBeenCalled(); expect(mockDraftPhotoRemove).not.toHaveBeenCalled();
});

test('R19: actual Expo Router tab navigation returns through a remounted entry and saves through the actual new-record route', async () => {
  mockRealRouter = true;
  const { Stack, router, usePathname } = mockActualRouter;
  const { renderRouter } = mockRouterTesting;
  function ReadyRoutes() {
    const app = useAppState(); const pathname = usePathname();
    if (app.status !== 'ready') return <Text>{app.status}</Text>;
    return <><Text accessibilityLabel="active-route">{pathname}</Text><Stack screenOptions={{ headerShown: false }} /></>;
  }
  function RouteLayout() { return <AppStateProvider><Probe /><ReadyRoutes /></AppStateProvider>; }
  const { drafts } = await preparePhotoDraft(); await drafts.beginRestore('interrupted');
  try {
    // Router 57 attaches helpers synchronously; RNTL 14's asynchronous render is awaited here.
    const screen = await renderRouter({
      _layout: RouteLayout, '(tabs)/_layout': mockActualTabsLayout, '(tabs)/today': mockActualTodayRoute,
      '(tabs)/records': () => <Text>隔离记录页</Text>, '(tabs)/settings': () => <Text>隔离设置页</Text>,
      'other/new': mockActualNewOtherRoute,
    }, { initialUrl: '/today' });
    const oldOther = await failPendingPhotoRemoval(screen);
    expect(screen.getByLabelText('active-route').props.children).toBe('/today');
    await act(async () => { router.navigate('/records'); });
    await screen.findByText('隔离记录页');
    expect(screen.getByLabelText('active-route').props.children).toBe('/records');
    let finishDashboard: (value: Awaited<ReturnType<typeof mockFeedingDashboard>>) => void = () => undefined;
    mockFeedingDashboard.mockImplementationOnce(() => new Promise((resolve) => { finishDashboard = resolve; }));
    await act(async () => { router.navigate('/today'); });
    await screen.findByText('正在读取今天的记录');
    expect(screen.getByLabelText('active-route').props.children).toBe('/today');
    expect(mockPendingUnmounts).toBe(1);
    await act(async () => { finishDashboard({ latest: null, timeline: [], summary: { feedingCount: 0, formulaTotalMl: 0, breastMilkTotalMl: 0, measurableTotalMl: 0 }, refreshedAtMs: 1 }); });
    await screen.findByText(committedDiscardMessage); expect(mockPendingMounts).toBe(2);
    await fireEvent.press(screen.getByText('放弃这条旧草稿'));
    await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
    await screen.findByText('今天还没有记录');
    await fireEvent.press(screen.getByLabelText('记录其他事件'));
    await screen.findByLabelText('标题');
    expect(screen.getByLabelText('active-route').props.children).toBe('/other/new');
    await fireEvent.changeText(screen.getByLabelText('标题'), currentInput.title);
    await fireEvent.changeText(screen.getByLabelText('备注'), currentInput.note);
    await fireEvent.press(screen.getByLabelText('保存其他记录'));
    await waitFor(() => expect(mockOtherRepository.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('active-route').props.children).toBe('/today'));
    expect(mockSaved).toEqual(expect.objectContaining({ title: currentInput.title, note: currentInput.note }));
    expect(mockWorkflow.restore).toBeNull(); expect(mockWorkflow.drafts).toEqual({});
    expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
    await expect(oldOther.create(currentInput, 'stale')).rejects.toThrow('资料已恢复');
    await screen.unmount();
  } finally { mockRealRouter = false; jest.useRealTimers(); }
});

test('R19: actual route entry before recovery preserves failed-save input through home retry failure and eventual save', async () => {
  mockRealRouter = true;
  const { Stack, router, usePathname } = mockActualRouter;
  const { renderRouter } = mockRouterTesting;
  function ReadyRoutes() {
    const app = useAppState(); const pathname = usePathname();
    if (app.status !== 'ready') return <Text>{app.status}</Text>;
    return <><Text accessibilityLabel="active-route">{pathname}</Text><Stack screenOptions={{ headerShown: false }} /></>;
  }
  function RouteLayout() { return <AppStateProvider><Probe /><ReadyRoutes /></AppStateProvider>; }
  const { drafts, draft: discardedPhoto } = await preparePhotoDraft(); await drafts.beginRestore('interrupted');
  try {
    const screen = await renderRouter({
      _layout: RouteLayout, '(tabs)/_layout': mockActualTabsLayout, '(tabs)/today': mockActualTodayRoute,
      '(tabs)/records': () => <Text>隔离记录页</Text>, '(tabs)/settings': () => <Text>隔离设置页</Text>,
      'other/new': mockActualNewOtherRoute,
    }, { initialUrl: '/today' });
    const oldOther = await failPendingPhotoRemoval(screen);
    await fireEvent.press(screen.getByLabelText('记录其他事件'));
    await screen.findByLabelText('标题');
    expect(screen.getByLabelText('active-route').props.children).toBe('/other/new');
    await fireEvent.changeText(screen.getByLabelText('标题'), currentInput.title);
    await fireEvent.changeText(screen.getByLabelText('备注'), currentInput.note);
    await fireEvent.press(screen.getByLabelText('保存其他记录'));
    await screen.findByText('资料已恢复，请重新打开记录页');
    expect(mockOtherRepository.create).not.toHaveBeenCalled(); expect(mockSaved).toBeNull();
    expect(screen.getByLabelText('标题').props.value).toBe(currentInput.title);
    expect(screen.getByLabelText('备注').props.value).toBe(currentInput.note);
    expect(mockCurrent.otherService).toBe(oldOther);
    const usefulDraft = Object.values(mockWorkflow.drafts).find((draft) => draft.kind === 'other')!;
    expect(usefulDraft).toEqual(expect.objectContaining({ status: 'editing', values: expect.objectContaining({ title: currentInput.title, note: currentInput.note }) }));
    const retained = structuredClone(usefulDraft);
    await act(async () => { router.back(); });
    await screen.findByText(committedDiscardMessage);
    expect(screen.getByLabelText('active-route').props.children).toBe('/today');
    expect(mockPendingUnmounts).toBeGreaterThanOrEqual(1); expect(mockPendingMounts).toBeGreaterThanOrEqual(2);
    expect(mockWorkflow.drafts[usefulDraft.key]).toEqual(retained);
    expect(mockWorkflow.drafts[discardedPhoto.key]).toBeUndefined();
    const transaction = jest.spyOn(mockWorkflowStore, 'transaction').mockRejectedValueOnce(new Error('synthetic home retry transaction failure'));
    await fireEvent.press(screen.getByText('放弃这条旧草稿'));
    await screen.findByText('放弃失败，请重试');
    expect(transaction).toHaveBeenCalledTimes(1); expect(mockWorkflow.drafts[usefulDraft.key]).toEqual(retained);
    expect(mockWorkflow.drafts[discardedPhoto.key]).toBeUndefined();
    expect(screen.getByText(/照片旧草稿/)).toBeTruthy(); expect(mockCurrent.otherService).toBe(oldOther);
    expect(mockOtherRepository.create).not.toHaveBeenCalled(); expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('放弃这条旧草稿'));
    await waitFor(() => expect(mockCurrent.otherService).not.toBe(oldOther));
    await screen.findByText('今天还没有记录');
    expect(mockWorkflow.drafts[usefulDraft.key]).toEqual(retained); expect(mockWorkflow.drafts[discardedPhoto.key]).toBeUndefined();
    expect(screen.queryByText(committedDiscardMessage)).toBeNull();
    await fireEvent.press(screen.getByLabelText('记录其他事件'));
    await screen.findByText('有一条未完成的其他记录');
    await fireEvent.press(screen.getByText('继续填写'));
    await waitFor(() => expect(screen.getByLabelText('标题').props.value).toBe(currentInput.title));
    expect(screen.getByLabelText('备注').props.value).toBe(currentInput.note);
    await fireEvent.press(screen.getByLabelText('保存其他记录'));
    await waitFor(() => expect(mockOtherRepository.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('active-route').props.children).toBe('/today'));
    expect(mockOtherRepository.create).toHaveBeenCalledWith(expect.objectContaining({ clientRequestId: retained.clientRequestId,
      input: { eventTimeMs: retained.values.eventTimeMs, title: currentInput.title, note: currentInput.note } }));
    expect(mockSaved).toEqual(expect.objectContaining({ title: currentInput.title, note: currentInput.note }));
    expect(mockWorkflow.restore).toBeNull(); expect(mockWorkflow.drafts).toEqual({});
    expect(mockDraftPhotoRemove).toHaveBeenCalledTimes(1); expect(screen.queryByText(committedDiscardMessage)).toBeNull();
    await expect(oldOther.create(currentInput, 'stale')).rejects.toThrow('资料已恢复');
    expect(mockOtherRepository.create).toHaveBeenCalledTimes(1);
    await screen.unmount();
  } finally { mockRealRouter = false; jest.useRealTimers(); }
});
