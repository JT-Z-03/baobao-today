import type { WorkflowState } from '@/application/ports/workflow-state';
import { draftKey, type RecordKind } from '@/domain/drafts/record-draft';

// SQL schema 1 fixes the outer format at 1. Version only the JSON payload;
// unversioned historical payloads remain readable without rewriting their bytes.
const PAYLOAD_VERSION = 1;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const id = (value: unknown): value is string => text(value) && value.length > 0;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const timestamp = (value: unknown) => number(value) && Number.isSafeInteger(value) && Math.abs(value) <= 8.64e15;
const duration = (value: unknown) => number(value) && Number.isSafeInteger(value) && value >= 0;
const nullable = (validate: (value: unknown) => boolean, value: unknown) => value === null || validate(value);
const oneOf = (value: unknown, choices: readonly unknown[]) => choices.includes(value);
const amount = (value: unknown) => oneOf(value, [null, 'small', 'medium', 'large']);
const safeTree = (value: unknown, depth = 0): boolean => {
  if (depth > 20) return false;
  if (value === null || text(value) || typeof value === 'boolean' || number(value)) return true;
  if (Array.isArray(value)) return value.every((item) => safeTree(item, depth + 1));
  return object(value) && Object.entries(value).every(([key, item]) =>
    !['__proto__', 'constructor', 'prototype'].includes(key) && safeTree(item, depth + 1));
};
const photo = (value: unknown) => object(value) && id(value.uri)
  && number(value.width) && value.width > 0 && number(value.height) && value.height > 0;
