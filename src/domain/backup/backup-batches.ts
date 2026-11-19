// A batch boundary lets the caller decide whether to yield the JS thread.
export const BACKUP_RECORD_BATCH_SIZE = 32;

export function finishBackupBatches<T>(batches: Generator<void, T>): T {
  let step = batches.next();
  while (!step.done) step = batches.next();
  return step.value;
}
