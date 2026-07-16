import type { ExportFileStore, ExportSnapshotRepository, ShareGateway } from '@/application/ports/export';
import { encodeExportSnapshotCsv } from '@/domain/export/csv-encoder';
import { buildExportFilename } from '@/domain/export/export-filename';
import { resolveExportRange, type ExportScope } from '@/domain/export/export-range';
import { toLocalDateKey } from '@/domain/date/local-date';

export class ExportCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportCsvError';
  }
}

type Dependencies = {
  repository: ExportSnapshotRepository;
  fileStore: ExportFileStore;
  shareGateway: ShareGateway;
  now(): number;
};

export function createExportCsvService(dependencies: Dependencies) {
  let inFlight: Promise<ExportCsvResult> | null = null;

  async function execute(scope: ExportScope, allowEmpty: boolean): Promise<ExportCsvResult> {
    const capturedAtMs = dependencies.now();
    const range = resolveExportRange(scope, toLocalDateKey(capturedAtMs));
    let snapshot;
    try {
      snapshot = await dependencies.repository.getSnapshot(range, capturedAtMs);
    } catch {
      throw new ExportCsvError('无法读取导出数据，请重试。');
    }
    if (snapshot.records.length === 0 && !allowEmpty) {
      return { kind: 'empty-confirmation-required' };
    }

    let content: string;
    try {
      content = encodeExportSnapshotCsv(snapshot);
    } catch {
      throw new ExportCsvError('CSV文件生成失败，请重试。');
    }
    await dependencies.fileStore.cleanupExpired(capturedAtMs).catch(() => undefined);
    const filename = buildExportFilename(range, capturedAtMs);
    let file: { filename: string; uri: string };
    try {
      file = await dependencies.fileStore.write(filename, content);
    } catch {
      throw new ExportCsvError('CSV文件生成失败，请重试。');
    }

    let available: boolean;
    try {
      available = await dependencies.shareGateway.isAvailable();
    } catch {
      available = false;
    }
    if (!available) {
      return { kind: 'share-unavailable', filename: file.filename, rowCount: snapshot.records.length };
    }
    try {
      await dependencies.shareGateway.share(file.uri, file.filename);
    } catch {
      throw new ExportCsvError('无法打开系统分享面板，请重试。');
    }
    return { kind: 'share-sheet-closed', filename: file.filename, rowCount: snapshot.records.length };
  }

  return {
    exportCsv(scope: ExportScope, options: { allowEmpty?: boolean } = {}) {
      if (inFlight) return inFlight;
      inFlight = execute(scope, options.allowEmpty ?? false).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

export type ExportCsvResult =
  | { kind: 'empty-confirmation-required' }
  | { kind: 'share-unavailable'; filename: string; rowCount: number }
  | { kind: 'share-sheet-closed'; filename: string; rowCount: number };

export type ExportCsvService = ReturnType<typeof createExportCsvService>;
