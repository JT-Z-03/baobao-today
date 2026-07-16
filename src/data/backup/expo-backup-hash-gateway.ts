import * as Crypto from 'expo-crypto';

import type { BackupHashGateway } from '@/application/ports/backup';

export class ExpoBackupHashGateway implements BackupHashGateway {
  sha256Text(content: string) {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content, {
      encoding: Crypto.CryptoEncoding.HEX,
    });
  }
}
