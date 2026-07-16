import type { PeeAmount, PeeColor, PeeRecord } from '@/domain/pee/pee';

export const PEE_AMOUNT_LABELS: Record<PeeAmount, string> = {
  small: '少',
  medium: '中',
  large: '多',
};

export const PEE_COLOR_LABELS: Record<PeeColor, string> = {
  clear: '透明',
  light_yellow: '淡黄',
  yellow: '黄色',
  dark_yellow: '深黄',
};

export function formatPeeDetails(record: Pick<PeeRecord, 'amount' | 'color'>) {
  return [
    record.amount ? PEE_AMOUNT_LABELS[record.amount] : null,
    record.color ? PEE_COLOR_LABELS[record.color] : null,
  ].filter(Boolean).join(' · ');
}
