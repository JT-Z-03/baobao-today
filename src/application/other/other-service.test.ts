import type { OtherRepository } from '@/application/ports/other-repository';

import { createOtherService } from './other-service';

const nowMs = new Date(2026, 6, 11, 10, 30).getTime();

describe('other service', () => {
  test('coordinates stable request ids, CRUD, and history queries', async () => {
    const record = {
      id: 'other-1', type: 'other' as const, clientRequestId: 'request', createPayloadHash: 'a'.repeat(64),
      eventTimeMs: nowMs, recordDate: '2026-07-11', sortTimeMs: nowMs,
      createdAtMs: nowMs, updatedAtMs: nowMs, title: '洗澡', note: null,
    };
    const repository: OtherRepository = {
      create: jest.fn(async () => record),
      getById: jest.fn(async () => record),
      update: jest.fn(async () => record),
      delete: jest.fn(async () => undefined),
      listByDate: jest.fn(async () => [record]),
    };
    const service = createOtherService(repository, {
      now: () => nowMs, createId: () => 'other-1', createClientRequestId: () => 'request-1',
    });
    expect(service.createClientRequestId()).toBe('request-1');
    await service.create({ eventTimeMs: nowMs, title: '洗澡', note: null }, 'stable-request');
    expect(repository.create).toHaveBeenCalledWith({
      id: 'other-1', clientRequestId: 'stable-request', nowMs,
      input: { eventTimeMs: nowMs, title: '洗澡', note: null },
    });
    await service.update('other-1', { eventTimeMs: nowMs, title: '打嗝', note: null });
    expect(repository.update).toHaveBeenCalledWith(
      'other-1', { eventTimeMs: nowMs, title: '打嗝', note: null }, nowMs,
    );
    await expect(service.getHistory('2026-07-11')).resolves.toEqual([record]);
  });
});
