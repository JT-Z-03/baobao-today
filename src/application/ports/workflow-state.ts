import type { RecordDraft } from '@/domain/drafts/record-draft';
import type { BackupExportReceipt } from './backup-export';

export type WorkflowState = {
  format: 1; generation: string;
  restore: { id: string; previousGeneration: string } | null;
  drafts: Record<string, RecordDraft>; exports: BackupExportReceipt[];
};
export interface WorkflowStateStore {
  read(): Promise<WorkflowState>;
  transaction<T>(update: (state: WorkflowState) => T): Promise<T>;
}

export function emptyWorkflowState(generation: string): WorkflowState {
  return { format: 1, generation, restore: null, drafts: {}, exports: [] };
}
