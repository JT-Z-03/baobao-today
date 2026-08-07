import type { FeedingRepository } from '@/application/ports/feeding-repository';
import type { FeedingRecord } from '@/domain/feeding/feeding';

import { createFeedingService } from './feeding-service';

const eventTimeMs = new Date(2026, 6, 11, 8, 0).getTime();
const record: FeedingRecord = {
  id: 'feeding-1',
  type: 'feeding',
  clientRequestId: 'request-1',
  createPayloadHash: 'a'.repeat(64),
  eventTimeMs,
  recordDate: '2026-07-11',
  sortTimeMs: eventTimeMs,
  createdAtMs: eventTimeMs,
  updatedAtMs: eventTimeMs,
  feedingType: 'formula',
  milkAmountMl: 60,
  breastMilkAmountMl: null,
  leftDurationMin: null,
  rightDurationMin: null,
  note: null,
};

function createRepository(): jest.Mocked<FeedingRepository> {
  return {
    create: jest.fn(async (_command) => record),
    getById: jest.fn(async (_id) => record),
    update: jest.fn(async (_id, _input, _nowMs) => record),
    delete: jest.fn(async (_id) => undefined),
    listByDate: jest.fn(async (_recordDate) => [record]),
    getLatest: jest.fn(async () => record),
    getLatestMilkAmount: jest.fn(async () => 90),
    getDailySummary: jest.fn(async (_recordDate) => ({
      feedingCount: 1,
      formulaTotalMl: 60,
      breastMilkTotalMl: 0,
      measurableTotalMl: 60,
    })),
  };
}

describe('feeding application service', () => {
  test('keeps the form request id stable while generating a business record id', async () => {
    const repository = createRepository();
    const service = createFeedingService(repository, {
      now: () => eventTimeMs,
      createId: () => 'new-record-id',
      createClientRequestId: () => 'new-request-id',
    });
    const input = {
      eventTimeMs,
      feedingType: 'formula' as const,
      milkAmountMl: 60,
      breastMilkAmountMl: null,
      leftDurationMin: null,
      rightDurationMin: null,
      note: null,
    };

    expect(service.createClientRequestId()).toBe('new-request-id');
    await service.create(input, 'stable-form-request');

    expect(repository.create).toHaveBeenCalledWith({
      id: 'new-record-id',
      clientRequestId: 'stable-form-request',
      input,
      nowMs: eventTimeMs,
    });
  });

  test('loads recent defaults and dashboard directly from repository queries', async () => {
    const repository = createRepository();
    const service = createFeedingService(repository, {
      now: () => eventTimeMs + 123,
      createId: () => 'id',
      createClientRequestId: () => 'request',
    });

    await expect(service.getNewRecordDefaults()).resolves.toEqual({
      eventTimeMs: eventTimeMs + 123,
      feedingType: 'formula',
      milkAmountMl: 90,
      breastMilkAmountMl: null,
    });
    await expect(service.getDashboard('2026-07-11')).resolves.toEqual({
      latest: record,
      timeline: [record],
      summary: {
        feedingCount: 1,
        formulaTotalMl: 60,
        breastMilkTotalMl: 0,
        measurableTotalMl: 60,
      },
      refreshedAtMs: eventTimeMs + 123,
    });

    expect(repository.getLatest).toHaveBeenCalledTimes(2);
    expect(repository.listByDate).toHaveBeenCalledWith('2026-07-11');
    expect(repository.getDailySummary).toHaveBeenCalledWith('2026-07-11');
  });

  test('uses the current clock for typed updates and delegates deletion', async () => {
    const repository = createRepository();
    const service = createFeedingService(repository, {
      now: () => eventTimeMs + 500,
      createId: () => 'id',
      createClientRequestId: () => 'request',
    });
    const update = {
      eventTimeMs,
      feedingType: 'breast' as const,
      milkAmountMl: null,
      breastMilkAmountMl: null,
      leftDurationMin: 10,
      rightDurationMin: 0,
      note: null,
    };

    await service.update('feeding-1', update);
    await service.delete('feeding-1');

    expect(repository.update).toHaveBeenCalledWith('feeding-1', update, eventTimeMs + 500);
    expect(repository.delete).toHaveBeenCalledWith('feeding-1');
  });

  test('reconciles the reminder after every persisted feeding mutation', async () => {
    const repository = createRepository();
    const syncFeedingReminder = jest.fn(async () => ({
      kind: 'disabled' as const,
      intervalMinutes: null,
      permissionStatus: 'granted' as const,
      latestFeedingEventTimeMs: null,
      syncErrorCode: null,
    }));
    const service = createFeedingService(repository, {
      now: () => eventTimeMs,
      createId: () => 'id',
      createClientRequestId: () => 'request',
      syncFeedingReminder,
    });
    const input = {
      eventTimeMs,
      feedingType: 'formula' as const,
      milkAmountMl: 60,
      breastMilkAmountMl: null,
      leftDurationMin: null,
      rightDurationMin: null,
      note: null,
    };

    await expect(service.create(input, 'request')).resolves.toMatchObject({ record });
    await expect(service.update('feeding-1', input)).resolves.toMatchObject({ record });
    await expect(service.delete('feeding-1')).resolves.toMatchObject({ reminderStatus: { kind: 'disabled' } });
    expect(syncFeedingReminder).toHaveBeenCalledTimes(3);
  });

  test('keeps a successful record mutation when reminder reconciliation throws', async () => {
    const repository = createRepository();
    const service = createFeedingService(repository, {
      now: () => eventTimeMs,
      createId: () => 'id',
      createClientRequestId: () => 'request',
      syncFeedingReminder: jest.fn(async () => { throw new Error('native scheduler unavailable'); }),
    });

    const result = await service.create({
      eventTimeMs,
      feedingType: 'formula',
      milkAmountMl: 60,
      breastMilkAmountMl: null,
      leftDurationMin: null,
      rightDurationMin: null,
      note: null,
    }, 'request');

    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(result.record).toBe(record);
    expect(result.reminderStatus).toMatchObject({
      kind: 'sync-error',
      errorCode: 'reconcile-failed',
    });
  });
});
