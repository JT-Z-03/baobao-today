import type { PoopRecord } from '@/domain/poop/poop';

import { formatPoopDetails } from './poop-format';

const record = {
  color: null,
  texture: null,
  amount: null,
  photoUri: null,
} as PoopRecord;

describe('poop formatting', () => {
  test('omits all empty optional classifications', () => {
    expect(formatPoopDetails(record)).toBe('');
  });

  test('uses product labels and includes a photo marker', () => {
    expect(formatPoopDetails({
      ...record,
      color: 'yellow',
      texture: 'soft',
      amount: 'medium',
      photoUri: 'poop-photos/photo.jpg',
    })).toBe('黄色 · 稀软 · 中 · 有照片');
  });
});
