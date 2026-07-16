import { buildExportFilename, ManagedExportFileStore, type ExportFileBackend } from './managed-export-file-store';

function backend(files: { name: string; uri: string; lastModifiedMs: number | null }[] = []) {
  const state = [...files];
  const value: jest.Mocked<ExportFileBackend> = {
    ensureDirectory: jest.fn(async () => undefined),
    listFiles: jest.fn(async () => [...state]),
    writeText: jest.fn(async (name, _content) => `cache/exports/${name}`),
    deleteFile: jest.fn(async (uri) => {
      const index = state.findIndex((item) => item.uri === uri);
      if (index >= 0) state.splice(index, 1);
    }),
  };
  return value;
}

describe('ManagedExportFileStore', () => {
  test('builds stable ASCII filenames for all records and a range', () => {
    const nowMs = new Date(2026, 6, 11, 23, 15, 30, 456).getTime();
    expect(buildExportFilename({ kind: 'all' }, nowMs)).toBe('baobao-today-records-20260711-231530-456.csv');
    expect(buildExportFilename({ kind: 'date-range', startDate: '2026-07-01', endDate: '2026-07-11', startMs: 1, endExclusiveMs: 2 }, nowMs))
      .toBe('baobao-today-records-20260701-to-20260711-20260711-231530-456.csv');
    expect(buildExportFilename({ kind: 'all' }, nowMs + 1)).not.toBe(buildExportFilename({ kind: 'all' }, nowMs));
  });

  test('writes only after ensuring the managed exports directory', async () => {
    const fileBackend = backend();
    const store = new ManagedExportFileStore(fileBackend);
    await expect(store.write('records.csv', '\uFEFFheader\r\n')).resolves.toEqual({
      filename: 'records.csv', uri: 'cache/exports/records.csv',
    });
    expect(fileBackend.ensureDirectory.mock.invocationCallOrder[0])
      .toBeLessThan(fileBackend.writeText.mock.invocationCallOrder[0]);
  });

  test('best-effort deletes only managed export CSVs older than 24 hours and preserves current file', async () => {
    const nowMs = new Date(2026, 6, 11, 12).getTime();
    const fileBackend = backend([
      { name: 'baobao-today-records-old.csv', uri: 'cache/exports/old.csv', lastModifiedMs: nowMs - 25 * 3_600_000 },
      { name: 'baobao-today-records-recent.csv', uri: 'cache/exports/recent.csv', lastModifiedMs: nowMs - 23 * 3_600_000 },
      { name: 'baobao-today-records-current.csv', uri: 'cache/exports/current.csv', lastModifiedMs: nowMs - 30 * 3_600_000 },
      { name: 'baobao-today-records-unknown.csv', uri: 'cache/exports/unknown.csv', lastModifiedMs: null },
      { name: 'unrelated.txt', uri: 'cache/exports/unrelated.txt', lastModifiedMs: 0 },
    ]);
    fileBackend.deleteFile.mockRejectedValueOnce(new Error('delete denied'));
    const store = new ManagedExportFileStore(fileBackend);

    await expect(store.cleanupExpired(nowMs, 'cache/exports/current.csv')).resolves.toEqual({ deleted: 0, failed: 1 });
    expect(fileBackend.deleteFile).toHaveBeenCalledTimes(1);
    expect(fileBackend.deleteFile).toHaveBeenCalledWith('cache/exports/old.csv');
  });

  test('treats directory and listing failures as non-blocking cleanup failures', async () => {
    const ensureFailure = backend();
    ensureFailure.ensureDirectory.mockRejectedValue(new Error('mkdir denied'));
    await expect(new ManagedExportFileStore(ensureFailure).cleanupExpired(Date.now()))
      .resolves.toEqual({ deleted: 0, failed: 1 });

    const listFailure = backend();
    listFailure.listFiles.mockRejectedValue(new Error('list denied'));
    await expect(new ManagedExportFileStore(listFailure).cleanupExpired(Date.now()))
      .resolves.toEqual({ deleted: 0, failed: 1 });
  });
});
