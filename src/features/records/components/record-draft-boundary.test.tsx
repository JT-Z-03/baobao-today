import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { RecordDraftBoundary } from './record-draft-boundary';
import { OtherForm } from '@/features/other/components/other-form';
import { FeedingForm } from '@/features/feeding/components/feeding-form';
import { PoopForm } from '@/features/poop/components/poop-form';
import * as ImagePicker from 'expo-image-picker';
import { discardDeletedDraft } from '../discard-deleted-draft';
import { createRecordDraftService } from '@/application/drafts/record-draft-service';
import { emptyWorkflowState, type WorkflowStateStore } from '@/application/ports/workflow-state';

const mockBack = jest.fn(); const mockDispatch = jest.fn();
const mockPersist = jest.fn(); const mockRemove = jest.fn(async () => undefined);
let mockApp: Record<string, unknown> = {};
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, replace: jest.fn() }) }));
jest.mock('expo-router/react-navigation', () => ({ useNavigation: () => ({ dispatch: mockDispatch }), usePreventRemove: jest.fn() }));
jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: () => mockApp }));
jest.mock('./record-save-feedback', () => ({ showRecordSaved: jest.fn() }));
jest.mock('@/data/workflow/expo-draft-attachment-store', () => ({ ExpoDraftAttachmentStore: class {
  persist = mockPersist; remove = mockRemove;
} }));
jest.mock('expo-image-picker', () => ({
  getPendingResultAsync: jest.fn(async () => null), requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(),
}));

function setup() {
  let state = emptyWorkflowState('dataset'); let id = 0; let saved: unknown = null;
  const store: WorkflowStateStore = { read: async () => structuredClone(state), transaction: async (update) => {
    const next = structuredClone(state); const result = update(next); state = next; return result;
  } };
  const drafts = createRecordDraftService(store, Date.now, () => `id-${++id}`);
  mockApp = { babyProfile: { id: 'baby' }, draftService: drafts,
    otherService: { getById: async () => saved, getByClientRequestId: async () => saved } };
  const onSave = jest.fn(async (input, requestId) => { saved = { ...input, id: 'saved', updatedAtMs: 1000, clientRequestId: requestId }; });
  const form = () => <RecordDraftBoundary kind="other"><OtherForm initialInput={{ eventTimeMs: 50, title: '', note: null }} clientRequestId="unused" onSave={onSave} /></RecordDraftBoundary>;
  return { drafts, form, onSave };
}
beforeEach(() => jest.clearAllMocks());

test('leaving and reopening keeps raw content and saves with the original durable request', async () => {
  const { drafts, form, onSave } = setup();
  const first = await render(form());
  await fireEvent.changeText(await first.findByLabelText('标题'), '洗澡');
  await fireEvent.changeText(first.getByLabelText('备注'), '妈妈暂时去抱宝宝');
  await act(async () => { await first.unmount(); });
  await waitFor(async () => expect((await drafts.list()).drafts).toHaveLength(1));
  const original = (await drafts.list()).drafts[0];
  const second = await render(form());
  await fireEvent.press(await second.findByText('继续填写'));
  expect((await second.findByLabelText('备注')).props.value).toBe('妈妈暂时去抱宝宝');
  await fireEvent.press(second.getByLabelText('保存其他记录'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ eventTimeMs: 50, title: '洗澡', note: '妈妈暂时去抱宝宝' }, original.clientRequestId));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect((await drafts.list()).drafts).toEqual([]);
});

