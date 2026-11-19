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
  test('lets a queued UI task run before a photo archive finishes and reports real byte progress', async () => {
    const io = new MemoryIo();
    io.files.set('photo', new Uint8Array(2 * 1024 * 1024));
    let uiRan = false;
    const scheduled = new Promise<void>((resolve) => setTimeout(() => { uiRan = true; resolve(); }, 0));
    const progress = jest.fn();
    await new FflateBackupArchiveGateway(io).createArchive('backup.zip', [
      { path: 'photos/photo.jpg', sourceUri: 'photo' },
    ], progress);
    expect(uiRan).toBe(true);
    await scheduled;
    expect(progress).toHaveBeenLastCalledWith({ stage: 'archive', completed: 2 * 1024 * 1024, total: 2 * 1024 * 1024, unit: 'bytes' });
    const observer = jest.fn(() => { throw new Error('UI unmounted'); });
    await expect(new FflateBackupArchiveGateway(io).extract('backup.zip', new Map([['photos/photo.jpg', 'restored']]), observer)).resolves.toBeDefined();
    const restored = io.files.get('restored')!;
    const source = io.files.get('photo')!;
    expect(restored).toHaveLength(source.length);
    expect(restored.every((byte, index) => byte === source[index])).toBe(true);
  });

  test('yields while both creating and extracting, not only before the operation starts', async () => {
    const io = new MemoryIo();
    io.files.set('photo', new Uint8Array(1024 * 1024));
    const gateway = new FflateBackupArchiveGateway(io);
    const targets = new Map([['photos/photo.jpg', 'restored']]);
    for (const stage of ['archive', 'extract'] as const) {
      let ranDuringTransfer = false; let scheduled = false; let ranBeforeLastChunk = false;
      const observer = (progress: { stage: string; completed?: number; total?: number }) => {
        if (progress.stage !== stage || !progress.completed) return;
        if (!scheduled) { scheduled = true; setTimeout(() => { ranDuringTransfer = true; }, 0); }
        if (progress.completed === progress.total) ranBeforeLastChunk = ranDuringTransfer;
      };
      if (stage === 'archive') await gateway.createArchive('backup.zip', [{ path: 'photos/photo.jpg', sourceUri: 'photo' }], observer);
      else await gateway.extract('backup.zip', targets, observer);
      expect(ranBeforeLastChunk).toBe(true);
    }
  });

  test('closes every extraction handle even if one cleanup fails, preserving the write error', async () => {
    const memory = new MemoryIo();
    memory.files.set('archive', zipSync({ 'photos/photo.jpg': new Uint8Array(400_000) }, { level: 0 }));
    const closeInput = jest.fn();
    const closeOutput = jest.fn(() => { throw new Error('close failed'); });
    const io: ArchiveBinaryIo = {
      openReader: (uri) => ({ ...memory.openReader(uri), close: closeInput }),
      openWriter: () => ({ write: () => { throw new Error('disk full'); }, close: closeOutput }),
    };
    await expect(new FflateBackupArchiveGateway(io).extract('archive', new Map([['photos/photo.jpg', 'out']])))
      .rejects.toThrow('disk full');
    expect(closeInput).toHaveBeenCalledTimes(2);
    expect(closeOutput).toHaveBeenCalled();
  });

  test('closes input and output handles when reading stops partway through an archive', async () => {
    const closeReader = jest.fn(); const closeWriter = jest.fn();
    const io: ArchiveBinaryIo = {
      openReader: () => ({ size: 200_000, readAt: (offset) => offset === 0 ? new Uint8Array(65_536) : new Uint8Array(),
        forEachChunk: jest.fn(), close: closeReader }),
      openWriter: () => ({ write: jest.fn(), close: closeWriter }),
    };
    await expect(new FflateBackupArchiveGateway(io).createArchive('out', [{ path: 'records.json', sourceUri: 'in' }]))
      .rejects.toThrow(/读取中断/);
    expect(closeReader).toHaveBeenCalledTimes(2);
    expect(closeWriter).toHaveBeenCalledTimes(1);
  });

  test('round-trips records.json at the 16 MiB limit while keeping other JSON limited to 5 MiB', async () => {
    const io = new MemoryIo();
    io.files.set('records-source', new Uint8Array(16 * 1024 * 1024));
    const gateway = new FflateBackupArchiveGateway(io);
    await gateway.createArchive('boundary.zip', [{ path: 'records.json', sourceUri: 'records-source' }]);
    const inspection = await gateway.inspect('boundary.zip');
    expect(inspection.entries[0].uncompressedSize).toBe(16 * 1024 * 1024);
    await gateway.extract('boundary.zip', new Map([['records.json', 'restored']]));
    expect(io.files.get('restored')?.length).toBe(16 * 1024 * 1024);
    await expect(gateway.createArchive('invalid.zip', [{ path: 'baby.json', sourceUri: 'records-source' }]))
      .rejects.toThrow(/过大|容量|上限/);
    expect(io.files.has('invalid.zip')).toBe(false);
  });

  test.each([
    ['records.json', 16 * 1024 * 1024 + 1],
    ['baby.json', 5 * 1024 * 1024 + 1],
    ['photos/photo-1.jpg', 20 * 1024 * 1024 + 1],
  ])('rejects oversized %s before opening or writing an output archive', async (path, size) => {
    const openWriter = jest.fn();
    const io: ArchiveBinaryIo = {
      openReader: () => ({ size, readAt: jest.fn(), forEachChunk: jest.fn(), close: jest.fn() }),
      openWriter,
    };
    await expect(new FflateBackupArchiveGateway(io).createArchive('out', [{ path, sourceUri: 'source' }]))
      .rejects.toThrow();
    expect(openWriter).not.toHaveBeenCalled();
  });

  test('rejects a STORE archive whose ZIP overhead exceeds the total budget before output is opened', async () => {
    const openWriter = jest.fn();
    const io: ArchiveBinaryIo = {
      openReader: (uri) => ({ size: Number(uri), readAt: jest.fn(), forEachChunk: jest.fn(), close: jest.fn() }),
      openWriter,
    };
    const entries = Array.from({ length: 26 }, (_, index) => ({
      path: `photos/photo-${index}.jpg`,
      sourceUri: String(index < 25 ? 20 * 1024 * 1024 : 12 * 1024 * 1024),
    }));
    await expect(new FflateBackupArchiveGateway(io).createArchive('out', entries)).rejects.toThrow();
    expect(openWriter).not.toHaveBeenCalled();
  });

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
