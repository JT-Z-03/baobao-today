import type { BackupOperationCoordinator } from '@/application/ports/backup';

export class BackupRestoreCoordinator implements BackupOperationCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  private active = 0;

  get busy() {
    return this.active > 0;
  }

  runExclusive<T>(operation: () => Promise<T>) {
    const result = this.tail.then(async () => {
      this.active += 1;
      try { return await operation(); }
      finally { this.active -= 1; }
    }, async () => {
      this.active += 1;
      try { return await operation(); }
      finally { this.active -= 1; }
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
