import type { SleepRepository } from '@/application/ports/sleep-repository';
import type { CompletedSleepRecord, SleepingRecord } from '@/domain/sleep/sleep';

import { createSleepService } from './sleep-service';

const startMs = new Date(2026, 6, 10, 23, 0).getTime();
const endMs = new Date(2026, 6, 11, 2, 0).getTime();

const active: SleepingRecord = {
  id: 'sleep-1', type: 'sleep', clientRequestId: 'request-1', createPayloadHash: 'a'.repeat(64),
  eventTimeMs: startMs, recordDate: '2026-07-10', sortTimeMs: startMs,
  createdAtMs: startMs, updatedAtMs: startMs, note: null,
  startMs, endMs: null, status: 'sleeping',
};
const completed: CompletedSleepRecord = { ...active, status: 'completed', endMs };

function repositoryStub(overrides: Partial<SleepRepository> = {}): SleepRepository {
  return {
    start: jest.fn(async () => ({ record: active, outcome: 'created' as const })),
    getByClientRequestId: jest.fn(async (_id: string) => null),
    getById: jest.fn(async () => active),
    getActive: jest.fn(async () => active),
    finish: jest.fn(async () => ({ record: completed, outcome: 'completed' as const })),
    updateActive: jest.fn(async () => active),
    updateCompleted: jest.fn(async () => completed),
    delete: jest.fn(async () => undefined),
    listByStartDate: jest.fn(async () => [completed]),
    listTimelineSources: jest.fn(async () => [completed]),
    getDailyCompletedTotalMs: jest.fn(async () => 2 * 60 * 60 * 1_000),
    ...overrides,
  };
}

describe('sleep service', () => {
  test('creates stable request ids outside start and coordinates generated record ids', async () => {
    const repository = repositoryStub();
    const service = createSleepService(repository, {
      now: () => startMs, createId: () => 'sleep-id', createClientRequestId: () => 'request-id',
    });
    expect(service.createClientRequestId()).toBe('request-id');
    await service.start({ startMs, note: null }, 'stable-request');
    expect(repository.start).toHaveBeenCalledWith({
      id: 'sleep-id', clientRequestId: 'stable-request', input: { startMs, note: null }, nowMs: startMs,
    });
  });

  test('builds the selected-day timeline from occurrence projections', async () => {
    const repository = repositoryStub({ getActive: jest.fn(async () => null) });
    const service = createSleepService(repository, {
      now: () => endMs, createId: () => 'id', createClientRequestId: () => 'request',
    });
    await expect(service.getDashboard('2026-07-11')).resolves.toMatchObject({
      active: null,
      completedTotalMs: 2 * 60 * 60 * 1_000,
      timeline: [{ type: 'sleep-occurrence', recordId: 'sleep-1', kind: 'sleep-end', occurrenceTimeMs: endMs }],
      refreshedAtMs: endMs,
    });
  });

  test('finishes with the current time and delegates state-specific updates', async () => {
    const repository = repositoryStub();
    const service = createSleepService(repository, {
      now: () => endMs, createId: () => 'id', createClientRequestId: () => 'request',
    });
    await service.finish('sleep-1');
    expect(repository.finish).toHaveBeenCalledWith('sleep-1', endMs, endMs);
    await service.finishAt('sleep-1', endMs - 1);
    expect(repository.finish).toHaveBeenCalledWith('sleep-1', endMs - 1, endMs);
    await service.updateActive('sleep-1', { startMs, note: 'active' });
    expect(repository.updateActive).toHaveBeenCalledWith('sleep-1', { startMs, note: 'active' }, endMs);
    await service.updateCompleted('sleep-1', { startMs, endMs, note: 'done' });
    expect(repository.updateCompleted).toHaveBeenCalledWith('sleep-1', { startMs, endMs, note: 'done' }, endMs);
  });
});