function photoChange(value: unknown) {
  return object(value) && (oneOf(value.kind, ['keep', 'remove']) || (value.kind === 'replace' && photo(value.source)));
}
function timer(value: unknown) {
  if (value === null) return true;
  return object(value) && timestamp(value.startedAtMs) && nullable(timestamp, value.segmentStartedAtMs)
    && timestamp(value.lastActionAtMs) && duration(value.leftMs)
    && duration(value.rightMs) && Number.isSafeInteger((value.leftMs as number) + (value.rightMs as number)) && typeof value.finished === 'boolean'
    && oneOf(value.side, [null, 'left', 'right']) && oneOf(value.issue, [null, 'clock', 'limit'])
    && (value.side === null) === (value.segmentStartedAtMs === null)
    && (!value.finished || value.side === null);
}
function values(kind: unknown, value: unknown) {
  if (!object(value) || !text(value.note)) return false;
  if (kind === 'sleep') return timestamp(value.startMs) && nullable(timestamp, value.endMs);
  if (!timestamp(value.eventTimeMs)) return false;
  switch (kind) {
    case 'feeding': return oneOf(value.feedingType, [null, 'formula', 'breast', 'bottle_breast', 'mixed'])
      && ['milkAmount', 'breastMilkAmount', 'leftDuration', 'rightDuration'].every((field) => text(value[field]))
      && Array.isArray(value.mixedComponents) && value.mixedComponents.every((item) => oneOf(item, ['formula', 'breast', 'bottle_breast']));
    case 'pee': return amount(value.amount) && oneOf(value.color, [null, 'clear', 'light_yellow', 'yellow', 'dark_yellow']);
    case 'poop': return amount(value.amount) && oneOf(value.color, [null, 'yellow', 'green', 'brown', 'black', 'red', 'other'])
      && oneOf(value.texture, [null, 'watery', 'soft', 'mushy', 'formed', 'pellet'])
      && photoChange(value.photoChange) && nullable(text, value.previewUri);
    case 'other': return text(value.title);
    default: return false;
  }
}
function submission(kind: unknown, value: unknown) {
  if (!object(value) || !nullable(text, value.note)) return false;
  if (kind === 'sleep') return timestamp(value.startMs) && (value.endMs === undefined || nullable(timestamp, value.endMs));
  if (!timestamp(value.eventTimeMs)) return false;
  switch (kind) {
    case 'feeding': return oneOf(value.feedingType, ['formula', 'breast', 'bottle_breast', 'mixed'])
      && ['milkAmountMl', 'breastMilkAmountMl', 'leftDurationMin', 'rightDurationMin'].every((field) => nullable(number, value[field]));
    case 'pee': return amount(value.amount) && oneOf(value.color, [null, 'clear', 'light_yellow', 'yellow', 'dark_yellow']);
    case 'poop': return amount(value.amount) && oneOf(value.color, [null, 'yellow', 'green', 'brown', 'black', 'red', 'other'])
      && oneOf(value.texture, [null, 'watery', 'soft', 'mushy', 'formed', 'pellet'])
      && (value.photoChange === undefined || photoChange(value.photoChange))
      && (value.photo === undefined || nullable(photo, value.photo))
      && (value.photoChange !== undefined || value.photo !== undefined);
    case 'other': return text(value.title);
    default: return false;
  }
}
function draft(key: string, value: unknown) {
  return object(value) && ['id', 'babyId', 'generation', 'clientRequestId'].every((field) => id(value[field]))
    && nullable(id, value.recordId) && key === value.key
    && key === draftKey(value.babyId as string, value.kind as RecordKind, value.recordId as string | null)
    && Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 && timestamp(value.updatedAtMs)
    && oneOf(value.status, ['editing', 'submitting', 'committed', 'discarded'])
    && values(value.kind, value.values)
    && (value.baseRecord === null || (object(value.baseRecord) && id(value.baseRecord.id)
      && value.baseRecord.id === value.recordId && timestamp(value.baseRecord.updatedAtMs)))
    && (value.submission === null || submission(value.kind, value.submission))
    && (value.status !== 'submitting' || submission(value.kind, value.submission))
    && nullable(id, value.resultRecordId) && (value.status !== 'committed' || id(value.resultRecordId))
    && timer(value.timer) && (value.timer === null || value.kind === 'feeding');
}
function receipt(value: unknown) {
  return object(value) && ['id', 'generation', 'uri', 'sourceUri', 'filename'].every((field) => id(value[field]))
    && text(value.location) && number(value.byteLength) && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
    && text(value.sha256) && /^[a-fA-F0-9]{64}$/.test(value.sha256) && timestamp(value.createdAtMs)
    && nullable(timestamp, value.savedAtMs) && oneOf(value.status, ['writing', 'verified', 'unverified', 'failed'])
    && (value.status === 'verified' ? timestamp(value.savedAtMs) : value.savedAtMs === null);
}
function validateEnvelope(value: unknown): asserts value is WorkflowState {
  if (!object(value) || value.format !== 1 || (value.payloadVersion !== undefined && value.payloadVersion !== PAYLOAD_VERSION)
    || !id(value.generation) || !object(value.drafts) || !Array.isArray(value.exports)
    || !(value.restore === null || (object(value.restore) && id(value.restore.id) && value.restore.previousGeneration === value.generation))
    || !safeTree({ ...value, drafts: {} })
    || (value.quarantinedDrafts !== undefined && (!Array.isArray(value.quarantinedDrafts)
      || !value.quarantinedDrafts.every((entry) => object(entry) && text(entry.key) && id(entry.raw) && id(entry.reason))))
    || !value.exports.every(receipt)) throw new Error('本机草稿数据无法读取，原文件已保留，请重试或更新应用');
  if (new Set(value.exports.map((item) => (item as ObjectValue).id)).size !== value.exports.length) {
    throw new Error('本机备份凭据标识重复，原文件已保留，请重试');
  }
}
export function decodeWorkflowState(raw: string): WorkflowState {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('本机草稿数据无法读取，原文件已保留，请重试'); }
  validateEnvelope(value);
  const quarantined = [...(value.quarantinedDrafts ?? [])];
  const entries = Object.entries(value.drafts);
  const idCounts = new Map<unknown, number>();
  const requestCounts = new Map<unknown, number>();
  for (const [, item] of entries) {
    if (object(item) && id(item.id)) idCounts.set(item.id, (idCounts.get(item.id) ?? 0) + 1);
    if (object(item) && id(item.clientRequestId)) requestCounts.set(item.clientRequestId, (requestCounts.get(item.clientRequestId) ?? 0) + 1);
  }
  const healthy: WorkflowState['drafts'] = {};
  for (const [key, item] of entries) {
    if (safeTree(item) && draft(key, item) && idCounts.get(item.id) === 1 && requestCounts.get(item.clientRequestId) === 1) {
      healthy[key] = item;
    } else {
      const rawDraft = JSON.stringify(item);
      if (!quarantined.some((entry) => entry.key === key && entry.raw === rawDraft)) {
        quarantined.push({ key, raw: rawDraft, reason: '草稿结构或标识异常，已保留原内容' });
      }
    }
  }
  return { ...value, drafts: healthy, ...(quarantined.length ? { quarantinedDrafts: quarantined } : {}) };
}
export function encodeWorkflowState(state: WorkflowState): string {
  validateEnvelope(state);
  const entries = Object.entries(state.drafts);
  if (!entries.every(([key, item]) => safeTree(item) && draft(key, item))
    || new Set(entries.map(([, item]) => item.id)).size !== entries.length
    || new Set(entries.map(([, item]) => item.clientRequestId)).size !== entries.length) {
    throw new Error('草稿写入结构异常，原内容已保留');
  }
  return JSON.stringify({ ...state, payloadVersion: PAYLOAD_VERSION });
}
