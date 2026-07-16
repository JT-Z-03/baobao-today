import type { PoopRecord } from '@/domain/poop/poop';

export const POOP_COLOR_LABELS = {
  yellow: '黄色', green: '绿色', brown: '棕色', black: '黑色', red: '红色', other: '其他',
} as const;
export const POOP_TEXTURE_LABELS = {
  watery: '稀', soft: '稀软', mushy: '糊状', formed: '成形', pellet: '颗粒',
} as const;
export const POOP_AMOUNT_LABELS = { small: '少', medium: '中', large: '多' } as const;

export function formatPoopDetails(record: Pick<PoopRecord, 'color' | 'texture' | 'amount' | 'photoUri'>) {
  return [
    record.color ? POOP_COLOR_LABELS[record.color] : null,
    record.texture ? POOP_TEXTURE_LABELS[record.texture] : null,
    record.amount ? POOP_AMOUNT_LABELS[record.amount] : null,
    record.photoUri ? '有照片' : null,
  ].filter(Boolean).join(' · ');
}
