import { formatOtherClock, summarizeOtherNote } from './other-format';

describe('other record formatting', () => {
  test('formats local clock and omits empty note summaries', () => {
    expect(formatOtherClock(new Date(2026, 6, 11, 2, 5).getTime())).toBe('02:05');
    expect(summarizeOtherNote(null)).toBeNull();
    expect(summarizeOtherNote('   ')).toBeNull();
  });

  test('collapses display whitespace and safely truncates a long note', () => {
    expect(summarizeOtherNote('第一行\n第二行')).toBe('第一行 第二行');
    const summary = summarizeOtherNote('长'.repeat(60));
    expect(summary).toBe(`${'长'.repeat(40)}…`);
    expect([...summary!]).toHaveLength(41);
  });
});
