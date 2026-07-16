import type { ExportFileStore } from '@/application/ports/export';

export { buildExportFilename } from '@/domain/export/export-filename';

const RETENTION_MS = 24 * 60 * 60 * 1000;
const MANAGED_FILENAME = /^baobao-today-records-[0-9A-Za-z-]+\.csv$/;

export interface ExportFileBackend {
  ensureDirectory(): Promise<void>;
  listFiles(): Promise<{ name: string; uri: string; lastModifiedMs: number | null }[]>;
  writeText(filename: string, content: string): Promise<string>;
  deleteFile(uri: string): Promise<void>;
}

export class ManagedExportFileStore implements ExportFileStore {
  constructor(private readonly backend: ExportFileBackend) {}

  async write(filename: string, content: string) {
    await this.backend.ensureDirectory();
    const uri = await this.backend.writeText(filename, content);
    return { filename, uri };
  }

  async cleanupExpired(nowMs: number, currentUri?: string) {
    let deleted = 0;
    let failed = 0;
    try {
      await this.backend.ensureDirectory();
      const files = await this.backend.listFiles();
      for (const file of files) {
        if (!MANAGED_FILENAME.test(file.name) || file.uri === currentUri) continue;
        if (file.lastModifiedMs === null || file.lastModifiedMs >= nowMs - RETENTION_MS) continue;
        try {
          await this.backend.deleteFile(file.uri);
          deleted += 1;
        } catch {
          failed += 1;
        }
      }
    } catch {
      failed += 1;
    }
    return { deleted, failed };
  }
}
