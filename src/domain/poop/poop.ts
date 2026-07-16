export type PoopColor = 'yellow' | 'green' | 'brown' | 'black' | 'red' | 'other';
export type PoopTexture = 'watery' | 'soft' | 'mushy' | 'formed' | 'pellet';
export type PoopAmount = 'small' | 'medium' | 'large';

export interface PoopCoreInput {
  eventTimeMs: number;
  color: PoopColor | null;
  texture: PoopTexture | null;
  amount: PoopAmount | null;
  note: string | null;
}

export interface LocalPhotoSource {
  uri: string;
  width: number;
  height: number;
}

export interface PoopCreateInput extends PoopCoreInput {
  photo: LocalPhotoSource | null;
}

export type PoopPhotoChange =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'replace'; source: LocalPhotoSource };

export interface PoopUpdateInput extends PoopCoreInput {
  photoChange: PoopPhotoChange;
}

export interface PoopRecord extends PoopCoreInput {
  type: 'poop';
  id: string;
  clientRequestId: string;
  createPayloadHash: string;
  photoUri: string | null;
  recordDate: string;
  sortTimeMs: number;
  createdAtMs: number;
  updatedAtMs: number;
}
