import type { PhotoStore, PreparedPhoto } from '@/application/ports/photo-store';
import type {
  CreatePoopCommand,
  PoopRepository,
  UpdatePoopPersistenceInput,
} from '@/application/ports/poop-repository';
import type { PoopCoreInput, PoopRecord } from '@/domain/poop/poop';
import { IdempotencyConflictError } from '@/domain/records/idempotency';

import { createPoopService } from './poop-service';

const nowMs = new Date(2026, 6, 11, 8, 0).getTime();
const core: PoopCoreInput = {
  eventTimeMs: nowMs,
  color: null,
  texture: null,
  amount: null,
  note: null,
};
const source = { uri: 'file:///picker/photo.jpg', width: 3000, height: 2000 };

function record(overrides: Partial<PoopRecord> = {}): PoopRecord {
  return {
    id: 'poop-1', type: 'poop', clientRequestId: 'request-1', createPayloadHash: 'a'.repeat(64),
    ...core, photoUri: null, recordDate: '2026-07-11', sortTimeMs: nowMs,
    createdAtMs: nowMs, updatedAtMs: nowMs, ...overrides,
  };
}

class FakeRepository implements PoopRepository {
  records = new Map<string, PoopRecord>();
  failCreate = false;
  failUpdate = false;
  failDelete = false;
  createCalls: CreatePoopCommand[] = [];
  createPayloads = new Map<string, string>();

  async create(command: CreatePoopCommand) {
    this.createCalls.push(command);
    if (this.failCreate) throw new Error('db create failed');
    const existing = [...this.records.values()].find((item) => item.clientRequestId === command.clientRequestId);
    const payload = JSON.stringify({
      input: command.input,
      photoUri: command.photoUri,
      photoContentFingerprint: command.photoContentFingerprint,
    });
    if (existing) {
      if (this.createPayloads.get(command.clientRequestId) !== payload) {
        throw new IdempotencyConflictError(command.clientRequestId);
      }
      return existing;
    }
    const created = record({
      id: command.id,
      clientRequestId: command.clientRequestId,
      ...command.input,
      photoUri: command.photoUri,
    });
    this.records.set(created.id, created);
    this.createPayloads.set(command.clientRequestId, payload);
    return created;
  }
  async getById(id: string) { return this.records.get(id) ?? null; }
  async getByClientRequestId(clientRequestId: string) {
    return [...this.records.values()].find((item) => item.clientRequestId === clientRequestId) ?? null;
  }
  async update(id: string, input: UpdatePoopPersistenceInput) {
    if (this.failUpdate) throw new Error('db update failed');
    const existing = this.records.get(id);
    if (!existing) throw new Error('missing');
    const updated = { ...existing, ...input, updatedAtMs: nowMs + 1 };
    this.records.set(id, updated);
    return updated;
  }
  async delete(id: string) {
    if (this.failDelete) throw new Error('db delete failed');
    this.records.delete(id);
  }
  async listByDate() { return [...this.records.values()]; }
  async getDailyCount() { return this.records.size; }
  async listReferencedPhotoPaths() {
    return [...this.records.values()].flatMap((item) => item.photoUri ? [item.photoUri] : []);
  }
}

class FakePhotoStore implements PhotoStore {
  prepared: PreparedPhoto[] = [];
  committed: string[] = [];
  discarded: string[] = [];
  deleted: string[] = [];
  managed: string[] = [];
  failDelete = false;
  fingerprints: string[] = [];
  lastModified = new Map<string, number>();

