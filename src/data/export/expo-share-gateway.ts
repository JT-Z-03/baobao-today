import * as Sharing from 'expo-sharing';

import type { ShareGateway } from '@/application/ports/export';

export class ExpoShareGateway implements ShareGateway {
  isAvailable() {
    return Sharing.isAvailableAsync();
  }

  share(uri: string, _filename: string) {
    return Sharing.shareAsync(uri, {
      dialogTitle: '分享宝宝今天CSV记录',
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    });
  }
}
