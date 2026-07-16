import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import type { RestoreSummary as RestoreSummaryData } from '@/application/backup/backup-validation-service';
import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ScreenContainer } from '@/components/ui/screen-container';
import { SectionCard } from '@/components/ui/section-card';
import { Spacing } from '@/constants/theme';
import { RestoreSummary } from '@/features/backup/components/restore-summary';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';

type PreparedMode = 'restore' | 'undo';
type Confirmation = 'create' | 'restore' | null;

export function BackupRestoreScreen() {
  const router = useRouter();
  const { backupService, restoreService } = useAppState();
  const [phase, setPhase] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestoreSummaryData | null>(null);
  const [preparedMode, setPreparedMode] = useState<PreparedMode>('restore');
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const busyRef = useRef(false);
  const busy = phase !== null;

  useEffect(() => {
    if (!restoreService) return;
    let active = true;
    void restoreService.hasUndo().then((value) => { if (active) setUndoAvailable(value); });
    return () => { active = false; };
  }, [restoreService]);

  if (!backupService || !restoreService) return null;

  const begin = (nextPhase: string) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setPhase(nextPhase);
    setMessage(null);
    return true;
  };

  const finish = () => {
    busyRef.current = false;
    setPhase(null);
  };

  const executeCreate = async () => {
    if (!begin('正在读取数据并处理照片')) return;
    try {
      await backupService.createAndShare();
      setMessage('完整备份已生成，系统分享面板已关闭。请确认已在目标应用中妥善保存。');
    } catch (error) {
      setMessage(toSafeUiMessage(error, '完整备份创建失败，请检查照片和手机可用空间后重试。'));
    } finally {
      finish();
    }
  };

  const prepareRestore = async (mode: PreparedMode) => {
    if (!begin(mode === 'undo' ? '正在校验恢复前安全备份' : '正在校验备份')) return;
    try {
      const prepared = mode === 'undo' ? await restoreService.prepareUndo() : await restoreService.pickAndPrepare();
      if (!prepared) {
        setMessage('已取消选择备份文件。');
        return;
      }
      setPreparedMode(mode);
      setSummary(prepared.summary);
    } catch (error) {
      setMessage(toSafeUiMessage(error, '所选文件无法通过完整备份校验，当前数据没有改变。'));
    } finally {
      finish();
    }
  };

  const executeRestore = async () => {
    if (!begin('正在创建恢复前安全备份并恢复数据')) return;
    try {
      const result = await restoreService.confirmPrepared();
      const warning = result.warnings.length
        ? ' 数据已恢复，但部分文件清理、提醒同步或页面刷新需要在下次启动时继续。'
        : '';
      setMessage(`恢复成功。${warning}`);
      router.replace('/today');
    } catch (error) {
      setMessage(toSafeUiMessage(error, '恢复失败，当前数据和照片没有被部分覆盖。'));
    } finally {
      finish();
    }
  };

  const confirmationTitle = confirmation === 'create'
    ? '备份文件包含宝宝的私密数据'
    : preparedMode === 'undo'
      ? '确认撤销上次恢复'
      : '确认替换当前数据';
  const confirmationMessage = confirmation === 'create'
    ? '完整备份包含宝宝资料、全部记录和大便照片，当前文件未加密。请妥善保管，不要发送给不信任的人。'
    : '恢复会替换当前宝宝资料、全部记录、照片和相关本地设置，不会与现有数据合并。';

  return (
    <>
      <ScreenContainer>
        <SectionCard>
          <ThemedText type="smallBold" themeColor="danger" selectable>完整备份包含宝宝的私密数据</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" selectable>
            当前备份文件未加密，请妥善保管，不要发送给不信任的人。App不会自动上传备份。
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" selectable>
            CSV用于查看和分享表格，不能恢复且不包含照片；完整备份用于恢复App数据，不适合作为普通表格阅读。
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" selectable>
            恢复会替换当前宝宝资料、全部记录、照片和相关本地设置，不会与现有数据合并。
          </ThemedText>
        </SectionCard>

        <View style={styles.actions}>
          <AppButton accessibilityLabel="创建完整备份" disabled={busy} label="创建完整备份" onPress={() => setConfirmation('create')} />
          <AppButton accessibilityLabel="从备份文件恢复" disabled={busy} label="从备份文件恢复" onPress={() => { void prepareRestore('restore'); }} variant="secondary" />
          {undoAvailable ? <AppButton accessibilityLabel="撤销上次恢复" disabled={busy} label="撤销上次恢复" onPress={() => { void prepareRestore('undo'); }} variant="secondary" /> : null}
        </View>

        {phase ? <ThemedText accessibilityLiveRegion="polite" themeColor="textSecondary" selectable>{phase}</ThemedText> : null}
        {message ? <ThemedText accessibilityLiveRegion="polite" themeColor={message.includes('失败') ? 'danger' : 'textSecondary'} selectable>{message}</ThemedText> : null}
        {summary ? (
          <View style={styles.summary}>
            <RestoreSummary summary={summary} />
            <AppButton
              accessibilityLabel={preparedMode === 'undo' ? '确认撤销恢复' : '确认恢复'}
              disabled={busy}
              label={preparedMode === 'undo' ? '确认撤销恢复' : '确认恢复'}
              onPress={() => setConfirmation('restore')}
              variant="destructive"
            />
          </View>
        ) : null}
      </ScreenContainer>

      <ConfirmDialog
        visible={confirmation !== null}
        title={confirmationTitle}
        message={confirmationMessage}
        confirmLabel={confirmation === 'create' ? '继续创建' : preparedMode === 'undo' ? '确认撤销' : '替换并恢复'}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const requested = confirmation;
          setConfirmation(null);
          if (requested === 'create') void executeCreate();
          if (requested === 'restore') void executeRestore();
        }}
        variant={confirmation === 'restore' ? 'destructive' : 'default'}
      />
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: Spacing.sm },
  summary: { gap: Spacing.xl },
});
