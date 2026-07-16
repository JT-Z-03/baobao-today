import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { PhotoStore, PreparedPhoto } from '@/application/ports/photo-store';
import { isManagedPoopPhotoPath } from '@/data/photo/managed-photo-path';
import type { LocalPhotoSource } from '@/domain/poop/poop';

const MAX_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const directory = new Directory(Paths.document, 'poop-photos');

function fileFor(relativePath: string) {
  if (!isManagedPoopPhotoPath(relativePath)) {
    throw new Error('拒绝访问受管理大便照片目录之外的文件');
  }
  return new File(Paths.document, relativePath);
}

export class ExpoPhotoStore implements PhotoStore {
  async prepare(source: LocalPhotoSource): Promise<PreparedPhoto> {
    const context = ImageManipulator.manipulate(source.uri);
    if (source.width > MAX_LONG_EDGE || source.height > MAX_LONG_EDGE) {
      if (source.width >= source.height) context.resize({ width: MAX_LONG_EDGE, height: null });
      else context.resize({ width: null, height: MAX_LONG_EDGE });
    }
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    const temporary = new File(result.uri);
    if (!temporary.md5) {
      if (temporary.exists) temporary.delete();
      throw new Error('无法计算照片内容指纹，请重新选择照片');
    }
    return { temporaryUri: temporary.uri, contentFingerprint: temporary.md5 };
  }

  async commit(prepared: PreparedPhoto, relativePath: string) {
    directory.create({ idempotent: true, intermediates: true });
    const source = new File(prepared.temporaryUri);
    if (!source.exists) throw new Error('待保存照片已不可用，请重新选择');
    await source.copy(fileFor(relativePath), { overwrite: true });
  }

  async discard(prepared: PreparedPhoto) {
    const file = new File(prepared.temporaryUri);
    if (file.exists) file.delete();
  }

  async resolve(relativePath: string) {
    const file = fileFor(relativePath);
    return file.exists ? file.uri : null;
  }

  async deleteManaged(relativePath: string) {
    const file = fileFor(relativePath);
    if (file.exists) file.delete();
  }

  async listManaged() {
    if (!directory.exists) return [];
    return directory
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => ({
        relativePath: `poop-photos/${file.name}`,
        lastModifiedMs: file.lastModified ?? Date.now(),
      }))
      .filter((entry) => isManagedPoopPhotoPath(entry.relativePath));
  }
}

export const POOP_PHOTO_NORMALIZATION = {
  maxLongEdge: MAX_LONG_EDGE,
  format: 'jpeg',
  quality: JPEG_QUALITY,
} as const;
