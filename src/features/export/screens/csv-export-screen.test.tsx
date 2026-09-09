import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { useAppState } from '@/application/app-state/app-state-provider';

import { CsvExportScreen } from './csv-export-screen';

jest.mock('@/application/app-state/app-state-provider', () => ({ useAppState: jest.fn() }));
jest.mock('@/components/ui/app-icon', () => ({ AppIcon: () => null }));

async function setup(result: { kind: string; filename?: string; rowCount?: number } = {
  kind: 'share-sheet-closed', filename: 'baobao-today-records.csv', rowCount: 1,
}) {
  const exportCsvService = { exportCsv: jest.fn(async () => result) };
  (useAppState as jest.Mock).mockReturnValue({ exportCsvService });
  return { screen: await render(<CsvExportScreen />), exportCsvService };
}

describe('CsvExportScreen', () => {
  test('explains that CSV excludes photos and cannot restore app data', async () => {
    const { screen } = await setup();
    expect(screen.getByText('CSV适合查看和分享，不包含大便照片，也不能用于完整恢复App数据。')).toBeTruthy();
    expect(screen.getByText('跨天睡眠只要与所选日期范围有重叠，就会包含在导出文件中。')).toBeTruthy();
  });

  test('exports all records by default and reports only that the share sheet closed', async () => {
    const { screen, exportCsvService } = await setup();
    await fireEvent.press(screen.getByLabelText('开始导出CSV'));
    await waitFor(() => expect(exportCsvService.exportCsv).toHaveBeenCalledWith({ kind: 'all' }));
    expect(await screen.findByText('分享面板已关闭。App不会自动上传导出文件。')).toBeTruthy();
  });

  test('shows local date controls only for a custom range', async () => {
    const { screen } = await setup();
    expect(screen.queryByLabelText('选择导出开始日期')).toBeNull();
    await fireEvent.press(screen.getByLabelText('选择自定义日期范围'));
    expect(screen.getByLabelText('选择导出开始日期')).toBeTruthy();
    expect(screen.getByLabelText('选择导出结束日期')).toBeTruthy();
  });

  test('asks before exporting a header-only CSV', async () => {
    const exportCsvService = {
      exportCsv: jest.fn()
        .mockResolvedValueOnce({ kind: 'empty-confirmation-required' })
        .mockResolvedValueOnce({ kind: 'share-sheet-closed', filename: 'empty.csv', rowCount: 0 }),
    };
    (useAppState as jest.Mock).mockReturnValue({ exportCsvService });
    const screen = await render(<CsvExportScreen />);

    await fireEvent.press(screen.getByLabelText('开始导出CSV'));
    expect(await screen.findByText('所选范围内没有记录')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('继续导出'));
    await waitFor(() => expect(exportCsvService.exportCsv).toHaveBeenNthCalledWith(2, { kind: 'all' }, { allowEmpty: true }));
  });

  test('does not export when the user cancels an empty-range confirmation', async () => {
    const exportCsvService = { exportCsv: jest.fn(async () => ({ kind: 'empty-confirmation-required' })) };
    (useAppState as jest.Mock).mockReturnValue({ exportCsvService });
    const screen = await render(<CsvExportScreen />);

    await fireEvent.press(screen.getByLabelText('开始导出CSV'));
    expect(await screen.findByText('所选范围内没有记录')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('取消'));
    expect(exportCsvService.exportCsv).toHaveBeenCalledTimes(1);
  });

  test('shows a safe validation message without opening another flow', async () => {
    const exportCsvService = { exportCsv: jest.fn(async () => { throw new Error('开始日期不能晚于结束日期'); }) };
    (useAppState as jest.Mock).mockReturnValue({ exportCsvService });
    const screen = await render(<CsvExportScreen />);

    await fireEvent.press(screen.getByLabelText('开始导出CSV'));

    expect(await screen.findByText('开始日期不能晚于结束日期')).toBeTruthy();
    expect(exportCsvService.exportCsv).toHaveBeenCalledTimes(1);
  });

  test('disables duplicate export presses while one operation is running', async () => {
    let resolve: ((value: { kind: 'share-sheet-closed'; filename: string; rowCount: number }) => void) | undefined;
    const exportCsvService = {
      exportCsv: jest.fn(() => new Promise((done) => { resolve = done; })),
    };
    (useAppState as jest.Mock).mockReturnValue({ exportCsvService });
    const screen = await render(<CsvExportScreen />);

    await fireEvent.press(screen.getByLabelText('开始导出CSV'));
    await fireEvent.press(screen.getByLabelText('开始导出CSV'));
    expect(exportCsvService.exportCsv).toHaveBeenCalledTimes(1);
    resolve?.({ kind: 'share-sheet-closed', filename: 'file.csv', rowCount: 1 });
    await waitFor(() => expect(screen.getByText('分享面板已关闭。App不会自动上传导出文件。')).toBeTruthy());
  });
});
