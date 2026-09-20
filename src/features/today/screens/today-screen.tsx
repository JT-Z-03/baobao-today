import { PendingRecordsEntry } from '@/features/records/components/pending-records-entry';
import { formatRecordTime } from '@/domain/date/record-time-shortcuts';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState as NativeAppState, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import type { FeedingService } from '@/application/feeding/feeding-service';
import type { PoopService } from '@/application/poop/poop-service';
import type { PeeService } from '@/application/pee/pee-service';
import type { SleepService } from '@/application/sleep/sleep-service';
import type { OtherService } from '@/application/other/other-service';
import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { AppIllustration } from '@/components/ui/app-illustration';
import { BrandMark } from '@/components/ui/brand-mark';
import { timelineConnector } from '@/components/ui/timeline-row';
import { NativeTabScreenContainer } from '@/components/ui/screen-container';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/status-state';
import { Radius, Spacing, Typography, type ThemeColor } from '@/constants/theme';
import { calculateBirthDayNumber } from '@/domain/baby/baby-profile';
import { toLocalDateKey, parseLocalDateKey } from '@/domain/date/local-date';
import { sortRecordsByOccurrence } from '@/domain/timeline/timeline-projection';
import { FeedingRecordRow } from '@/features/feeding/components/feeding-record-row';
import { PoopRecordRow } from '@/features/poop/components/poop-record-row';
import { PeeRecordRow } from '@/features/pee/components/pee-record-row';
import { SleepRecordRow } from '@/features/sleep/components/sleep-record-row';
import { OtherRecordRow } from '@/features/other/components/other-record-row';
import { formatSleepDuration } from '@/features/sleep/sleep-format';
import {
  formatEventTime, formatFeedingDetails,
  formatRelativePastTime,
} from '@/features/feeding/feeding-format';
import { useTheme } from '@/hooks/use-theme';

type FeedingDashboard = Awaited<ReturnType<FeedingService['getDashboard']>>;
type Dashboard = {
  feeding: FeedingDashboard;
  poopTimeline: Awaited<ReturnType<PoopService['getHistory']>>;
  poopCount: number;
  peeTimeline: Awaited<ReturnType<PeeService['getHistory']>>;
  peeCount: number;
  sleep: Awaited<ReturnType<SleepService['getDashboard']>>;
  otherTimeline: Awaited<ReturnType<OtherService['getHistory']>>;
};

type QuickActionProps = {
  label: string;
  accessibilityLabel: string;
  accessibilityHint: string;
  icon: AppIconName;
  color: ThemeColor;
  container: ThemeColor;
  onPress(): void;
  wrap: boolean;
};

function QuickAction({ label, accessibilityLabel, accessibilityHint, icon, color, container, onPress, wrap }: QuickActionProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickButton,
        wrap && styles.quickWrapped,
        { backgroundColor: theme[container] },
        pressed && styles.pressed,
      ]}>
      <View style={styles.quickIcon}>
        <AppIcon color={theme[color]} name={icon} size={28} />
      </View>
      <ThemedText type="smallBold" style={styles.quickLabel}>{label}</ThemedText>
    </Pressable>
  );
}

function SleepMetricValue({ durationMs }: { durationMs: number }) {
  const compactDuration = formatSleepDuration(durationMs).replace('分钟', '分');
  return (
    <ThemedText style={Typography.keyNumber}>
      {compactDuration.split(/(\d+)/).map((part, index) => /^\d+$/.test(part)
        ? part
        : <ThemedText key={index} type="small">{part}</ThemedText>)}
    </ThemedText>
  );
}

