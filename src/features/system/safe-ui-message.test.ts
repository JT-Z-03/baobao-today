import { toSafeUiMessage } from '@/features/system/safe-ui-message';

test('keeps intentional Chinese validation but hides infrastructure details', () => {
  expect(toSafeUiMessage(new Error('请填写标题'), '保存失败，请重试。')).toBe('请填写标题');
  expect(toSafeUiMessage(new Error('SQLite constraint failed: records.id'), '保存失败，请重试。')).toBe('保存失败，请重试。');
  expect(toSafeUiMessage(new Error('file:///data/user/0/app/photo.jpg'), '照片读取失败。')).toBe('照片读取失败。');
  expect(toSafeUiMessage(new Error('TypeError: undefined is not a function\n at form.tsx:20'), '操作失败，请重试。')).toBe('操作失败，请重试。');
});