  async prepare(sourcePhoto: { uri: string }) {
    const photo = {
      temporaryUri: `file:///cache/${this.prepared.length}.jpg`,
      contentFingerprint: this.fingerprints.shift() ?? `fingerprint:${sourcePhoto.uri}`,
    };
    this.prepared.push(photo);
    return photo;
  }
  async commit(_prepared: PreparedPhoto, relativePath: string) {
    this.committed.push(relativePath);
    if (!this.managed.includes(relativePath)) this.managed.push(relativePath);
    this.lastModified.set(relativePath, nowMs);
  }
  async discard(prepared: PreparedPhoto) { this.discarded.push(prepared.temporaryUri); }
  async resolve(relativePath: string) {
    return this.managed.includes(relativePath) ? `file:///documents/${relativePath}` : null;
  }
  async deleteManaged(relativePath: string) {
    this.deleted.push(relativePath);
    if (this.failDelete) throw new Error('file delete failed');
    this.managed = this.managed.filter((item) => item !== relativePath);
    this.lastModified.delete(relativePath);
  }
  async listManaged() {
    return this.managed.map((relativePath) => ({
      relativePath,
      lastModifiedMs: this.lastModified.get(relativePath) ?? 0,
    }));
  }
}

function setup() {
  const repository = new FakeRepository();
  const photoStore = new FakePhotoStore();
  let id = 0;
  const service = createPoopService(repository, photoStore, {
    now: () => nowMs,
    createId: () => `poop-${++id}`,
    createClientRequestId: () => 'request-generated',
    createPhotoId: () => `photo-${++id}`,
  });
  return { repository, photoStore, service };
}

