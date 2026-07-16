import type { PeeRecord } from '@/domain/pee/pee';

import { formatPeeDetails } from './pee-format';

const record = { type: 'pee', amount: null, color: null, note: null } as PeeRecord;

describe('pee formatting', () => {
  test('omits separators and placeholders for empty optional fields', () => {
    expect(formatPeeDetails(record)).toBe('');
  });

  test('formats amount and color in product order', () => {
    expect(formatPeeDetails({ ...record, amount: 'medium', color: 'light_yellow' })).toBe('中 · 淡黄');
    expect(formatPeeDetails({ ...record, color: 'clear' })).toBe('透明');
  });
});
