import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import type { FeedingReminderStatus } from '@/application/reminders/feeding-reminder-service';
import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { AppIllustration } from '@/components/ui/app-illustration';
import { BrandMark } from '@/components/ui/brand-mark';
import { AppTextInput } from '@/components/ui/app-text-input';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { FormField } from '@/components/ui/form-field';
import { NativeTabScreenContainer } from '@/components/ui/screen-container';
import { SectionCard } from '@/components/ui/section-card';
import { Spacing, Typography } from '@/constants/theme';
import { calculateBirthDayNumber } from '@/domain/baby/baby-profile';
import { parseLocalDateKey, toLocalDateKey } from '@/domain/date/local-date';
import {
  formatReminderTime,
  getReminderStatusMessage,
  parseCustomReminderInterval,
} from '@/features/settings/feeding-reminder-settings';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';
import { useTheme } from '@/hooks/use-theme';

type ReminderChoice = 'off' | 'two-hours' | 'three-hours' | 'custom';

function choiceForInterval(intervalMinutes: number | null): ReminderChoice {
  if (intervalMinutes === null) return 'off';
  if (intervalMinutes === 120) return 'two-hours';
  if (intervalMinutes === 180) return 'three-hours';
  return 'custom';
}

function formatInterval(intervalMinutes: number) {
  const hours = Math.floor(intervalMinutes / 60);
  const minutes = intervalMinutes % 60;
  if (hours === 0) return `${minutes}分钟`;
  if (minutes === 0) return `${hours}小时`;
  return `${hours}小时${minutes}分钟`;
}

function SettingsSection({ title, icon, children }: {
  title: string;
  icon: AppIconName;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <AppIcon color={icon === 'feeding' ? theme.feeding : icon === 'appearance' ? theme.success : theme.pee} name={icon} size={26} />
        <ThemedText style={styles.sectionTitle} selectable>{title}</ThemedText>
      </View>
      {children}
    </View>
  );
}