describe('poop application service photo compensation', () => {
  test('keeps a managed photo after a successful create', async () => {
    const { repository, photoStore, service } = setup();
    const result = await service.create({ ...core, photo: source }, 'request-1');
    expect(result.photoUri).toBe('poop-photos/request-1.jpg');
    expect(repository.createCalls[0]?.photoContentFingerprint).toBe('fingerprint:file:///picker/photo.jpg');
    expect(photoStore.committed).toEqual(['poop-photos/request-1.jpg']);
    expect(photoStore.deleted).toEqual([]);
  });

  test('cleans the new managed photo when create fails', async () => {
    const { repository, photoStore, service } = setup();
    repository.failCreate = true;
    await expect(service.create({ ...core, photo: source }, 'request-1')).rejects.toThrow('db create failed');
    expect(photoStore.deleted).toEqual(['poop-photos/request-1.jpg']);
    expect(photoStore.discarded).toHaveLength(1);
  });

  test('serializes rapid duplicates and creates only one managed photo', async () => {
    const { repository, photoStore, service } = setup();
    const [first, second] = await Promise.all([
      service.create({ ...core, photo: source }, 'request-1'),
      service.create({ ...core, photo: source }, 'request-1'),
    ]);
    expect(second).toEqual(first);
    expect(repository.createCalls).toHaveLength(2);
    expect(photoStore.prepared).toHaveLength(2);
    expect(photoStore.committed).toHaveLength(1);
  });

  test('uses normalized photo content rather than temporary URI for concurrent idempotency', async () => {
    const sameContent = setup();
    sameContent.photoStore.fingerprints.push('same-content', 'same-content');
    const [first, repeated] = await Promise.all([
      sameContent.service.create({ ...core, photo: source }, 'request-1'),
      sameContent.service.create({ ...core, photo: { ...source, uri: 'file:///other/path.jpg' } }, 'request-1'),
    ]);
    expect(repeated).toEqual(first);
    expect(sameContent.photoStore.committed).toHaveLength(1);

    const changedContent = setup();
    changedContent.photoStore.fingerprints.push('content-a', 'content-b');
    const firstCreate = changedContent.service.create({ ...core, photo: source }, 'request-1');
    const conflictingCreate = changedContent.service.create({ ...core, photo: source }, 'request-1');
    await expect(firstCreate).resolves.toBeDefined();
    await expect(conflictingCreate).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(changedContent.photoStore.committed).toHaveLength(1);
  });

  test('replaces only after DB success and cleans the old photo', async () => {
    const { repository, photoStore, service } = setup();
    repository.records.set('poop-1', record({ photoUri: 'poop-photos/old.jpg' }));
    photoStore.managed.push('poop-photos/old.jpg');
    const updated = await service.update('poop-1', { ...core, photoChange: { kind: 'replace', source } });
    expect(updated.photoUri).toBe('poop-photos/photo-1.jpg');
    expect(photoStore.deleted).toEqual(['poop-photos/old.jpg']);
  });

  test('keeps old photo and cleans new photo when replacement DB update fails', async () => {
    const { repository, photoStore, service } = setup();
    repository.records.set('poop-1', record({ photoUri: 'poop-photos/old.jpg' }));
    repository.failUpdate = true;
    await expect(service.update('poop-1', { ...core, photoChange: { kind: 'replace', source } }))
      .rejects.toThrow('db update failed');
    expect(photoStore.deleted).toEqual(['poop-photos/photo-1.jpg']);
    expect(repository.records.get('poop-1')?.photoUri).toBe('poop-photos/old.jpg');
  });

  test('removes the DB reference before deleting the old photo', async () => {
    const { repository, photoStore, service } = setup();
    repository.records.set('poop-1', record({ photoUri: 'poop-photos/old.jpg' }));
    const updated = await service.update('poop-1', { ...core, photoChange: { kind: 'remove' } });
    expect(updated.photoUri).toBeNull();
    expect(photoStore.deleted).toEqual(['poop-photos/old.jpg']);
  });

  test('keeps successful replacement and removal updates when old-file deletion fails', async () => {
    const replacement = setup();
    replacement.repository.records.set('poop-1', record({ photoUri: 'poop-photos/old.jpg' }));
    replacement.photoStore.failDelete = true;
    await expect(replacement.service.update('poop-1', {
      ...core,
      photoChange: { kind: 'replace', source },
    })).resolves.toMatchObject({ photoUri: 'poop-photos/photo-1.jpg' });

    const removal = setup();
    removal.repository.records.set('poop-1', record({ photoUri: 'poop-photos/old.jpg' }));
    removal.photoStore.failDelete = true;
    await expect(removal.service.update('poop-1', {
      ...core,
      photoChange: { kind: 'remove' },
    })).resolves.toMatchObject({ photoUri: null });
  });

  test('does not delete the old photo when remove update fails', async () => {
    const { repository, photoStore, service } = setup();
    repository.records.set('poop-1', record({ photoUri: 'poop-photos/old.jpg' }));
    repository.failUpdate = true;
    await expect(service.update('poop-1', { ...core, photoChange: { kind: 'remove' } })).rejects.toThrow();
    expect(photoStore.deleted).toEqual([]);
  });

  test('deletes DB first, tolerates file deletion failure, and never deletes on DB failure', async () => {
    const first = setup();
    first.repository.records.set('poop-1', record({ photoUri: 'poop-photos/old.jpg' }));
    first.photoStore.failDelete = true;
    await expect(first.service.delete('poop-1')).resolves.toBeUndefined();
    expect(first.repository.records.has('poop-1')).toBe(false);

    const second = setup();
    second.repository.records.set('poop-1', record({ photoUri: 'poop-photos/old.jpg' }));
    second.repository.failDelete = true;
    await expect(second.service.delete('poop-1')).rejects.toThrow('db delete failed');
    expect(second.photoStore.deleted).toEqual([]);
  });

  test('cleans only unreferenced managed photos and resolves missing files safely', async () => {
    const { repository, photoStore, service } = setup();
    repository.records.set('poop-1', record({ photoUri: 'poop-photos/kept.jpg' }));
    photoStore.managed.push('poop-photos/kept.jpg', 'poop-photos/orphan.jpg');
    await expect(service.cleanupOrphanPhotos()).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(photoStore.deleted).toEqual(['poop-photos/orphan.jpg']);
    await expect(service.resolvePhoto('poop-photos/missing.jpg')).resolves.toBeNull();
  });

  test('never deletes a newly-created unreferenced file during orphan cleanup', async () => {
    const { photoStore, service } = setup();
    photoStore.managed.push('poop-photos/new.jpg');
    photoStore.lastModified.set('poop-photos/new.jpg', nowMs);
    await expect(service.cleanupOrphanPhotos()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(photoStore.deleted).toEqual([]);
  });
});
