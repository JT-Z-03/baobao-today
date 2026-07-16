import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState as NativeAppState, Pressable, StyleSheet, View } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import type { FeedingService } from '@/application/feeding/feeding-service';
import type { PoopService } from '@/application/poop/poop-service';
import type { PeeService } from '@/application/pee/pee-service';
import type { SleepService } from '@/application/sleep/sleep-service';
import type { OtherService } from '@/application/other/other-service';
import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { SectionCard } from '@/components/ui/section-card';
import { NativeTabScreenContainer } from '@/components/ui/screen-container';
import { EmptyState, ErrorState } from '@/components/ui/status-state';
import { Radius, Spacing, Typography, type ThemeColor } from '@/constants/theme';
import { calculateBirthDayNumber } from '@/domain/baby/baby-profile';
import { toLocalDateKey } from '@/domain/date/local-date';
import { sortRecordsByOccurrence } from '@/domain/timeline/timeline-projection';
import { FeedingRecordRow } from '@/features/feeding/components/feeding-record-row';
import { PoopRecordRow } from '@/features/poop/components/poop-record-row';
import { PeeRecordRow } from '@/features/pee/components/pee-record-row';
import { SleepRecordRow } from '@/features/sleep/components/sleep-record-row';
import { OtherRecordRow } from '@/features/other/components/other-record-row';
import { formatSleepDuration } from '@/features/sleep/sleep-format';
import {
  formatEventTime,
  formatFeedingDetails,
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
};

function QuickAction({ label, accessibilityLabel, accessibilityHint, icon, color, container, onPress }: QuickActionProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickButton,
        { backgroundColor: theme[container], borderColor: theme[color] },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.quickIcon, { backgroundColor: theme.surface }]}>
        <AppIcon color={theme[color]} name={icon} size={24} />
      </View>
      <ThemedText type="smallBold" style={styles.quickLabel}>{label}</ThemedText>
    </Pressable>
  );
}

