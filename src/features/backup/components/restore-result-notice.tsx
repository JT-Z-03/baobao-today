import { useState, useSyncExternalStore } from 'react';
import type { RestoreResult, RestoreService, RestoreWarning } from '@/application/backup/restore-service';
import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { SectionCard } from '@/components/ui/section-card';

const messages: Record<RestoreWarning, string> = {
  'draft-state': '未完成记录状态尚未整理，请重试后再继续草稿。',
  'old-photo-cleanup': '旧照片尚未清理完成。',
  'reminder-sync': '喝奶提醒尚未同步，请重试并核对提醒设置。',
  'app-refresh': '页面资料尚未刷新。',
  'restore-workspace-cleanup': '恢复临时文件尚未清理完成。',
};
const emptyResult = () => null;
const emptySubscribe = () => () => undefined;

export function useRestoreResult(service: RestoreService | null | undefined): RestoreResult | null {
  return useSyncExternalStore(service?.subscribeResult ?? emptySubscribe,
    service?.getResult ?? emptyResult, service?.getResult ?? emptyResult);
}

export function RestoreResultNotice({ service, onAcknowledge }: { service: RestoreService | null | undefined; onAcknowledge?(): void }) {
  const result = useRestoreResult(service);
  const [retryError, setRetryError] = useState(false);
  if (!result || !service) return null;
  return <SectionCard>
    <ThemedText type="smallBold" accessibilityLiveRegion="polite">{result.busy ? '数据已恢复，正在处理后续事项' : result.warnings.length ? '数据已恢复，以下事项尚未完成' : '恢复后续处理已完成'}</ThemedText>
    {result.warnings.map((warning) => <ThemedText key={warning} type="small" selectable>{messages[warning]}</ThemedText>)}
    {retryError ? <ThemedText type="small" themeColor="danger">暂时无法重试，请稍后再试。</ThemedText> : null}
    {result.warnings.length ? <AppButton label="重试后续处理" loading={result.busy} onPress={() => {
      setRetryError(false);
      void service.retryPostRestore().catch(() => setRetryError(true));
    }} /> : null}
    <AppButton label={onAcknowledge ? '已知晓，返回首页' : '已知晓'} disabled={result.busy} variant="secondary" onPress={() => {
      service.acknowledgeResult(); onAcknowledge?.();
    }} />
  </SectionCard>;
}
