import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as Crypto from 'expo-crypto';
import { Directory, File, FileMode } from 'expo-file-system';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { BackupExportGateway } from '@/application/ports/backup-export';

const CHUNK_BYTES = 64 * 1024;
const MAX_BYTES = 512 * 1024 * 1024;
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class ExpoBackupExportGateway implements BackupExportGateway {
  async fingerprint(uri: string) {
    const handle = new File(uri).open(FileMode.ReadOnly);
    try {
      const byteLength = handle.size;
      if (byteLength === null || byteLength <= 0 || byteLength > MAX_BYTES) throw new Error('备份文件大小无效');
      const hash = sha256.create();
      let offset = 0;
      while (offset < byteLength) {
        const bytes = handle.readBytes(Math.min(CHUNK_BYTES, byteLength - offset));
        if (!bytes.length) throw new Error('备份文件读取中断');
        hash.update(bytes); offset += bytes.length;
        if (offset % (CHUNK_BYTES * 16) === 0) await yieldToUi();
      }
      return { byteLength, sha256: bytesToHex(hash.digest()) };
    } finally { handle.close(); }
  }

  async chooseTarget(filename: string) {
    let directory: Directory;
    try { directory = await Directory.pickDirectoryAsync(); }
    catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (/cancel/i.test(code) || /cancel/i.test(String(error))) return null;
      // Expo 57 can lose this launcher after Android recreates the activity
      // (for example after a font-scale change). SAF opens the same system
      // chooser through the legacy activity callback; it still requires a grant.
      if (Platform.OS === 'android' && /unregistered ActivityResultLauncher/.test(String(error))) {
        const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permission.granted) return null;
        directory = new Directory(permission.directoryUri);
      } else {
        throw new Error('暂时无法打开保存位置，请稍后重试或重新打开应用');
      }
    }
    const safeName = filename.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/\.zip$/i, '');
    const file = directory.createFile(`${safeName}-${Crypto.randomUUID().slice(0, 8)}.zip`, 'application/zip');
    const name = directory.name || '所选位置';
    const location = directory.uri.startsWith('content://com.android.externalstorage.documents/')
      ? name.replace(/^primary:/, '') : name;
    return { uri: file.uri, filename: file.name, location };
  }

  async write(sourceUri: string, targetUri: string) {
    const source = new File(sourceUri).open(FileMode.ReadOnly);
    try {
      const size = source.size;
      if (size === null || size <= 0 || size > MAX_BYTES) throw new Error('备份文件大小无效');
      const target = new File(targetUri).open(FileMode.WriteOnly);
      try {
        let copied = 0;
        while (copied < size) {
          const bytes = source.readBytes(Math.min(CHUNK_BYTES, size - copied));
          if (!bytes.length) throw new Error('读取备份中断，请重试');
          target.writeBytes(bytes); copied += bytes.length;
          if (copied % (CHUNK_BYTES * 16) === 0) await yieldToUi();
        }
      } finally { target.close(); }
    } finally { source.close(); }
  }

  async deleteCreated(uri: string) { const file = new File(uri); if (file.exists) file.delete(); }
}
