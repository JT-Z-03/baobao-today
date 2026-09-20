import type { PeeRepository } from '@/application/ports/pee-repository';
import type { PeeRecord } from '@/domain/pee/pee';

import { createPeeService } from './pee-service';

const record: PeeRecord = {
  id: 'pee-1', type: 'pee', clientRequestId: 'request-1', createPayloadHash: 'a'.repeat(64),
  eventTimeMs: 100, recordDate: '1970-01-01', sortTimeMs: 100,
  createdAtMs: 100, updatedAtMs: 100, amount: null, color: null, note: null,
};

describe('pee service', () => {
  test('coordinates stable IDs, typed writes, and fresh SQLite queries', async () => {
    const repository: PeeRepository = {
      create: jest.fn(async () => record),
      getByClientRequestId: jest.fn(async (_id: string) => record),
      getById: jest.fn(async () => record),
      update: jest.fn(async () => record),
      delete: jest.fn(async () => undefined),
      listByDate: jest.fn(async () => [record]),
      getDailyCount: jest.fn(async () => 1),
    };
    const service = createPeeService(repository, {
      now: () => 100,
      createId: () => 'pee-1',
      createClientRequestId: () => 'request-1',
    });
    const input = { eventTimeMs: 100, amount: null, color: null, note: null };

    expect(service.createClientRequestId()).toBe('request-1');
    await expect(service.getByClientRequestId('request-1')).resolves.toEqual(record);
    expect(repository.getByClientRequestId).toHaveBeenCalledWith('request-1');
    await service.create(input, 'request-1');
    expect(repository.create).toHaveBeenCalledWith({ id: 'pee-1', clientRequestId: 'request-1', input, nowMs: 100 });
    await expect(service.getHistory('1970-01-01')).resolves.toEqual([record]);
    await expect(service.getDailyCount('1970-01-01')).resolves.toBe(1);
  });

  test('routes create, update, and delete through the shared backup/restore operation coordinator', async () => {
    const repository: PeeRepository = {
      create: jest.fn(async () => record), getById: jest.fn(async () => record),
      getByClientRequestId: jest.fn(async () => null),
      update: jest.fn(async () => record), delete: jest.fn(async () => undefined),
      listByDate: jest.fn(async () => []), getDailyCount: jest.fn(async () => 0),
    };
    const coordinator = { busy: false, runExclusive: jest.fn(async (operation: () => Promise<unknown>) => operation()) };
    const service = createPeeService(repository, {
      now: () => 100, createId: () => 'pee-1', createClientRequestId: () => 'request-1',
      operationCoordinator: coordinator,
    } as never);
    const input = { eventTimeMs: 100, amount: null, color: null, note: null };
    await service.create(input, 'request-1');
    await service.update('pee-1', input);
    await service.delete('pee-1');
    expect(coordinator.runExclusive).toHaveBeenCalledTimes(3);
  });
});
