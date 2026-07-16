import { Directory, File, Paths } from 'expo-file-system';

import { ManagedExportFileStore, type ExportFileBackend } from '@/data/export/managed-export-file-store';

const directory = new Directory(Paths.cache, 'exports');

class ExpoExportFileBackend implements ExportFileBackend {
  async ensureDirectory() {
    directory.create({ idempotent: true, intermediates: true });
  }

  async listFiles() {
    if (!directory.exists) return [];
    return directory.list()
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => ({
        name: file.name,
        uri: file.uri,
        lastModifiedMs: file.lastModified,
      }));
  }

  async writeText(filename: string, content: string) {
    const file = new File(directory, filename);
    file.create({ overwrite: true, intermediates: true });
    file.write(content);
    return file.uri;
  }

  async deleteFile(uri: string) {
    const file = new File(uri);
    if (file.exists) file.delete();
  }
}

export class ExpoExportFileStore extends ManagedExportFileStore {
  constructor() {
    super(new ExpoExportFileBackend());
  }
}
