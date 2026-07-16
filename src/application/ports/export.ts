import type { ExportSnapshot } from '@/domain/export/csv-encoder';
import type { ResolvedExportRange } from '@/domain/export/export-range';

export interface ExportSnapshotRepository {
  getSnapshot(range: ResolvedExportRange, capturedAtMs: number): Promise<ExportSnapshot>;
}

export interface ExportFileStore {
  write(filename: string, content: string): Promise<{ filename: string; uri: string }>;
  cleanupExpired(nowMs: number, currentUri?: string): Promise<{ deleted: number; failed: number }>;
}

export interface ShareGateway {
  isAvailable(): Promise<boolean>;
  share(uri: string, filename: string): Promise<void>;
}
