export interface OtherCoreInput {
  eventTimeMs: number;
  title: string;
  note: string | null;
}

export type OtherCreateInput = OtherCoreInput;
export type OtherUpdateInput = OtherCoreInput;

export interface OtherRecord extends OtherCoreInput {
  type: 'other';
  id: string;
  clientRequestId: string;
  createPayloadHash: string;
  recordDate: string;
  sortTimeMs: number;
  createdAtMs: number;
  updatedAtMs: number;
}
