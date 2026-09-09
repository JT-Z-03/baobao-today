import { fireEvent, render } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import {
  createPoopSubmissionLock,
  PoopForm,
  shouldRequestMediaLibraryPermission,
} from './poop-form';

jest.mock('expo-image-picker', () => ({
  getPendingResultAsync: jest.fn(() => new Promise(() => undefined)),
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const initialInput = {
  eventTimeMs: new Date(2026, 6, 11, 8, 0).getTime(),
  color: null,
  texture: null,
  amount: null,
  note: null,
};

describe('PoopForm', () => {
  test('uses the Android system photo picker without requesting media library permission', () => {
    expect(shouldRequestMediaLibraryPermission('android')).toBe(false);
    expect(shouldRequestMediaLibraryPermission('ios')).toBe(true);
  });

  test('opens and closes a full-screen photo preview', async () => {
    const screen = await render(
      <PoopForm
        initialInput={initialInput}
        initialPhotoPreviewUri="file:///private/poop-photo.jpg"
        clientRequestId={null}
        onSave={jest.fn(async () => undefined)}
      />,
    );

    await fireEvent.press(screen.getByLabelText('查看照片大图'));
    expect(screen.getByLabelText('大便照片大图')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('关闭照片大图'));
    expect(screen.queryByLabelText('大便照片大图')).toBeNull();
  });

  test('shows a safe placeholder when a stored photo cannot be resolved', async () => {
    const screen = await render(
      <PoopForm
        initialInput={initialInput}
        initialPhotoPreviewUri={null}
        hasInitialPhoto
        clientRequestId={null}
        onSave={jest.fn(async () => undefined)}
      />,
    );

    expect(screen.getByLabelText('照片暂时无法显示')).toBeTruthy();
    expect(screen.queryByText(/file:|content:|\/data\//)).toBeNull();
  });

  test('saves a time-only record with the stable request id', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <PoopForm
        initialInput={initialInput}
        initialPhotoPreviewUri={null}
        clientRequestId="stable-request"
        onSave={onSave}
      />,
    );

    await fireEvent.press(screen.getByLabelText('保存大便记录'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      initialInput,
      { kind: 'keep' },
      'stable-request',
    );
  });

  test('optional classifications can be selected and cleared', async () => {
    const screen = await render(
      <PoopForm
        initialInput={initialInput}
        initialPhotoPreviewUri={null}
        clientRequestId="stable-request"
        onSave={jest.fn(async () => undefined)}
      />,
    );
    await fireEvent.press(screen.getByLabelText('选择大便颜色 黄色'));
    expect(screen.getByLabelText('选择大便颜色 黄色').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByLabelText('选择大便颜色 黄色'));
    expect(screen.getByLabelText('选择大便颜色 黄色').props.accessibilityState.selected).toBe(false);
  });

  test('keeps all observed classifications optional after selecting and clearing them', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <PoopForm initialInput={initialInput} initialPhotoPreviewUri={null} clientRequestId="stable-request" onSave={onSave} />,
    );
    for (const label of ['选择大便颜色 黄色', '选择大便状态 糊状', '选择大便量 中']) {
      await fireEvent.press(screen.getByLabelText(label));
      await fireEvent.press(screen.getByLabelText(label));
    }
    await fireEvent.press(screen.getByLabelText('保存大便记录'));
    expect(onSave).toHaveBeenCalledWith(initialInput, { kind: 'keep' }, 'stable-request');
  });

  test('can still save without a photo when the camera permission is denied', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({
      granted: false, canAskAgain: false, status: 'denied', expires: 'never',
    } as Awaited<ReturnType<typeof ImagePicker.requestCameraPermissionsAsync>>);
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <PoopForm initialInput={initialInput} initialPhotoPreviewUri={null} clientRequestId="stable-request" onSave={onSave} />,
    );
    await fireEvent.press(screen.getByLabelText('拍照'));
    expect(await screen.findByText('照片权限已关闭，可在系统设置中开启；仍可保存不带照片的记录。')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('保存大便记录'));
    expect(onSave).toHaveBeenCalledWith(initialInput, { kind: 'keep' }, 'stable-request');
  });

  test('removes an unavailable existing photo without changing the record fields', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = await render(
      <PoopForm initialInput={initialInput} initialPhotoPreviewUri={null} hasInitialPhoto clientRequestId={null} onSave={onSave} />,
    );
    await fireEvent.press(screen.getByLabelText('移除照片'));
    expect(screen.queryByLabelText('照片暂时无法显示')).toBeNull();
    await fireEvent.press(screen.getByLabelText('保存大便记录'));
    expect(onSave).toHaveBeenCalledWith(initialInput, { kind: 'remove' }, null);
  });

  test('submission lock rejects a second save while the first is pending', async () => {
    let finish: (() => void) | undefined;
    const lock = createPoopSubmissionLock();
    const firstTask = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const duplicateTask = jest.fn(async () => undefined);
    const firstRun = lock.run(firstTask);
    await expect(lock.run(duplicateTask)).resolves.toBe(false);
    expect(duplicateTask).not.toHaveBeenCalled();
    finish?.();
    await expect(firstRun).resolves.toBe(true);
  });
});
