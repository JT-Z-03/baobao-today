import {
  FEEDING_REMINDER_BODY,
  FEEDING_REMINDER_TITLE,
  FeedingReminderValidationError,
  planFeedingReminder,
  validateFeedingReminderInterval,
} from './feeding-reminder-planner';

const nowMs = new Date(2026, 6, 11, 12, 0).getTime();
const latest = { id: 'feeding-1', eventTimeMs: nowMs - 30 * 60_000 };

describe('feeding reminder planner', () => {
  test('validates integer custom intervals from 15 minutes through 24 hours', () => {
    expect(validateFeedingReminderInterval(15)).toBe(15);
    expect(validateFeedingReminderInterval(120)).toBe(120);
    expect(validateFeedingReminderInterval(180)).toBe(180);
    expect(validateFeedingReminderInterval(1440)).toBe(1440);
    for (const invalid of [14, 1441, 15.5, Number.NaN]) {
      expect(() => validateFeedingReminderInterval(invalid)).toThrow(FeedingReminderValidationError);
    }
  });

  test('plans disabled, permission unavailable, and waiting-record states', () => {
    expect(planFeedingReminder({ intervalMinutes: null, permissionStatus: 'undetermined', latestFeeding: null, nowMs }))
      .toEqual({ kind: 'disabled' });
    expect(planFeedingReminder({ intervalMinutes: 120, permissionStatus: 'denied', latestFeeding: latest, nowMs }))
      .toEqual({ kind: 'permission-unavailable', permissionStatus: 'denied' });
    expect(planFeedingReminder({ intervalMinutes: 120, permissionStatus: 'undetermined', latestFeeding: latest, nowMs }))
      .toEqual({ kind: 'permission-unavailable', permissionStatus: 'undetermined' });
    expect(planFeedingReminder({ intervalMinutes: 120, permissionStatus: 'granted', latestFeeding: null, nowMs }))
      .toEqual({ kind: 'waiting-record' });
  });

  test.each([120, 180, 240])('adds %i minutes to the latest feeding event time', (intervalMinutes) => {
    expect(planFeedingReminder({ intervalMinutes, permissionStatus: 'granted', latestFeeding: latest, nowMs }))
      .toEqual({
        kind: 'scheduled',
        intervalMinutes,
        sourceRecordId: 'feeding-1',
        sourceEventTimeMs: latest.eventTimeMs,
        scheduledForMs: latest.eventTimeMs + intervalMinutes * 60_000,
      });
  });

  test('treats an equal or past trigger as expired and never requests an immediate catch-up', () => {
    const equal = { id: 'equal', eventTimeMs: nowMs - 120 * 60_000 };
    const past = { id: 'past', eventTimeMs: nowMs - 3 * 60 * 60_000 };
    expect(planFeedingReminder({ intervalMinutes: 120, permissionStatus: 'granted', latestFeeding: equal, nowMs }))
      .toEqual({ kind: 'expired', sourceRecordId: 'equal', scheduledForMs: nowMs });
    expect(planFeedingReminder({ intervalMinutes: 120, permissionStatus: 'granted', latestFeeding: past, nowMs }))
      .toEqual({ kind: 'expired', sourceRecordId: 'past', scheduledForMs: nowMs - 60 * 60_000 });
  });

  test('bases a backfilled record on event time rather than creation time', () => {
    const backfilled = { id: 'backfill', eventTimeMs: nowMs - 90 * 60_000, createdAtMs: nowMs };
    expect(planFeedingReminder({ intervalMinutes: 120, permissionStatus: 'granted', latestFeeding: backfilled, nowMs }))
      .toMatchObject({ kind: 'scheduled', scheduledForMs: nowMs + 30 * 60_000 });
  });

  test('uses neutral fixed copy without medical or feeding judgment', () => {
    expect(FEEDING_REMINDER_TITLE).toBe('喝奶记录提醒');
    expect(FEEDING_REMINDER_BODY).toBe('你设置的喝奶记录提醒到了。');
    expect(`${FEEDING_REMINDER_TITLE}${FEEDING_REMINDER_BODY}`)
      .not.toMatch(/该喝奶|饿了|必须|异常|立即喂奶|间隔过长/);
  });
});
