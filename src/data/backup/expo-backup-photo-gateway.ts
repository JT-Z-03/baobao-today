import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';

import type { BackupPhotoGateway } from '@/application/ports/backup';
import { BACKUP_ARCHIVE_LIMITS } from '@/data/backup/fflate-backup-archive-gateway';
import { isManagedPoopPhotoPath } from '@/data/photo/managed-photo-path';

const photosDirectory = new Directory(Paths.document, 'poop-photos');

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fileHash(file: File, expectedMaximum = BACKUP_ARCHIVE_LIMITS.photoBytes) {
  if (!file.exists || file.size <= 0 || file.size > expectedMaximum) throw new Error('照片不存在或大小超出完整备份限制');
  const bytes = await file.bytes();
  return {
    bytes,
    byteLength: bytes.length,
    sha256: hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)),
  };
}

function managedFile(relativePath: string) {
  if (!isManagedPoopPhotoPath(relativePath)) throw new Error('照片路径不属于App受管理目录');
  return new File(Paths.document, relativePath);
}

function restoredPath(sessionId: string, recordId: string) {
  const token = `${sessionId}-${recordId}`.replace(/[^A-Za-z0-9_-]/g, '_');
  if (!token || token.length > 220) throw new Error('恢复照片标识无效');
  return `poop-photos/restore-${token}.jpg`;
}

export class ExpoBackupPhotoGateway implements BackupPhotoGateway {
  async inspectManaged(relativePath: string) {
    const file = managedFile(relativePath);
    const info = await fileHash(file);
    return { relativePath, uri: file.uri, byteLength: info.byteLength, sha256: info.sha256 };
  }

  async validateStaged(uri: string, byteLength: number, sha256: string) {
    const file = new File(uri);
    const info = await fileHash(file);
    if (info.byteLength !== byteLength || info.sha256 !== sha256) throw new Error('备份照片完整性校验失败');
    if (info.bytes.length < 4 || info.bytes[0] !== 0xff || info.bytes[1] !== 0xd8
      || info.bytes.at(-2) !== 0xff || info.bytes.at(-1) !== 0xd9) {
      throw new Error('备份照片不是有效的JPEG图片');
    }
    const context = ImageManipulator.manipulate(file.uri);
    const image = await context.renderAsync();
    image.release();
    context.release();
  }

  async restoreStaged(uri: string, restoreSessionId: string, recordId: string, byteLength: number, sha256: string) {
    await this.validateStaged(uri, byteLength, sha256);
    photosDirectory.create({ idempotent: true, intermediates: true });
    const relativePath = restoredPath(restoreSessionId, recordId);
    const target = managedFile(relativePath);
    await new File(uri).copy(target, { overwrite: false });
    try {
      const restored = await fileHash(target);
      if (restored.byteLength !== byteLength || restored.sha256 !== sha256) throw new Error('恢复照片写入后校验失败');
      return relativePath;
    } catch (error) {
      if (target.exists) target.delete();
      throw error;
    }
  }

  async deleteManaged(relativePath: string) {
    const file = managedFile(relativePath);
    if (file.exists) file.delete();
  }
}
