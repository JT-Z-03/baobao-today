import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import type {
  BackupBuildWorkspace,
  BackupFileStore,
  BackupRestoreWorkspace,
} from '@/application/ports/backup';
import { BACKUP_ARCHIVE_LIMITS } from '@/data/backup/fflate-backup-archive-gateway';

const RETENTION_MS = 24 * 60 * 60 * 1000;
const temporaryDirectory = new Directory(Paths.cache, 'backups');
const stagingRoot = new Directory(Paths.cache, 'backup-staging');
const safetyDirectory = new Directory(Paths.document, 'backup-safety');
const temporaryNamePattern = /^baobao-today-backup-[0-9A-Za-z-]+\.zip$/;
const safeSessionPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function ensureSessionId(id: string) {
  if (!safeSessionPattern.test(id)) throw new Error('备份工作区标识无效');
}

function entryFile(directory: Directory, path: string) {
  if (path === 'manifest.json' || path === 'baby.json' || path === 'records.json' || path === 'settings.json') {
    return new File(directory, path);
  }
  const match = /^photos\/([A-Za-z0-9][A-Za-z0-9_-]*\.jpg)$/.exec(path);
  if (!match) throw new Error('备份工作区条目路径无效');
  const photos = new Directory(directory, 'photos');
  photos.create({ idempotent: true, intermediates: true });
  return new File(photos, match[1]);
}

function removeDirectory(directory: Directory) {
  if (directory.exists) directory.delete();
}

async function hashText(content: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

class ExpoBuildWorkspace implements BackupBuildWorkspace {
  constructor(
    readonly id: string,
    readonly filename: string,
    readonly archiveUri: string,
    private readonly directory: Directory,
  ) {}

  async writeJson(path: 'manifest.json' | 'baby.json' | 'records.json' | 'settings.json', content: string) {
    const file = entryFile(this.directory, path);
    file.create({ overwrite: true, intermediates: true });
    file.write(content);
    return {
      path,
      uri: file.uri,
      byteLength: new TextEncoder().encode(content).length,
      sha256: await hashText(content),
    };
  }

  async cleanup() {
    removeDirectory(this.directory);
  }
}

class ExpoRestoreWorkspace implements BackupRestoreWorkspace {
  constructor(
    readonly id: string,
    readonly archiveUri: string,
    private readonly directory: Directory,
  ) {}

  targetUri(path: string) {
    return entryFile(this.directory, path).uri;
  }

  async readText(path: 'manifest.json' | 'baby.json' | 'records.json' | 'settings.json') {
    const file = entryFile(this.directory, path);
    if (!file.exists) throw new Error(`备份缺少${path}`);
    return file.text();
  }

  async cleanup() {
    removeDirectory(this.directory);
  }
}

export class ExpoBackupFileStore implements BackupFileStore {
  async ensureAvailableSpace(requiredBytes: number) {
    const availableBytes = Paths.availableDiskSpace;
    if (Number.isFinite(availableBytes) && availableBytes < Math.ceil(requiredBytes)) {
      throw new Error('Insufficient device storage for complete backup or restore');
    }
  }

  async createBuildWorkspace(id: string, filename: string, purpose: 'temporary' | 'safety') {
    ensureSessionId(id);
    if (!temporaryNamePattern.test(filename)) throw new Error('完整备份文件名无效');
    stagingRoot.create({ idempotent: true, intermediates: true });
    const directory = new Directory(stagingRoot, `build-${id}`);
    removeDirectory(directory);
    directory.create({ intermediates: true });
    const archiveDirectory = purpose === 'temporary' ? temporaryDirectory : safetyDirectory;
    archiveDirectory.create({ idempotent: true, intermediates: true });
    const archive = new File(archiveDirectory, purpose === 'temporary' ? filename : `pending-${id}.zip`);
    if (archive.exists) archive.delete();
    return new ExpoBuildWorkspace(id, filename, archive.uri, directory);
  }

  async createRestoreWorkspace(id: string, sourceArchiveUri: string) {
    ensureSessionId(id);
    stagingRoot.create({ idempotent: true, intermediates: true });
    const directory = new Directory(stagingRoot, `restore-${id}`);
    removeDirectory(directory);
    directory.create({ intermediates: true });
    try {
      const source = new File(sourceArchiveUri);
      if (!source.exists) throw new Error('所选备份文件不可读取');
      if (source.size <= 0 || source.size > BACKUP_ARCHIVE_LIMITS.archiveBytes) {
        throw new Error('Selected backup archive size is outside the supported limit');
      }
      await this.ensureAvailableSpace(source.size + 16 * 1024 * 1024);
      const archive = new File(directory, 'source.zip');
      await source.copy(archive, { overwrite: true });
      return new ExpoRestoreWorkspace(id, archive.uri, directory);
    } catch (error) {
      removeDirectory(directory);
      throw error;
    }
  }

  async promoteSafetyArchive(pendingUri: string) {
    safetyDirectory.create({ idempotent: true, intermediates: true });
    const pending = new File(pendingUri);
    if (!pending.exists || pending.parentDirectory.uri !== safetyDirectory.uri) throw new Error('恢复前安全备份来源无效');
    const target = new File(safetyDirectory, 'last-restore.zip');
    await pending.move(target, { overwrite: true });
  }

  async getSafetyArchiveUri() {
    const file = new File(safetyDirectory, 'last-restore.zip');
    return file.exists ? file.uri : null;
  }

  async deleteArchive(uri: string) {
    const file = new File(uri);
    if (file.exists) file.delete();
  }

  async cleanupExpiredTemporary(nowMs: number, currentUri?: string) {
    let deleted = 0;
    let failed = 0;
    try {
      temporaryDirectory.create({ idempotent: true, intermediates: true });
      for (const entry of temporaryDirectory.list()) {
        if (!(entry instanceof File) || !temporaryNamePattern.test(entry.name) || entry.uri === currentUri) continue;
        if (entry.lastModified === null || entry.lastModified >= nowMs - RETENTION_MS) continue;
        try { entry.delete(); deleted += 1; } catch { failed += 1; }
      }
    } catch {
      failed += 1;
    }
    return { deleted, failed };
  }

  async cleanupStaging() {
    try { removeDirectory(stagingRoot); } catch { /* best effort startup cleanup */ }
  }
}
