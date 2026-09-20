import type { PhotoStore } from '@/application/ports/photo-store';
import type { BackupOperationCoordinator } from '@/application/ports/backup';
import type { PoopRepository } from '@/application/ports/poop-repository';
import { createPoopPhotoPath } from '@/data/photo/managed-photo-path';
import type { PoopCreateInput, PoopUpdateInput } from '@/domain/poop/poop';
import { normalizeAndValidatePoopInput } from '@/domain/poop/poop-validation';

export interface PoopServiceDependencies {
  now(): number;
  createId(): string;
  createClientRequestId(): string;
  createPhotoId(): string;
  operationCoordinator?: BackupOperationCoordinator;
  assertCurrentDataset?(): Promise<void>;
}

const ORPHAN_PHOTO_MIN_AGE_MS = 24 * 60 * 60 * 1_000;

function createAsyncQueue() {
  let tail = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>) {
      const result = tail.then(task, task);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

const photoOperationQueue = createAsyncQueue();

export function createPoopService(
  repository: PoopRepository,
  photoStore: PhotoStore,
  dependencies: PoopServiceDependencies,
) {
  const runMutation = <T,>(operation: () => Promise<T>) => {
    const guarded = async () => { await dependencies.assertCurrentDataset?.(); return operation(); };
    return dependencies.operationCoordinator?.runExclusive(guarded) ?? guarded();
  };
  const createQueues = new Map<string, Promise<void>>();

  async function bestEffortDelete(path: string | null) {
    if (!path) return;
    try {
      await photoStore.deleteManaged(path);
    } catch {
      // Startup orphan cleanup retries managed-file deletion.
    }
  }

  async function executeCreate(input: PoopCreateInput, clientRequestId: string) {
    const nowMs = dependencies.now();
    const normalized = normalizeAndValidatePoopInput(input, nowMs);
    if (!input.photo) {
      return repository.create({
        id: dependencies.createId(), clientRequestId, input: normalized,
        photoUri: null, photoContentFingerprint: null, nowMs,
      });
    }

    return photoOperationQueue.run(async () => {
      const prepared = await photoStore.prepare(input.photo!);
      const photoUri = createPoopPhotoPath(clientRequestId);
      let committed = false;
      try {
        const existing = await repository.getByClientRequestId(clientRequestId);
        if (!existing) {
          await photoStore.commit(prepared, photoUri);
          committed = true;
        }
        return await repository.create({
          id: dependencies.createId(), clientRequestId, input: normalized,
          photoUri, photoContentFingerprint: prepared.contentFingerprint, nowMs,
        });
      } catch (error) {
        if (committed) await bestEffortDelete(photoUri);
        throw error;
      } finally {
        try {
          await photoStore.discard(prepared);
        } catch {
          // Cache cleanup is non-critical and must not mask the database result.
        }
      }
    });
  }

  function create(input: PoopCreateInput, clientRequestId: string) {
    const previous = createQueues.get(clientRequestId) ?? Promise.resolve();
    const result = previous.then(
      () => runMutation(() => executeCreate(input, clientRequestId)),
      () => runMutation(() => executeCreate(input, clientRequestId)),
    );
    const tail = result.then(() => undefined, () => undefined);
    createQueues.set(clientRequestId, tail);
    void tail.finally(() => {
      if (createQueues.get(clientRequestId) === tail) createQueues.delete(clientRequestId);
    });
    return result;
  }

  async function executeUpdate(id: string, input: PoopUpdateInput) {
    const nowMs = dependencies.now();
    const normalized = normalizeAndValidatePoopInput(input, nowMs);
    const existing = await repository.getById(id);
    if (!existing) throw new Error('大便记录不存在或已被删除');

    if (input.photoChange.kind === 'keep') {
      return repository.update(id, { ...normalized, photoUri: existing.photoUri }, nowMs);
    }
    if (input.photoChange.kind === 'remove') {
      return photoOperationQueue.run(async () => {
        const latest = await repository.getById(id);
        if (!latest) throw new Error('大便记录不存在或已被删除');
        const updated = await repository.update(id, { ...normalized, photoUri: null }, nowMs);
        await bestEffortDelete(latest.photoUri);
        return updated;
      });
    }

    const replacementSource = input.photoChange.source;
    return photoOperationQueue.run(async () => {
      const latest = await repository.getById(id);
      if (!latest) throw new Error('大便记录不存在或已被删除');
      const prepared = await photoStore.prepare(replacementSource);
      const newPhotoUri = createPoopPhotoPath(dependencies.createPhotoId());
      let committed = false;
      try {
        await photoStore.commit(prepared, newPhotoUri);
        committed = true;
        const updated = await repository.update(id, { ...normalized, photoUri: newPhotoUri }, nowMs);
        if (latest.photoUri !== newPhotoUri) await bestEffortDelete(latest.photoUri);
        return updated;
      } catch (error) {
        if (committed) await bestEffortDelete(newPhotoUri);
        throw error;
      } finally {
        try {
          await photoStore.discard(prepared);
        } catch {
          // Cache cleanup is non-critical.
        }
      }
    });
  }

  function update(id: string, input: PoopUpdateInput) {
    return runMutation(() => executeUpdate(id, input));
  }

  async function deleteRecord(id: string) {
    await runMutation(() => photoOperationQueue.run(async () => {
      const existing = await repository.getById(id);
      if (!existing) throw new Error('大便记录不存在或已被删除');
      await repository.delete(id);
      await bestEffortDelete(existing.photoUri);
    }));
  }

  async function cleanupOrphanPhotos() {
    return runMutation(() => photoOperationQueue.run(async () => {
      const [referenced, managed] = await Promise.all([
        repository.listReferencedPhotoPaths(),
        photoStore.listManaged(),
      ]);
      let references = new Set(referenced);
      let deleted = 0;
      let failed = 0;
      for (const entry of managed) {
        if (references.has(entry.relativePath)) continue;
        if (dependencies.now() - entry.lastModifiedMs < ORPHAN_PHOTO_MIN_AGE_MS) continue;
        references = new Set(await repository.listReferencedPhotoPaths());
        if (references.has(entry.relativePath)) continue;
        try {
          await photoStore.deleteManaged(entry.relativePath);
          deleted += 1;
        } catch {
          failed += 1;
        }
      }
      return { deleted, failed };
    }));
  }

  return {
    createClientRequestId: dependencies.createClientRequestId,
    getCurrentTimeMs: dependencies.now,
    create,
    getById: (id: string) => repository.getById(id),
    getByClientRequestId: (id: string) => repository.getByClientRequestId(id),
    update,
    delete: deleteRecord,
    getHistory: (date: string) => repository.listByDate(date),
    getDailyCount: (date: string) => repository.getDailyCount(date),
    resolvePhoto: (path: string) => photoStore.resolve(path),
    cleanupOrphanPhotos,
  };
}

export type PoopService = ReturnType<typeof createPoopService>;
