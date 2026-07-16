import { strToU8, zipSync } from 'fflate';

import {
  ArchiveSecurityError,
  FflateBackupArchiveGateway,
  type ArchiveBinaryIo,
  type ArchiveReader,
  type ArchiveWriter,
} from './fflate-backup-archive-gateway';

class MemoryIo implements ArchiveBinaryIo {
  readonly files = new Map<string, Uint8Array>();

  openReader(uri: string): ArchiveReader {
    const bytes = this.files.get(uri);
    if (!bytes) throw new Error(`missing ${uri}`);
    return {
      size: bytes.length,
      readAt: (offset, length) => bytes.slice(offset, offset + length),
      forEachChunk: (chunkSize, visit) => {
        if (bytes.length === 0) { visit(new Uint8Array(), true); return; }
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          visit(bytes.slice(offset, offset + chunkSize), offset + chunkSize >= bytes.length);
        }
      },
      close: () => undefined,
    };
  }

  openWriter(uri: string): ArchiveWriter {
    const chunks: Uint8Array[] = [];
    return {
      write: (bytes) => chunks.push(bytes.slice()),
      close: () => {
        const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
        const output = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
        this.files.set(uri, output);
      },
    };
  }
}

function gatewayWithArchive(entries: Record<string, Uint8Array>, options: Parameters<typeof zipSync>[1] = {}) {
  const io = new MemoryIo();
  io.files.set('archive.zip', zipSync(entries, options));
  return { io, gateway: new FflateBackupArchiveGateway(io) };
}

function mutateFirstCentralEntry(bytes: Uint8Array, mutate: (view: DataView, offset: number) => void) {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  for (let offset = 0; offset + 46 <= copy.length; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) { mutate(view, offset); return copy; }
  }
  throw new Error('central entry not found');
}

describe('FflateBackupArchiveGateway', () => {
  test('creates and extracts a bounded streamed archive without loading all sources together', async () => {
    const io = new MemoryIo();
    io.files.set('baby-source', strToU8('{"name":"小宝"}'));
    io.files.set('records-source', strToU8('[]'));
    io.files.set('settings-source', strToU8('{}'));
    io.files.set('photo-source', new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]));
    const gateway = new FflateBackupArchiveGateway(io, { chunkSize: 3 });

    await gateway.createArchive('backup.zip', [
      { path: 'baby.json', sourceUri: 'baby-source' },
      { path: 'records.json', sourceUri: 'records-source' },
      { path: 'settings.json', sourceUri: 'settings-source' },
      { path: 'photos/photo-1.jpg', sourceUri: 'photo-source' },
    ]);
    const inspection = await gateway.inspect('backup.zip');
    expect(inspection.entries.map((entry) => entry.path)).toEqual([
      'baby.json', 'records.json', 'settings.json', 'photos/photo-1.jpg',
    ]);
    await gateway.extract('backup.zip', new Map(inspection.entries.map((entry) => [entry.path, `out/${entry.path}`])));
    expect(io.files.get('out/baby.json')).toEqual(io.files.get('baby-source'));
    expect(io.files.get('out/photos/photo-1.jpg')).toEqual(io.files.get('photo-source'));
  });

  test.each([
    '../baby.json',
    '/baby.json',
    'C:/baby.json',
    'photos/../../baby.json',
    'unknown.txt',
  ])('rejects unsafe or unknown path %s before extraction', async (path) => {
    const { gateway } = gatewayWithArchive({
      [path]: strToU8('bad'), 'baby.json': strToU8('{}'), 'records.json': strToU8('[]'), 'settings.json': strToU8('{}'),
    });
    await expect(gateway.inspect('archive.zip')).rejects.toBeInstanceOf(ArchiveSecurityError);
  });

  test('rejects case-insensitive path collisions', async () => {
    const { gateway } = gatewayWithArchive({
      'baby.json': strToU8('{}'), 'Baby.json': strToU8('{}'),
      'records.json': strToU8('[]'), 'settings.json': strToU8('{}'),
    });
    await expect(gateway.inspect('archive.zip')).rejects.toThrow(/重复|冲突/);
  });

  test('rejects Unix symlink entries from central-directory metadata', async () => {
    const { io, gateway } = gatewayWithArchive({
      'baby.json': strToU8('{}'), 'records.json': strToU8('[]'), 'settings.json': strToU8('{}'),
    });
    io.files.set('archive.zip', mutateFirstCentralEntry(io.files.get('archive.zip')!, (view, offset) => {
      view.setUint16(offset + 4, (3 << 8) | 20, true);
      view.setUint32(offset + 38, 0xa000 << 16, true);
    }));
    await expect(gateway.inspect('archive.zip')).rejects.toThrow(/符号链接/);
  });

  test('rejects excessive decompression ratio before extraction', async () => {
    const { gateway } = gatewayWithArchive({
      'baby.json': new Uint8Array(2_000_000), 'records.json': strToU8('[]'), 'settings.json': strToU8('{}'),
    }, { level: 9 });
    await expect(gateway.inspect('archive.zip')).rejects.toThrow(/解压比/);
  });

  test('rejects central metadata claiming an oversized single entry', async () => {
    const { io, gateway } = gatewayWithArchive({
      'baby.json': strToU8('{}'), 'records.json': strToU8('[]'), 'settings.json': strToU8('{}'),
    });
    io.files.set('archive.zip', mutateFirstCentralEntry(io.files.get('archive.zip')!, (view, offset) => {
      view.setUint32(offset + 24, 21 * 1024 * 1024, true);
    }));
    await expect(gateway.inspect('archive.zip')).rejects.toThrow(/过大/);
  });

  test('refuses extraction targets that do not exactly match inspected entries', async () => {
    const { gateway } = gatewayWithArchive({
      'baby.json': strToU8('{}'), 'records.json': strToU8('[]'), 'settings.json': strToU8('{}'),
    });
    await expect(gateway.extract('archive.zip', new Map([['baby.json', 'out/baby.json']])))
      .rejects.toThrow(/目标/);
  });
});