test('timer response preserves a note entered while its transaction is in flight and mixed retains breast controls', async () => {
  const { drafts, onSave } = setup(); mockApp.feedingService = mockApp.otherService;
  const action = drafts.timerAction;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const delayed = jest.spyOn(drafts, 'timerAction').mockImplementationOnce(async (...args) => {
    const result = await action(...args); await gate; return result;
  });
  const screen = await render(<RecordDraftBoundary kind="feeding"><FeedingForm clientRequestId="unused" onSave={onSave}
    initialInput={{ eventTimeMs: Date.now(), feedingType: 'breast', milkAmountMl: null, breastMilkAmountMl: null, leftDurationMin: null, rightDurationMin: null, note: null }} /></RecordDraftBoundary>);
  await fireEvent.press(await screen.findByText('开始左侧'));
  await waitFor(() => expect(delayed).toHaveBeenCalledTimes(1));
  await fireEvent.changeText(screen.getByLabelText('备注'), '等待中补充的新备注');
  await act(async () => { release(); });
  await screen.findByText('左侧计时中');
  expect(screen.getByLabelText('备注').props.value).toBe('等待中补充的新备注');
  await fireEvent.press(screen.getByLabelText('选择混合'));
  expect(screen.getByText('结束计时')).toBeTruthy();
  expect(screen.getByText('左侧计时中')).toBeTruthy();
  await waitFor(async () => expect((await drafts.list()).drafts[0].values.note).toBe('等待中补充的新备注'));
});

test('failed photo copy can be abandoned without losing the note or preventing a photo-free save', async () => {
  const { onSave } = setup(); mockApp.poopService = mockApp.otherService;
  mockPersist.mockRejectedValueOnce(new Error('source expired'));
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://temporary', width: 10, height: 10, mimeType: 'image/jpeg' }] });
  const screen = await render(<RecordDraftBoundary kind="poop"><PoopForm clientRequestId="unused" onSave={onSave}
    initialInput={{ eventTimeMs: Date.now(), color: null, texture: null, amount: null, note: null }} initialPhotoPreviewUri={null} /></RecordDraftBoundary>);
  await fireEvent.changeText(await screen.findByLabelText('备注'), '需要保留的观察');
  await fireEvent.press(screen.getByLabelText('从相册选择'));
  await fireEvent.press(await screen.findByText('放弃这次照片，继续填写'));
  await fireEvent.press(screen.getByLabelText('保存大便记录'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ note: '需要保留的观察' }), { kind: 'keep' }, expect.any(String)));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
});

test('delete first flushes unsaved edits so final cleanup cannot leave a resurrected draft', async () => {
  const { drafts, onSave } = setup();
  const remove = jest.fn(async () => discardDeletedDraft(drafts, 'baby', 'other', 'existing'));
  const screen = await render(<RecordDraftBoundary kind="other" recordId="existing"><OtherForm clientRequestId={null} onSave={onSave}
    initialInput={{ eventTimeMs: 50, title: '旧记录', note: null }} onDelete={() => { void remove(); }} /></RecordDraftBoundary>);
  await fireEvent.changeText(await screen.findByLabelText('备注'), '立刻删除前刚填');
  await fireEvent.press(screen.getByLabelText('删除其他记录'));
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  await waitFor(async () => expect((await drafts.list()).drafts).toEqual([]));
  await act(async () => { await screen.unmount(); });
  expect((await drafts.list()).drafts).toEqual([]);
});

test('discarding a resumed draft remounts empty fields and never resurrects its content', async () => {
  const { drafts, form } = setup();
  await drafts.create({ babyId: 'baby', kind: 'other' }, { eventTimeMs: 50, title: '旧内容', note: '旧备注' });
  const screen = await render(form());
  await fireEvent.press(await screen.findByText('放弃草稿'));
  expect((await screen.findByLabelText('标题')).props.value).toBe('');
  await act(async () => { await screen.unmount(); });
  expect((await drafts.list()).drafts).toEqual([]);
});

test('formal save failure retains inputs and the draft for another attempt', async () => {
  const { drafts, form, onSave } = setup(); onSave.mockRejectedValueOnce(new Error('disk'));
  const screen = await render(form());
  await fireEvent.changeText(await screen.findByLabelText('标题'), '打嗝');
  await fireEvent.press(screen.getByLabelText('保存其他记录'));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  await waitFor(async () => expect((await drafts.list()).drafts[0].status).toBe('editing'));
  expect(screen.getByLabelText('标题').props.value).toBe('打嗝');
  expect(mockBack).not.toHaveBeenCalled();
});
