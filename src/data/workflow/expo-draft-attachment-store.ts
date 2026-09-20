import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { LocalPhotoSource } from '@/domain/poop/poop';

const directory = new Directory(Paths.document, 'draft-attachments');

export class ExpoDraftAttachmentStore {
  isManaged(uri: string) { return uri.startsWith(`${directory.uri.replace(/\/$/, '')}/`); }
  async persist(source: LocalPhotoSource): Promise<LocalPhotoSource> {
    if (this.isManaged(source.uri)) {
      if (!new File(source.uri).exists) throw new Error('草稿照片不存在，请重新选择');
      return source;
    }
    directory.create({ idempotent: true, intermediates: true });
    const target = new File(directory, `${Crypto.randomUUID()}.image`);
    try {
      const original = new File(source.uri);
      if (!original.exists || original.size <= 0) throw new Error('所选照片已不可用');
      await original.copy(target, { overwrite: false });
      if (target.size !== original.size || !target.md5 || target.md5 !== original.md5) {
        throw new Error('草稿照片保存校验失败，请重新选择');
      }
      return { ...source, uri: target.uri };
    } catch (error) {
      if (target.exists) target.delete(); throw error;
    }
  }
  async remove(uri: string) {
    if (!this.isManaged(uri)) return;
    const file = new File(uri); if (file.exists) file.delete();
  }
  async cleanup(references: ReadonlySet<string>, olderThanMs: number) {
    if (!directory.exists) return;
    for (const file of directory.list()) {
      if (file instanceof File && !references.has(file.uri) && file.lastModified !== null && file.lastModified < olderThanMs) {
        file.delete();
      }
    }
  }
}
