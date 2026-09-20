import { useLocalClock } from '@/hooks/use-local-clock';
import { useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import type { RestoreSummary as RestoreSummaryData } from '@/application/backup/backup-validation-service';
import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ScreenContainer } from '@/components/ui/screen-container';
import { SectionCard } from '@/components/ui/section-card';
import { Spacing, Typography } from '@/constants/theme';
import { RestoreSummary } from '@/features/backup/components/restore-summary';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';
import { useTheme } from '@/hooks/use-theme';
import type { GeneratedBackup } from '@/application/backup/backup-export-service';
import type { BackupExportReceipt } from '@/application/ports/backup-export';
import { formatRecordTime } from '@/domain/date/record-time-shortcuts';

type PreparedMode = 'restore' | 'undo';
type Confirmation = 'create' | 'restore' | null;

export function BackupRestoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const nowMs = useLocalClock();
  const { backupService, restoreService, backupExportService, draftService } = useAppState();
  const [generated, setGenerated] = useState<GeneratedBackup | null>(null);
  const [lastSaved, setLastSaved] = useState<BackupExportReceipt | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [phase, setPhase] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestoreSummaryData | null>(null);
  const [preparedMode, setPreparedMode] = useState<PreparedMode>('restore');
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [returnHome, setReturnHome] = useState(false);
  const busyRef = useRef(false);
  const busy = phase !== null;

  usePreventRemove(busy, () => {
    setMessage('正在处理本地数据，请完成后再返回。');
  });

  useEffect(() => {
    let active = true;
    void backupExportService?.latest().then((receipt) => { if (active) setLastSaved(receipt); }).catch(() => { if (active) setMessage('上次备份保存状态暂时无法读取，请稍后重试。'); });
    const refreshDrafts = () => {
      void draftService?.list().then((value) => { if (active) setPendingCount(value.drafts.length); }).catch(() => undefined);
    };
    refreshDrafts();
    const unsubscribe = draftService?.subscribe(refreshDrafts);
    return () => { active = false; unsubscribe?.(); };
  }, [backupExportService, draftService]);

  useEffect(() => {
    // Release the native removal guard before navigating after a completed restore.
    if (returnHome && !busy) router.replace('/today');
  }, [busy, returnHome, router]);

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
      if (backupExportService) {
        setGenerated(await backupExportService.create());
        setMessage('备份已生成，请选择保存位置。尚未保存到应用外。');
      } else {
        await backupService.createAndShare();
        setMessage('完整备份已生成，系统分享面板已关闭。请确认已在目标应用中妥善保存。');
      }
    } catch (error) {
      setMessage(toSafeUiMessage(error, '完整备份创建失败，请检查照片和手机可用空间后重试。'));
    } finally {
      finish();
    }
  };

  const saveGenerated = async () => {
    if (!generated || !backupExportService || !begin('正在保存并校验文件')) return;
    try {
      const result = await backupExportService.save(generated);
      if (result.kind === 'canceled') setMessage('尚未保存，可重新选择位置。');
      else if (result.kind === 'verified') {
        setLastSaved(await backupExportService.latest());
        setMessage(`已保存到所选位置：${result.receipt.location}\n文件：${result.receipt.filename}\n保存时间：${formatRecordTime(result.receipt.savedAtMs!, nowMs)}`);
      } else if (result.kind === 'unverified') setMessage(`文件已写出，但无法完成校验，请核对或换位置重试。\n${result.receipt.filename}`);
      else setMessage(`未完成保存，应用内备份保留，可重试。${result.cleanupFailed ? `请核对并清理所选位置的未完成文件：${result.receipt.filename}` : ''}`);
    } catch (error) { setMessage(toSafeUiMessage(error, '保存状态尚未确认，请核对所选位置后重试。')); }
    finally { finish(); }
  };
  const shareGenerated = async () => {
    if (!generated || !backupExportService || !begin('正在打开分享面板')) return;
    try { await backupExportService.share(generated); setMessage('分享面板已关闭，请到目标应用确认文件已保存。'); }
    catch (error) { setMessage(toSafeUiMessage(error, '分享失败，备份仍可保存到手机。')); }
    finally { finish(); }
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
      setReturnHome(true);
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
  const confirmationMessage = (confirmation === 'create'
    ? '完整备份包含宝宝资料、全部记录和大便照片，当前文件未加密。请妥善保管，不要发送给不信任的人。'
    : '恢复会替换当前宝宝资料、全部记录、照片和相关本地设置，不会与现有数据合并。')
    + (pendingCount ? (confirmation === 'create'
      ? ` 当前有 ${pendingCount} 条未完成记录，备份仅包含已保存资料；草稿和未保存的亲喂计时不包含在内，可取消后先保存记录。`
      : ` 当前有 ${pendingCount} 条未完成记录，恢复成功后这些草稿与亲喂计时会清理。`) : '');

  return (
    <>
      <ScreenContainer contentStyle={styles.content}>
        <View style={styles.heading}>
          <ThemedText style={styles.title} selectable>备份与恢复</ThemedText>
          <AppIcon name="backup" color={theme.primary} size={32} />
        </View>
        <SectionCard>
          <ThemedText type="smallBold" themeColor="danger" selectable>完整备份包含宝宝的私密数据</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" selectable>
            当前备份文件未加密，请妥善保管，不要发送给不信任的人。App不会自动上传备份。
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" selectable>
            导出表格适合查看、整理和打印，不含照片，不能恢复应用。备份全部资料包含已保存的宝宝资料、记录、照片和设置，可用于恢复。
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" selectable>
            恢复会替换当前宝宝资料、全部记录、照片和相关本地设置，不会与现有数据合并。
          </ThemedText>
        </SectionCard>

        <View style={styles.actions}>
          <AppButton accessibilityLabel="创建完整备份" disabled={busy} label="备份全部资料" onPress={() => setConfirmation('create')} />
          <AppButton accessibilityLabel="从备份文件恢复" disabled={busy} label="从备份文件恢复" onPress={() => { void prepareRestore('restore'); }} variant="secondary" />
          {undoAvailable ? <AppButton accessibilityLabel="撤销上次恢复" disabled={busy} label="撤销上次恢复" onPress={() => { void prepareRestore('undo'); }} variant="secondary" /> : null}
        </View>

        {generated ? <SectionCard>
          <ThemedText type="smallBold">{generated.filename}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">包含生成时已保存的资料。请选择本机可写目录；具体位置由系统文件选择器决定。</ThemedText>
          <AppButton label="保存到手机" disabled={busy} onPress={() => { void saveGenerated(); }} />
          <AppButton label="分享给其他应用" disabled={busy} variant="secondary" onPress={() => { void shareGenerated(); }} />
        </SectionCard> : null}
        {lastSaved ? <SectionCard>
          <ThemedText type="small">上次保存备份：{formatRecordTime(lastSaved.savedAtMs!, nowMs)}</ThemedText>
          <ThemedText type="small" selectable>{lastSaved.location} · {lastSaved.filename}</ThemedText>
          <AppButton label="核对上次备份文件" variant="secondary" disabled={busy} onPress={() => {
            if (!backupExportService || !begin('正在核对备份文件')) return;
            void backupExportService.check(lastSaved).then((ok) => setMessage(ok ? '上次备份文件校验通过。' : '上次备份文件目前无法访问或内容已变化，请重新保存一份备份。')).finally(finish);
          }} />
        </SectionCard> : null}

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
  content: { maxWidth: 560, gap: Spacing.xxl },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  title: { ...Typography.pageTitle, flex: 1 },
  actions: { gap: Spacing.sm },
  summary: { gap: Spacing.xl },
});
