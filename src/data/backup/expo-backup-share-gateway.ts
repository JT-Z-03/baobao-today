import * as Sharing from 'expo-sharing';

import type { BackupShareGateway } from '@/application/ports/backup';

export class ExpoBackupShareGateway implements BackupShareGateway {
  isAvailable() {
    return Sharing.isAvailableAsync();
  }

  async share(uri: string, filename: string) {
    await Sharing.shareAsync(uri, {
      dialogTitle: '分享《宝宝今天》完整备份',
      mimeType: 'application/zip',
      UTI: 'public.zip-archive',
    });
    void filename;
  }
}
