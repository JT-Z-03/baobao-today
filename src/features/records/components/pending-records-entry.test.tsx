import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useAppState } from '@/application/app-state/app-state-provider';
import { PendingRecordsEntry } from './pending-records-entry';

jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

test('a failed draft list read has a direct retry and disappears after successful empty refresh', async () => {
  const list = jest.fn().mockRejectedValueOnce(new Error('read')).mockResolvedValue({ drafts: [], quarantined: false, generation: 'g' });
  jest.mocked(useAppState).mockReturnValue({ draftService: { list, subscribe: () => () => undefined } } as never);
  const view = await render(<PendingRecordsEntry />);
  await waitFor(() => expect(view.getByText('未完成记录暂时无法读取，请重试')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('重试读取未完成记录'));
  await waitFor(() => expect(view.queryByText('未完成记录暂时无法读取，请重试')).toBeNull());
  expect(view.queryByText('继续未完成记录')).toBeNull();
  expect(list).toHaveBeenCalledTimes(2);
});

test('a successful background list refresh does not hide an unrelated record lookup error', async () => {
  let refresh!: () => void;
  const draft = { id: 'd', babyId: 'b', kind: 'other', recordId: 'old', generation: 'g', updatedAtMs: 1 };
  const list = jest.fn().mockResolvedValue({ drafts: [draft], quarantined: false, generation: 'g' });
  jest.mocked(useAppState).mockReturnValue({ babyProfile: { id: 'b' },
    draftService: { list, subscribe: (listener: () => void) => { refresh = listener; return () => undefined; } },
    otherService: { getById: async () => { throw new Error('read'); } },
  } as never);
  const view = await render(<PendingRecordsEntry />);
  await fireEvent.press(await view.findByLabelText(/其他修改/));
  await view.findByText('暂时无法核对原记录，请稍后重试');
  await act(async () => { refresh(); });
  expect(view.getByText('暂时无法核对原记录，请稍后重试')).toBeTruthy();
});

test('isolated invalid draft warning remains visible when the healthy draft list is empty', async () => {
  jest.mocked(useAppState).mockReturnValue({ draftWarning: '部分草稿暂不可用，原内容已保留。',
    draftService: { list: async () => ({ drafts: [], quarantined: false, generation: 'g' }), subscribe: () => () => undefined },
  } as never);
  const view = await render(<PendingRecordsEntry />);
  await waitFor(() => expect(view.getByText('部分草稿暂不可用，原内容已保留。')).toBeTruthy());
  expect(view.queryByLabelText('重试读取未完成记录')).toBeNull();
});
