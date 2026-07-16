import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/.{2}/g)!.map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('semantic design tokens', () => {
  test.each(['light', 'dark'] as const)('%s theme exposes the complete semantic palette', (mode) => {
    expect(Colors[mode]).toEqual(expect.objectContaining({
      background: expect.any(String),
      surface: expect.any(String),
      surfaceElevated: expect.any(String),
      textPrimary: expect.any(String),
      textSecondary: expect.any(String),
      textMuted: expect.any(String),
      border: expect.any(String),
      divider: expect.any(String),
      primary: expect.any(String),
      primaryPressed: expect.any(String),
      primaryContainer: expect.any(String),
      success: expect.any(String),
      warning: expect.any(String),
      danger: expect.any(String),
      disabled: expect.any(String),
      overlay: expect.any(String),
      feeding: expect.any(String),
      poop: expect.any(String),
      pee: expect.any(String),
      sleep: expect.any(String),
      other: expect.any(String),
    }));
    expect(contrast(Colors[mode].textPrimary, Colors[mode].background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(Colors[mode].primaryText, Colors[mode].primary)).toBeGreaterThanOrEqual(4.5);
  });

  test('spacing, radius and typography use the approved finite scales', () => {
    expect(Object.values(SpacingScale)).toEqual([4, 8, 12, 16, 20, 24, 32]);
    expect(Object.values(Radius)).toEqual([4, 6, 8]);
    expect(Typography).toEqual(expect.objectContaining({
      pageTitle: expect.objectContaining({ fontSize: 30, lineHeight: 38 }),
      sectionTitle: expect.objectContaining({ fontSize: 20, lineHeight: 28 }),
      keyNumber: expect.objectContaining({ fontSize: 24, lineHeight: 32 }),
      body: expect.objectContaining({ fontSize: 16, lineHeight: 24 }),
      label: expect.objectContaining({ fontSize: 14, lineHeight: 20 }),
      error: expect.objectContaining({ fontSize: 14, lineHeight: 20 }),
    }));
  });
});

const SpacingScale = {
  xs: Spacing.xs,
  sm: Spacing.sm,
  md: Spacing.md,
  lg: Spacing.lg,
  xl: Spacing.xl,
  xxl: Spacing.xxl,
  xxxl: Spacing.xxxl,
};