export function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const wrapActions = Math.min(width, 640) - 40 < 320 || fontScale > 1.3;
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const { babyProfile, feedingService, poopService, peeService, sleepService, otherService } = useAppState();
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const todayDate = toLocalDateKey(clockNowMs);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void reloadKey;
      if (!feedingService || !poopService || !peeService || !sleepService || !otherService) return undefined;
      let active = true;
      const focusedDate = todayDate;
      setLoadError(null);
      setLoading(true);
      Promise.all([
        feedingService.getDashboard(focusedDate),
        poopService.getHistory(focusedDate),
        poopService.getDailyCount(focusedDate),
        peeService.getHistory(focusedDate),
        peeService.getDailyCount(focusedDate),
        sleepService.getDashboard(focusedDate),
        otherService.getHistory(focusedDate),
      ])
        .then(([feeding, poopTimeline, poopCount, peeTimeline, peeCount, sleep, otherTimeline]) => {
          if (active) {
            setClockNowMs(Date.now());
            setDashboard({ feeding, poopTimeline, poopCount, peeTimeline, peeCount, sleep, otherTimeline });
            setLoading(false);
          }
        })
        .catch((error) => {
          if (active) { setLoadError(error instanceof Error ? error.message : String(error)); setLoading(false); }
        });
      return () => {
        active = false;
      };
    }, [feedingService, otherService, poopService, peeService, sleepService, reloadKey, todayDate]),
  );

  useEffect(() => {
    const refresh = () => setClockNowMs(Date.now());
    const timer = setInterval(refresh, 60_000);
    const subscription = NativeAppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);

  if (!babyProfile || !feedingService || !poopService || !peeService || !sleepService || !otherService) return null;
  const birthDay = calculateBirthDayNumber(babyProfile.birthDate, todayDate);
  const openNewFeeding = () => router.push('/feeding/new');
  const openFeeding = (id: string) =>
    router.push({ pathname: '/feeding/[id]', params: { id } });
  const openNewPoop = () => router.push('/poop/new');
  const openPoop = (id: string) => router.push({ pathname: '/poop/[id]', params: { id } });
  const openNewPee = () => router.push('/pee/new');
  const openPee = (id: string) => router.push({ pathname: '/pee/[id]', params: { id } });
  const openSleep = () => {
    const active = dashboard?.sleep.active;
    if (active) router.push({ pathname: '/sleep/[id]', params: { id: active.id } });
    else router.push('/sleep/new');
  };
  const openSleepRecord = (id: string) => router.push({ pathname: '/sleep/[id]', params: { id } });
  const openNewOther = () => router.push('/other/new');
  const openOther = (id: string) => router.push({ pathname: '/other/[id]', params: { id } });
  const timeline = sortRecordsByOccurrence([
    ...(dashboard?.feeding.timeline ?? []),
    ...(dashboard?.poopTimeline ?? []),
    ...(dashboard?.peeTimeline ?? []),
    ...(dashboard?.sleep.timeline ?? []),
    ...(dashboard?.otherTimeline ?? []),
  ]);

  const visibleRecords = timeline.slice(0, 3);
  const date = parseLocalDateKey(todayDate);
  const todayLabel = `${date.getMonth() + 1}月 · 周${'日一二三四五六'[date.getDay()]}`;
  const breastSummary = dashboard?.feeding.breastfeeding ?? { count: 0, durationMin: 0 };
  const onlyBreast = breastSummary.count > 0 && dashboard?.feeding.summary.measurableTotalMl === 0;
  const quickActions = (
    <View style={[styles.quickTray, { backgroundColor: theme.primaryContainer }]}>
      <ThemedText style={Typography.fieldLabel}>记一笔</ThemedText>
      <View style={styles.quickGrid}>
        <QuickAction wrap={wrapActions} accessibilityHint="新建喝奶记录" accessibilityLabel="记录喝奶" color="feeding" container="feedingContainer" icon="feeding" label="喝奶" onPress={openNewFeeding} />
        <QuickAction wrap={wrapActions} accessibilityHint="新建大便记录" accessibilityLabel="记录大便" color="poop" container="poopContainer" icon="poop" label="大便" onPress={openNewPoop} />
        <QuickAction wrap={wrapActions} accessibilityHint="新建小便记录" accessibilityLabel="记录小便" color="pee" container="peeContainer" icon="pee" label="小便" onPress={openNewPee} />
        <QuickAction wrap={wrapActions} accessibilityHint={dashboard?.sleep.active ? '查看并结束当前睡眠记录' : '开始一条睡眠记录'} accessibilityLabel={dashboard?.sleep.active ? '查看进行中的睡眠' : '开始睡眠'} color="sleep" container="sleepContainer" icon="sleep" label="睡眠" onPress={openSleep} />
        <QuickAction wrap={wrapActions} accessibilityHint="新建其他记录" accessibilityLabel="记录其他事件" color="other" container="otherContainer" icon="other" label="其他" onPress={openNewOther} />
      </View>
    </View>
  );

  return (
    <NativeTabScreenContainer contentStyle={styles.content} footer={quickActions}>
      <View style={styles.brandRow}>
        <BrandMark />
        <AppIllustration name="happinessNote" width={104} height={40} />
      </View>
      <View style={[styles.hero, fontScale > 1.3 && styles.heroWrapped]}>
        <View style={styles.heroHeading}>
          <ThemedText accessibilityRole="header" style={Typography.heroTitle}>今天</ThemedText>
          <ThemedText style={styles.babyName} selectable>{babyProfile.name}的第 {birthDay} 天</ThemedText>
        </View>
        <AppIllustration name="babySmile" width={width < 360 ? 62 : 76} height={80} />
        <View style={[styles.dateBlock, { borderLeftColor: theme.divider }]}>
          <ThemedText themeColor="primary" style={Typography.heroTitle}>{date.getDate().toString().padStart(2, '0')}</ThemedText>
          <ThemedText type="small">{todayLabel}</ThemedText>
        </View>
      </View>

      {loading ? <LoadingState message="正在读取今天的记录" /> : loadError ? (
        <View style={styles.section}>
          <ErrorState message="今日记录加载失败，请重试。" />
          <AppButton label="重新加载" variant="secondary" onPress={() => setReloadKey((key) => key + 1)} />
        </View>
      ) : dashboard ? (
        <>
            <Pressable accessibilityRole="button" accessibilityLabel={dashboard.feeding.latest ? '编辑最近喝奶记录' : '新增喝奶记录'} onPress={() => dashboard.feeding.latest ? openFeeding(dashboard.feeding.latest.id) : openNewFeeding()} style={styles.latestLink}>
              <ThemedText themeColor="textSecondary">{dashboard.feeding.latest ? `上次喝奶${formatRelativePastTime(dashboard.feeding.latest.eventTimeMs, clockNowMs)}` : '还没有喝奶记录'}</ThemedText>
              {dashboard.feeding.latest ? <ThemedText type="small" themeColor="textSecondary">{formatRecordTime(dashboard.feeding.latest.eventTimeMs, clockNowMs)} · {formatFeedingDetails(dashboard.feeding.latest)}</ThemedText> : null}
            </Pressable>
          {dashboard.sleep.active ? (
            <View style={[styles.sleepingPanel, { backgroundColor: theme.primaryContainer }]}>
              {width >= 380 && fontScale <= 1.1 ? <AppIcon name="sleep" color={theme.sleep} size={20} /> : null}
              <View style={styles.sleepingCopy}>
                <ThemedText accessibilityLabel={`睡着啦，已睡${formatSleepDuration(clockNowMs - dashboard.sleep.active.startMs)}`} style={Typography.bodyStrong}>
                  睡着啦 · 已睡 {formatSleepDuration(clockNowMs - dashboard.sleep.active.startMs).replace('分钟', '分')}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{formatEventTime(dashboard.sleep.active.startMs)} 开始</ThemedText>
              </View>
              {fontScale <= 1.3 ? <AppIllustration name="babySleeping" width={40} height={32} /> : null}
              <AppButton label="醒了" accessibilityLabel="宝宝醒了" compact style={styles.wakeButton} onPress={openSleep} />
            </View>
          ) : null}
          <PendingRecordsEntry />
          <View style={styles.metrics}>
            <View accessible accessibilityLabel={`今日喝奶${dashboard.feeding.summary.feedingCount}次`} style={styles.metric}>
              <View style={styles.metricHeader}><AppIcon name="feeding" color={theme.feeding} size={22} /><ThemedText type="small" style={styles.metricLabel}>喝奶</ThemedText></View>
              <ThemedText style={Typography.keyNumber}>{dashboard.feeding.summary.feedingCount}<ThemedText> 次</ThemedText></ThemedText>
            </View>
            <View accessible accessibilityLabel={onlyBreast ? `今日亲喂${breastSummary.count}次，累计${breastSummary.durationMin}分钟` : `今日奶量${dashboard.feeding.summary.measurableTotalMl}毫升，不含亲喂`} style={[styles.metric, { borderLeftWidth: 1, borderLeftColor: theme.divider }]}>
              <View style={styles.metricHeader}><AppIcon name="milkVolume" color={theme.pee} size={22} /><ThemedText type="small" style={styles.metricLabel}>{onlyBreast ? '亲喂' : '奶量'}</ThemedText></View>
              <ThemedText style={Typography.keyNumber}>{onlyBreast ? breastSummary.durationMin : dashboard.feeding.summary.measurableTotalMl}<ThemedText type="small">{onlyBreast ? " 分钟" : " ml"}</ThemedText></ThemedText>
            </View>
            <View accessible accessibilityLabel={`今日已完成睡眠${formatSleepDuration(dashboard.sleep.completedTotalMs)}`} style={[styles.metric, styles.sleepMetric, { borderLeftWidth: 1, borderLeftColor: theme.divider }]}>
              <View style={styles.metricHeader}><AppIcon name="sleep" color={theme.sleep} size={22} /><ThemedText type="small" style={styles.metricLabel}>已完成睡眠</ThemedText></View>
              <SleepMetricValue durationMs={dashboard.sleep.completedTotalMs} />
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">{onlyBreast ? `亲喂 ${breastSummary.count} 次` : `奶量不含亲喂${breastSummary.count ? ` · 亲喂 ${breastSummary.count} 次 / ${breastSummary.durationMin} 分钟` : ""}`}</ThemedText>
          <ThemedText accessibilityLabel={`今日小便${dashboard.peeCount}次，大便${dashboard.poopCount}次`}>小便 {dashboard.peeCount} 次 · 大便 {dashboard.poopCount} 次</ThemedText>
          <View>
            <Pressable accessibilityRole="button" accessibilityLabel={detailsVisible ? '收起今日明细' : '展开今日明细'} accessibilityState={{ expanded: detailsVisible }} onPress={() => setDetailsVisible((value) => !value)} style={styles.detailsToggle}>
              <ThemedText type="small" themeColor="textSecondary">今日明细</ThemedText>
              <AppIcon name={detailsVisible ? 'previous' : 'next'} color={theme.textSecondary} size={14} />
            </Pressable>
            {detailsVisible ? <View style={[styles.details, { backgroundColor: theme.surfaceElevated }]}>
              <ThemedText accessibilityLabel={`今日奶粉${dashboard.feeding.summary.formulaTotalMl}毫升`}>奶粉 {dashboard.feeding.summary.formulaTotalMl} ml</ThemedText>
              <ThemedText accessibilityLabel={`今日瓶喂母乳${dashboard.feeding.summary.breastMilkTotalMl}毫升`}>瓶喂母乳 {dashboard.feeding.summary.breastMilkTotalMl} ml</ThemedText>
            </View> : null}
          </View>
          <View style={styles.section}>
            <ThemedText accessibilityRole="header" style={Typography.sectionTitle}>今天的小脚印</ThemedText>
            {visibleRecords.length ? <View>
              {visibleRecords.map((record, index) => {
                const connector = timelineConnector(index, visibleRecords.length);
                if (record.type === 'feeding') return <FeedingRecordRow key={record.id} connector={connector} record={record} onPress={() => openFeeding(record.id)} />;
                if (record.type === 'poop') return <PoopRecordRow key={record.id} connector={connector} record={record} onPress={() => openPoop(record.id)} />;
                if (record.type === 'sleep-occurrence') return <SleepRecordRow key={`${record.recordId}-${record.kind}-${record.occurrenceTimeMs}`} connector={connector} occurrence={record} onPress={() => openSleepRecord(record.recordId)} />;
                if (record.type === 'other') return <OtherRecordRow key={record.id} connector={connector} record={record} onPress={() => openOther(record.id)} />;
                return <PeeRecordRow key={record.id} connector={connector} record={record} onPress={() => openPee(record.id)} />;
              })}
            </View> : <EmptyState message="今天还没有记录" detail="点下方“记一笔”，留住宝宝的小日常。" />}
            <Pressable accessibilityRole="button" accessibilityLabel="查看今天全部记录" onPress={() => router.navigate({ pathname: '/records', params: { date: toLocalDateKey(Date.now()) } })} style={styles.viewAll}>
              <ThemedText themeColor="textSecondary">查看全部</ThemedText><AppIcon name="next" size={16} color={theme.textSecondary} />
            </Pressable>
          </View>
        </>
      ) : null}
    </NativeTabScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.sm, paddingTop: Spacing.xs },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  heroWrapped: { flexWrap: 'wrap' },
  heroHeading: { flex: 1, minWidth: 100 },
  babyName: { flexShrink: 1 },
  dateBlock: { borderLeftWidth: 1, paddingLeft: Spacing.md, alignItems: 'center' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.md },
  metric: { flex: 1, minWidth: 85, gap: Spacing.xs, paddingHorizontal: Spacing.xs },
  metricHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  metricLabel: { flexShrink: 1 },
  sleepMetric: { flexGrow: 1.6 },
  detailsToggle: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center', minHeight: 48, alignSelf: 'flex-start' },
  details: { borderRadius: Radius.control, padding: Spacing.md, gap: Spacing.sm },
  sleepingPanel: { borderRadius: Radius.card, padding: Spacing.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  sleepingCopy: { flex: 1, minWidth: 100, gap: Spacing.xs },
  wakeButton: { minWidth: 64, paddingHorizontal: Spacing.md, alignSelf: 'center' },
  section: { gap: Spacing.xs },
  latestLink: { minHeight: 48, justifyContent: 'center' },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: 48, alignSelf: 'flex-start' },
  quickTray: { borderRadius: Radius.card, padding: Spacing.md, gap: Spacing.sm },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  quickButton: { flex: 1, minWidth: 0, minHeight: 74, borderRadius: Radius.control, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.xs, paddingVertical: Spacing.sm },
  quickWrapped: { flexBasis: '30%', flexGrow: 1 },
  quickIcon: { alignItems: 'center', justifyContent: 'center', width: 32, height: 32 },
  quickLabel: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