export function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { babyProfile, feedingService, poopService, peeService, sleepService, otherService } = useAppState();
  const [todayDate, setTodayDate] = useState(() => toLocalDateKey(Date.now()));
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());

  useFocusEffect(
    useCallback(() => {
      if (!feedingService || !poopService || !peeService || !sleepService || !otherService) return undefined;
      let active = true;
      const focusedDate = toLocalDateKey(Date.now());
      setTodayDate(focusedDate);
      setLoadError(null);
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
          }
        })
        .catch((error) => {
          if (active) setLoadError(error instanceof Error ? error.message : String(error));
        });
      return () => {
        active = false;
      };
    }, [feedingService, otherService, poopService, peeService, sleepService]),
  );

  useEffect(() => {
    if (!dashboard?.sleep.active) return;
    const refresh = () => setClockNowMs(Date.now());
    const timer = setInterval(refresh, 60_000);
    const subscription = NativeAppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [dashboard?.sleep.active]);

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

  return (
    <NativeTabScreenContainer contentStyle={styles.content}>
      <View style={styles.heading}>
        <ThemedText numberOfLines={2} style={styles.title} selectable>
          {babyProfile.name}
        </ThemedText>
        <ThemedText themeColor="textSecondary" selectable>
          出生第 {birthDay} 天
        </ThemedText>
      </View>

      {dashboard?.sleep.active && (
        <SectionCard style={[styles.sleepingPanel, { backgroundColor: theme.sleepContainer, borderColor: theme.sleep }]}>
          <View style={styles.sleepingHeading}>
            <AppIcon color={theme.sleep} name="sleep" size={24} />
            <View style={styles.sleepingCopy}>
              <ThemedText type="smallBold">宝宝正在睡觉</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" selectable>开始于 {formatEventTime(dashboard.sleep.active.startMs)}</ThemedText>
            </View>
          </View>
          <ThemedText style={styles.sleepingValue} selectable>已睡 {formatSleepDuration(clockNowMs - dashboard.sleep.active.startMs)}</ThemedText>
          <AppButton accessibilityLabel="宝宝醒了" label="醒了" onPress={openSleep} />
        </SectionCard>
      )}

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle} selectable>
          最近喝奶
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dashboard?.feeding.latest ? '编辑最近喝奶记录' : '新增喝奶记录'}
          onPress={() => (dashboard?.feeding.latest ? openFeeding(dashboard.feeding.latest.id) : openNewFeeding())}
          style={({ pressed }) => pressed && styles.pressed}>
          <SectionCard style={styles.latestPanel}>
            {dashboard?.feeding.latest ? (
              <>
                <View style={styles.latestMain}>
                  <AppIcon color={theme.feeding} name="feeding" size={24} />
                  <ThemedText style={styles.latestValue} selectable>{formatEventTime(dashboard.feeding.latest.eventTimeMs)} · {formatFeedingDetails(dashboard.feeding.latest)}</ThemedText>
                </View>
                <ThemedText themeColor="textSecondary" type="small" selectable>
                  {formatRelativePastTime(dashboard.feeding.latest.eventTimeMs, dashboard.feeding.refreshedAtMs)}
                </ThemedText>
              </>
            ) : (
              <ThemedText themeColor="textSecondary" selectable>
                还没有喝奶记录
              </ThemedText>
            )}
          </SectionCard>
        </Pressable>
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle} selectable>
          快速记录
        </ThemedText>
        <View style={styles.quickGrid}>
          <QuickAction accessibilityHint="新建喝奶记录" accessibilityLabel="记录喝奶" color="feeding" container="feedingContainer" icon="feeding" label="喝奶" onPress={openNewFeeding} />
          <QuickAction accessibilityHint="新建大便记录" accessibilityLabel="记录大便" color="poop" container="poopContainer" icon="poop" label="大便" onPress={openNewPoop} />
          <QuickAction accessibilityHint="新建小便记录" accessibilityLabel="记录小便" color="pee" container="peeContainer" icon="pee" label="小便" onPress={openNewPee} />
          <QuickAction
            accessibilityHint={dashboard?.sleep.active ? '查看并结束当前睡眠记录' : '开始一条睡眠记录'}
            accessibilityLabel={dashboard?.sleep.active ? '查看进行中的睡眠' : '开始睡眠'}
            color="sleep"
            container="sleepContainer"
            icon="sleep"
            label="睡眠"
            onPress={openSleep}
          />
          <QuickAction accessibilityHint="新建其他记录" accessibilityLabel="记录其他事件" color="other" container="otherContainer" icon="other" label="其他" onPress={openNewOther} />
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle} selectable>
          今日概览
        </ThemedText>
        <View style={styles.metrics}>
          <SectionCard style={styles.metric}>
            <ThemedText type="small" themeColor="textSecondary">喝奶</ThemedText>
            <ThemedText style={styles.metricValue} selectable>
              {dashboard?.feeding.summary.feedingCount ?? 0}次
            </ThemedText>
          </SectionCard>
          <SectionCard style={styles.metric}>
            <ThemedText type="small" themeColor="textSecondary">睡眠</ThemedText>
            <ThemedText style={styles.metricValue} selectable>
              {formatSleepDuration(dashboard?.sleep.completedTotalMs ?? 0)}
            </ThemedText>
          </SectionCard>
          <SectionCard style={styles.metric}>
            <ThemedText type="small" themeColor="textSecondary">奶粉</ThemedText>
            <ThemedText style={styles.metricValue} selectable>
              {dashboard?.feeding.summary.formulaTotalMl ?? 0}ml
            </ThemedText>
          </SectionCard>
          <SectionCard style={styles.metric}>
            <ThemedText type="small" themeColor="textSecondary">大便</ThemedText>
            <ThemedText style={styles.metricValue} selectable>{dashboard?.poopCount ?? 0}次</ThemedText>
          </SectionCard>
          <SectionCard style={styles.metric}>
            <ThemedText type="small" themeColor="textSecondary">小便</ThemedText>
            <ThemedText style={styles.metricValue} selectable>{dashboard?.peeCount ?? 0}次</ThemedText>
          </SectionCard>
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle} selectable>
          今日时间线
        </ThemedText>
        {loadError ? (
          <ErrorState message="今日记录加载失败，请重新进入页面重试。" />
        ) : timeline.length ? (
          <View style={styles.timeline}>
            {timeline.map((record) => {
              if (record.type === 'feeding') {
                return <FeedingRecordRow key={record.id} record={record} onPress={() => openFeeding(record.id)} />;
              }
              if (record.type === 'poop') {
                return <PoopRecordRow key={record.id} record={record} onPress={() => openPoop(record.id)} />;
              }
              if (record.type === 'sleep-occurrence') {
                return (
                  <SleepRecordRow
                    key={`${record.recordId}-${record.kind}-${record.occurrenceTimeMs}`}
                    occurrence={record}
                    onPress={() => openSleepRecord(record.recordId)}
                  />
                );
              }
              if (record.type === 'other') {
                return <OtherRecordRow key={record.id} record={record} onPress={() => openOther(record.id)} />;
              }
              return <PeeRecordRow key={record.id} record={record} onPress={() => openPee(record.id)} />;
            })}
          </View>
        ) : (
          <EmptyState message="今天还没有记录" detail="使用上方快捷入口即可开始记录。" />
        )}
      </View>
    </NativeTabScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: 120, gap: Spacing.xxl },
  heading: { paddingTop: Spacing.xs, gap: Spacing.xs },
  title: { ...Typography.pageTitle },
  section: { gap: Spacing.md },
  sectionTitle: { ...Typography.sectionTitle },
  latestPanel: { minHeight: 88, justifyContent: 'center' },
  latestMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  latestValue: { ...Typography.bodyStrong, flex: 1 },
  sleepingPanel: { minHeight: 120, borderWidth: 1 },
  sleepingHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sleepingCopy: { flex: 1, gap: Spacing.xs },
  sleepingValue: { ...Typography.keyNumber },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  quickButton: { flexBasis: '30%', flexGrow: 1, minWidth: 100, minHeight: 76, borderRadius: Radius.card, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  quickIcon: { width: 36, height: 36, borderRadius: Radius.card, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { textAlign: 'center' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  metric: { flexBasis: 104, flexGrow: 1, minHeight: 84, padding: Spacing.md, gap: Spacing.xs },
  metricValue: { ...Typography.keyNumber, fontSize: 22, lineHeight: 28 },
  timeline: { gap: Spacing.sm },
  pressed: { opacity: 0.7 },
});
