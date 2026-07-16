import { File, FileMode } from 'expo-file-system';

import type {
  ArchiveBinaryIo,
  ArchiveReader,
  ArchiveWriter,
} from './fflate-backup-archive-gateway';

export class ExpoArchiveBinaryIo implements ArchiveBinaryIo {
  openReader(uri: string): ArchiveReader {
    const file = new File(uri);
    if (!file.exists) throw new Error('归档源文件不存在');
    const handle = file.open(FileMode.ReadOnly);
    const size = handle.size;
    if (size === null) { handle.close(); throw new Error('无法读取归档文件大小'); }
    return {
      size,
      readAt: (offset, length) => {
        handle.offset = offset;
        return handle.readBytes(length);
      },
      forEachChunk: (chunkSize, visit) => {
        handle.offset = 0;
        if (size === 0) { visit(new Uint8Array(), true); return; }
        while ((handle.offset ?? size) < size) {
          const remaining = size - (handle.offset ?? 0);
          const chunk = handle.readBytes(Math.min(chunkSize, remaining));
          visit(chunk, (handle.offset ?? size) >= size);
        }
      },
      close: () => handle.close(),
    };
  }

  openWriter(uri: string): ArchiveWriter {
    const file = new File(uri);
    file.create({ overwrite: true, intermediates: true });
    const handle = file.open(FileMode.ReadWrite);
    handle.offset = 0;
    return {
      write: (bytes) => handle.writeBytes(bytes),
      close: () => handle.close(),
    };
  }
}
