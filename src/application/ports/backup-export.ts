export type BackupFileFingerprint = { byteLength: number; sha256: string };
export type BackupExportTarget = { uri: string; filename: string; location: string };
export type BackupExportReceipt = BackupExportTarget & BackupFileFingerprint & {
  id: string; generation: string; sourceUri: string; createdAtMs: number; savedAtMs: number | null;
  status: 'writing' | 'verified' | 'unverified' | 'failed';
};
export interface BackupExportGateway {
  fingerprint(uri: string): Promise<BackupFileFingerprint>;
  chooseTarget(filename: string): Promise<BackupExportTarget | null>;
  write(sourceUri: string, targetUri: string): Promise<void>;
  deleteCreated(uri: string): Promise<void>;
}
