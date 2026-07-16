export type PeeAmount = 'small' | 'medium' | 'large';
export type PeeColor = 'clear' | 'light_yellow' | 'yellow' | 'dark_yellow';

export interface PeeCoreInput {
  eventTimeMs: number;
  amount: PeeAmount | null;
  color: PeeColor | null;
  note: string | null;
}

export type PeeCreateInput = PeeCoreInput;
export type PeeUpdateInput = PeeCoreInput;

export interface PeeRecord extends PeeCoreInput {
  type: 'pee';
  id: string;
  clientRequestId: string;
  createPayloadHash: string;
  recordDate: string;
  sortTimeMs: number;
  createdAtMs: number;
  updatedAtMs: number;
}
