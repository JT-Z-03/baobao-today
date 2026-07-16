import * as DocumentPicker from 'expo-document-picker';

import type { BackupDocumentPickerGateway } from '@/application/ports/backup';

export class ExpoBackupDocumentPickerGateway implements BackupDocumentPickerGateway {
  async pickBackup() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/octet-stream', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return { canceled: true as const };
    const asset = result.assets[0];
    return {
      canceled: false as const,
      uri: asset.uri,
      name: asset.name,
      size: asset.size ?? null,
    };
  }
}
