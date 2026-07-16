export class IdempotencyConflictError extends Error {
  constructor(readonly clientRequestId: string) {
    super('同一保存请求包含了不同的记录数据');
    this.name = 'IdempotencyConflictError';
  }
}
