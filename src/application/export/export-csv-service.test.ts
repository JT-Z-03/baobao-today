import type { ExportFileStore, ExportSnapshotRepository, ShareGateway } from '@/application/ports/export';
import type { ExportSnapshot } from '@/domain/export/csv-encoder';

import { createExportCsvService } from './export-csv-service';

const nowMs = new Date(2026, 6, 11, 12).getTime();

function snapshot(records: ExportSnapshot['records'] = []): ExportSnapshot {
  return { capturedAtMs: nowMs, baby: { name: '小宝', birthDate: '2026-06-20' }, records };
}

function setup(value = snapshot([{ id: 'other-1', type: 'other', eventTimeMs: nowMs, recordDate: '2026-07-11', createdAtMs: nowMs, updatedAtMs: nowMs, title: '洗澡', note: null }])) {
  const repository: jest.Mocked<ExportSnapshotRepository> = { getSnapshot: jest.fn(async (_range, _capturedAtMs) => value) };
  const fileStore: jest.Mocked<ExportFileStore> = {
    cleanupExpired: jest.fn(async (_nowMs, _currentUri) => ({ deleted: 0, failed: 0 })),
    write: jest.fn(async (filename, _content) => ({ filename, uri: `cache/exports/${filename}` })),
  };
  const shareGateway: jest.Mocked<ShareGateway> = {
    isAvailable: jest.fn(async () => true),
    share: jest.fn(async (_uri, _filename) => undefined),
  };
  const service = createExportCsvService({ repository, fileStore, shareGateway, now: () => nowMs });
  return { service, repository, fileStore, shareGateway };
}

describe('ExportCsvService', () => {
  test('requires explicit confirmation before writing an empty CSV', async () => {
    const { service, fileStore, shareGateway } = setup(snapshot());
    await expect(service.exportCsv({ kind: 'all' })).resolves.toEqual({ kind: 'empty-confirmation-required' });
    expect(fileStore.write).not.toHaveBeenCalled();
    expect(shareGateway.share).not.toHaveBeenCalled();
  });

  test('exports a confirmed empty table and opens the system share sheet', async () => {
    const { service, fileStore, shareGateway } = setup(snapshot());
    await expect(service.exportCsv({ kind: 'all' }, { allowEmpty: true })).resolves.toMatchObject({
      kind: 'share-sheet-closed', rowCount: 0,
    });
    expect(fileStore.write.mock.calls[0][1]).toContain('record_id,baby_name');
    expect(shareGateway.share).toHaveBeenCalledTimes(1);
  });

  test('does not claim success or invoke share when system sharing is unavailable', async () => {
    const { service, shareGateway } = setup();
    shareGateway.isAvailable.mockResolvedValue(false);
    await expect(service.exportCsv({ kind: 'all' })).resolves.toMatchObject({ kind: 'share-unavailable' });
    expect(shareGateway.share).not.toHaveBeenCalled();
  });

  test('does not share after snapshot or file write failure', async () => {
    const first = setup();
    first.repository.getSnapshot.mockRejectedValue(new Error('sqlite details'));
    await expect(first.service.exportCsv({ kind: 'all' })).rejects.toThrow('无法读取导出数据，请重试。');
    expect(first.shareGateway.share).not.toHaveBeenCalled();

    const second = setup();
    second.fileStore.write.mockRejectedValue(new Error('disk details'));
    await expect(second.service.exportCsv({ kind: 'all' })).rejects.toThrow('CSV文件生成失败，请重试。');
    expect(second.shareGateway.share).not.toHaveBeenCalled();
  });

  test('converts native share rejection to a user-safe error', async () => {
    const { service, shareGateway } = setup();
    shareGateway.share.mockRejectedValue(new Error('/private/cache/secret.csv'));

    await expect(service.exportCsv({ kind: 'all' })).rejects.toThrow('无法打开系统分享面板，请重试。');
  });

  test('coalesces rapid duplicate calls into one snapshot, file, and share operation', async () => {
    const { service, repository, fileStore, shareGateway } = setup();
    shareGateway.share.mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

    const first = service.exportCsv({ kind: 'all' });
    const second = service.exportCsv({ kind: 'all' });
    await Promise.all([first, second]);

    expect(repository.getSnapshot).toHaveBeenCalledTimes(1);
    expect(fileStore.write).toHaveBeenCalledTimes(1);
    expect(shareGateway.share).toHaveBeenCalledTimes(1);
  });
});
