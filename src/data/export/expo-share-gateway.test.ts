import * as Sharing from 'expo-sharing';

import { ExpoShareGateway } from './expo-share-gateway';

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

describe('ExpoShareGateway', () => {
  test('checks availability and shares only the local CSV URI with system metadata', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
    const gateway = new ExpoShareGateway();

    await expect(gateway.isAvailable()).resolves.toBe(true);
    await gateway.share('file:///cache/exports/records.csv', 'records.csv');

    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/exports/records.csv', {
      dialogTitle: '分享宝宝今天CSV记录',
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    });
  });
});