export function SettingsScreen() {
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const wrapReminderChoices = width < 360 || fontScale > 1.1;
  const reminderChoiceStyle = [styles.reminderChoice, wrapReminderChoices && styles.reminderChoiceWrapped];
  const router = useRouter();
  const { babyProfile, feedingReminderService, themeMode, themeService } = useAppState();
  const [status, setStatus] = useState<FeedingReminderStatus | null>(null);
  const [customVisible, setCustomVisible] = useState(false);
  const [customHours, setCustomHours] = useState('2');
  const [customMinutes, setCustomMinutes] = useState('30');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [developmentMessage, setDevelopmentMessage] = useState<string | null>(null);
  const [developmentVisible, setDevelopmentVisible] = useState(false);
  const [reminderInfoVisible, setReminderInfoVisible] = useState(false);
  const [themeBusy, setThemeBusy] = useState(false);
  const [today, setToday] = useState(() => toLocalDateKey(Date.now()));

  const refreshStatus = useCallback(() => {
    setToday(toLocalDateKey(Date.now()));
    if (!feedingReminderService) return undefined;
    let active = true;
    void feedingReminderService.syncFeedingReminder()
      .then((nextStatus) => {
        if (active) setStatus(nextStatus);
      })
      .catch(() => {
        if (active) setStatus({
          kind: 'sync-error',
          intervalMinutes: null,
          permissionStatus: 'undetermined',
          latestFeedingEventTimeMs: null,
          scheduledForMs: null,
          errorCode: 'reconcile-failed',
          syncErrorCode: 'reconcile-failed',
        });
      });
    return () => { active = false; };
  }, [feedingReminderService]);

  useFocusEffect(refreshStatus);

  if (!babyProfile || !feedingReminderService || !themeService) return null;

  const applyTheme = async (mode: 'system' | 'light' | 'dark') => {
    if (themeBusy) return;
    setThemeBusy(true);
    setValidationMessage(null);
    try {
      await themeService.setMode(mode);
    } catch {
      setValidationMessage('主题设置保存失败，请重试。');
    } finally {
      setThemeBusy(false);
    }
  };

  const applyInterval = async (intervalMinutes: number | null) => {
    if (busy) return;
    setBusy(true);
    setValidationMessage(null);
    try {
      setStatus(await feedingReminderService.setInterval(intervalMinutes));
    } catch (error) {
      setValidationMessage(toSafeUiMessage(error, '提醒设置保存失败，请重试。'));
    } finally {
      setBusy(false);
    }
  };

  const applyCustom = async () => {
    const parsed = parseCustomReminderInterval(customHours, customMinutes);
    if (!parsed.ok) {
      setValidationMessage(parsed.message);
      return;
    }
    await applyInterval(parsed.intervalMinutes);
  };

  const runDevelopmentAction = async (action: () => Promise<string>) => {
    setDevelopmentMessage(null);
    try {
      setDevelopmentMessage(await action());
    } catch (error) {
      setDevelopmentMessage(toSafeUiMessage(error, '开发验收操作失败，请检查通知权限后重试。'));
    }
  };

  const selectedChoice = status ? choiceForInterval(status.intervalMinutes) : null;
  const permissionLabel = !status ? '正在读取' : status.permissionStatus === 'granted'
    ? '已允许'
    : status?.permissionStatus === 'denied'
      ? '未开启'
      : '未请求';
  const birthDate = parseLocalDateKey(babyProfile.birthDate);
  const birthDay = calculateBirthDayNumber(babyProfile.birthDate, today);

  return (
    <NativeTabScreenContainer contentStyle={styles.content}>
      <View style={styles.heading}>
        <BrandMark />
        <ThemedText style={styles.title} selectable>设置</ThemedText>
      </View>

      <View accessibilityLabel="宝宝资料" style={styles.profileRow}>
        <AppIllustration name="babySmile" width={84} height={84} />
        <View style={styles.profileCopy}>
          <ThemedText style={styles.profileName} selectable>{babyProfile.name}</ThemedText>
          <ThemedText selectable>出生第 {birthDay} 天</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" selectable>
            出生日期 {birthDate.getFullYear()}年{birthDate.getMonth() + 1}月{birthDate.getDate()}日
          </ThemedText>
        </View>
      </View>

      <SettingsSection icon="feeding" title="喝奶提醒">
        <View style={styles.sectionHeading}>
          <ThemedText type="smallBold" selectable>喝奶记录后提醒我</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" selectable>
            {status ? status.intervalMinutes ? formatInterval(status.intervalMinutes) : '不提醒' : '正在读取'}
          </ThemedText>
        </View>
        <View style={styles.options}>
          <ChoiceChip style={reminderChoiceStyle} disabled={busy} label="不提醒" selected={selectedChoice === 'off'} accessibilityLabel="关闭喝奶提醒" onPress={() => {
            setCustomVisible(false);
            void applyInterval(null);
          }} />
          <ChoiceChip style={reminderChoiceStyle} disabled={busy} label="2小时" selected={selectedChoice === 'two-hours'} accessibilityLabel="设置2小时提醒" onPress={() => {
            setCustomVisible(false);
            void applyInterval(120);
          }} />
          <ChoiceChip style={reminderChoiceStyle} disabled={busy} label="3小时" selected={selectedChoice === 'three-hours'} accessibilityLabel="设置3小时提醒" onPress={() => {
            setCustomVisible(false);
            void applyInterval(180);
          }} />
          <ChoiceChip style={reminderChoiceStyle} disabled={busy} label="自定义" selected={selectedChoice === 'custom'} accessibilityLabel="选择自定义提醒" onPress={() => {
            setCustomVisible(true);
            setValidationMessage(null);
          }} />
        </View>

        {customVisible ? (
          <SectionCard elevated>
            <View style={styles.customInputs}>
              <View style={styles.customInput}>
                <FormField label="小时">
                  <AppTextInput accessibilityLabel="自定义小时" keyboardType="number-pad" maxLength={2} value={customHours} onChangeText={setCustomHours} />
                </FormField>
              </View>
              <View style={styles.customInput}>
                <FormField label="分钟">
                  <AppTextInput accessibilityLabel="自定义分钟" keyboardType="number-pad" maxLength={2} value={customMinutes} onChangeText={setCustomMinutes} />
                </FormField>
              </View>
            </View>
            <AppButton accessibilityLabel="启用自定义提醒" disabled={busy} loading={busy} label="启用自定义提醒" onPress={() => { void applyCustom(); }} />
          </SectionCard>
        ) : null}

        {validationMessage ? <ThemedText accessibilityLiveRegion="polite" themeColor="danger" selectable>{validationMessage}</ThemedText> : null}

        <SectionCard style={[styles.reminderStatus, { backgroundColor: theme.primaryContainer, borderWidth: 0 }]}>
          <View style={styles.reminderStatusHeading}>
            <ThemedText type="smallBold" selectable>系统通知：{permissionLabel}</ThemedText>
            <ThemedText accessibilityLiveRegion="polite" type="small" themeColor={status?.kind === 'sync-error' ? 'danger' : 'textSecondary'} selectable>
              {getReminderStatusMessage(status?.kind ?? 'loading')}
            </ThemedText>
          </View>
          {status?.latestFeedingEventTimeMs != null ? (
            <ThemedText selectable>最近喝奶：{formatReminderTime(status.latestFeedingEventTimeMs)}</ThemedText>
          ) : null}
          {status?.kind === 'scheduled' ? (
            <ThemedText selectable>下次提醒：{formatReminderTime(status.scheduledForMs)}</ThemedText>
          ) : null}
          {status?.kind === 'sync-error' ? <AppButton compact label="重新同步" accessibilityLabel="重新同步提醒" onPress={() => { refreshStatus(); }} variant="secondary" /> : null}
          {status?.permissionStatus === 'denied' ? <AppButton compact label="打开系统通知设置" onPress={() => { void feedingReminderService.openSystemSettings(); }} variant="secondary" /> : null}
        </SectionCard>

        <View style={styles.explanationHeading}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.explanationCopy} selectable>
            提醒可能受系统权限和省电设置影响
          </ThemedText>
          <AppButton
            accessibilityLabel={reminderInfoVisible ? '收起提醒说明' : '查看提醒说明'}
            accessibilityState={{ expanded: reminderInfoVisible }}
            compact
            label={reminderInfoVisible ? '收起说明' : '查看说明'}
            onPress={() => setReminderInfoVisible((visible) => !visible)}
            variant="ghost"
          />
        </View>
        {reminderInfoVisible ? (
          <View style={styles.explanation}>
            <ThemedText type="small" themeColor="textSecondary" selectable>
              本功能使用手机系统本地通知，不依赖网络。提醒时间可能受通知权限、省电策略和手机厂商后台限制影响。
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" selectable>
              部分手机需要允许“后台自启动”或将电池策略设置为“不限制”。如果手动强行停止App，提醒可能无法送达；重新打开App后会重新检查提醒状态，已经错过的提醒不会补发。
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" selectable>
              提醒不保证精确到秒，也不属于医疗提醒。
            </ThemedText>
          </View>
        ) : null}

        {__DEV__ && reminderInfoVisible ? (
          <View style={styles.developmentSection}>
            <AppButton
              accessibilityLabel={developmentVisible ? '收起开发验收工具' : '展开开发验收工具'}
              accessibilityState={{ expanded: developmentVisible }}
              compact
              label={developmentVisible ? '收起开发验收工具' : '开发验收工具'}
              onPress={() => setDevelopmentVisible((visible) => !visible)}
              variant="ghost"
            />
            {developmentVisible ? (
              <SectionCard elevated>
                <ThemedText type="smallBold">开发验收</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">独立的一分钟测试不会修改正式提醒间隔。</ThemedText>
                <View style={styles.developmentActions}>
                  <AppButton compact label="1分钟测试" accessibilityLabel="安排1分钟测试提醒" onPress={() => { void runDevelopmentAction(async () => {
                    await feedingReminderService.scheduleDevelopmentTestReminder();
                    return '一分钟测试提醒已安排。';
                  }); }} variant="secondary" />
                  <AppButton compact label="清理测试提醒" onPress={() => { void runDevelopmentAction(async () => {
                    await feedingReminderService.cancelDevelopmentTestReminders();
                    return '测试提醒已清理。';
                  }); }} variant="secondary" />
                  <AppButton compact label="制造重复提醒" accessibilityLabel="制造重复喝奶提醒" onPress={() => { void runDevelopmentAction(async () => {
                    const count = await feedingReminderService.createDevelopmentDuplicateFeedingReminders();
                    return `正式喝奶待提醒：${count}条。请点击重新同步验证收敛。`;
                  }); }} variant="secondary" />
                  <AppButton compact label="模拟系统丢失" onPress={() => { void runDevelopmentAction(async () => {
                    const count = await feedingReminderService.removeDevelopmentSystemFeedingReminders();
                    return `已从系统移除${count}条正式喝奶提醒。`;
                  }); }} variant="secondary" />
                  <AppButton compact label="重新同步" accessibilityLabel="开发环境重新同步提醒" onPress={() => { void runDevelopmentAction(async () => {
                    setStatus(await feedingReminderService.syncFeedingReminder());
                    return '重新同步完成。';
                  }); }} variant="secondary" />
                </View>
                {developmentMessage ? <ThemedText accessibilityLiveRegion="polite" type="small" selectable>{developmentMessage}</ThemedText> : null}
              </SectionCard>
            ) : null}
          </View>
        ) : null}
      </SettingsSection>

      <SettingsSection icon="appearance" title="外观">
        <View style={styles.options}>
          {([
            ['system', '跟随系统', '使用跟随系统模式'],
            ['light', '浅色', '使用浅色模式'],
            ['dark', '深色', '使用深色模式'],
          ] as const).map(([mode, label, accessibilityLabel]) => (
            <ChoiceChip
              key={mode}
              accessibilityLabel={accessibilityLabel}
              disabled={themeBusy}
              label={label}
              onPress={() => { void applyTheme(mode); }}
              selected={themeMode === mode}
              style={[styles.appearanceChoice, fontScale > 1.3 && styles.appearanceChoiceLarge]}
            />
          ))}
        </View>
      </SettingsSection>

      <SettingsSection icon="data" title="数据管理">
        <SectionCard>
          <Pressable
            accessibilityLabel="导出CSV"
            accessibilityHint="进入导出范围选择；用于查看和分享，不含照片"
            accessibilityRole="button"
            onPress={() => router.push('/export/csv')}
            style={({ pressed }) => [styles.dataRow, pressed && styles.pressed]}>
            <AppIcon color={theme.pee} name="export" size={28} />
            <View style={styles.dataCopy}>
              <ThemedText type="smallBold">导出CSV</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">用于查看和分享，不含照片</ThemedText>
            </View>
            <AppIcon color={theme.textSecondary} name="next" size={20} />
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.divider }]} />
          <Pressable
            accessibilityLabel="打开完整备份与恢复"
            accessibilityHint="进入备份与恢复流程，包含记录和照片"
            accessibilityRole="button"
            onPress={() => router.push('/backup')}
            style={({ pressed }) => [styles.dataRow, pressed && styles.pressed]}>
            <AppIcon color={theme.primary} name="backup" size={28} />
            <View style={styles.dataCopy}>
              <ThemedText type="smallBold">完整备份与恢复</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">包含记录和照片</ThemedText>
            </View>
            <AppIcon color={theme.textSecondary} name="next" size={20} />
          </Pressable>
        </SectionCard>
      </SettingsSection>

      <View style={styles.localInfo}>
        <ThemedText type="small" themeColor="textSecondary" selectable>
          资料、记录和照片保存在当前手机{ '\n' }无账号 · 无云同步 · 无产品服务器
        </ThemedText>
        <View style={styles.statusRow}>
          <ThemedText type="small" themeColor="textMuted">当前版本</ThemedText>
          <ThemedText type="small" themeColor="textMuted" selectable>{Constants.expoConfig?.version ?? '版本信息暂不可用'}</ThemedText>
        </View>
      </View>
    </NativeTabScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl, gap: Spacing.xxl },
  heading: { gap: Spacing.xl },
  title: { ...Typography.pageTitle },
  section: { gap: Spacing.md },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sectionTitle: { ...Typography.sectionTitle, flexShrink: 1 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.md, flexWrap: 'wrap' },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  profileCopy: { flex: 1, minWidth: 0, gap: Spacing.xs },
  profileName: { ...Typography.keyNumber },
  divider: { height: StyleSheet.hairlineWidth },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  reminderChoice: { flexGrow: 1, flexBasis: 64, paddingHorizontal: Spacing.xs },
  reminderChoiceWrapped: { flexBasis: '45%' },
  reminderStatus: { padding: Spacing.md, gap: Spacing.xs },
  reminderStatusHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: Spacing.sm, rowGap: Spacing.xs },
  appearanceChoice: { flexGrow: 1, flexBasis: 80, minWidth: 88 },
  appearanceChoiceLarge: { flexBasis: '100%' },
  customInputs: { flexDirection: 'row', gap: Spacing.md },
  customInput: { flex: 1, minWidth: 0 },
  statusRow: { minHeight: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.md, flexWrap: 'wrap' },
  explanation: { gap: Spacing.sm },
  explanationHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  explanationCopy: { flexGrow: 1, flexBasis: 200 },
  developmentSection: { gap: Spacing.sm },
  developmentActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  dataRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  dataCopy: { flex: 1, minWidth: 0, gap: Spacing.xs },
  localInfo: { gap: Spacing.sm },
  pressed: { opacity: 0.72 },
});
