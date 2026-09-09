import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/app-icon';
import { AppIllustration } from '@/components/ui/app-illustration';
import { BrandMark } from '@/components/ui/brand-mark';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { NativeTabScreenContainer } from '@/components/ui/screen-container';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/status-state';
import { Radius, Spacing, Typography } from '@/constants/theme';
import type { FeedingRecord } from '@/domain/feeding/feeding';
import type { PoopRecord } from '@/domain/poop/poop';
import type { PeeRecord } from '@/domain/pee/pee';
import type { SleepRecord } from '@/domain/sleep/sleep';
import type { OtherRecord } from '@/domain/other/other';
import { parseLocalDateKey, shiftLocalDateKey, toLocalDateKey } from '@/domain/date/local-date';
import { sortRecordsByOccurrence } from '@/domain/timeline/timeline-projection';
import { FeedingRecordRow } from '@/features/feeding/components/feeding-record-row';
import { PoopRecordRow } from '@/features/poop/components/poop-record-row';
import { PeeRecordRow } from '@/features/pee/components/pee-record-row';
import { SleepHistoryRow } from '@/features/sleep/components/sleep-history-row';
import { OtherRecordRow } from '@/features/other/components/other-record-row';
import { resolveRecordsDateIntent } from '@/features/records/records-navigation';
import { useTheme } from '@/hooks/use-theme';

type Filter = 'all' | 'feeding' | 'poop' | 'pee' | 'sleep' | 'other';
type DailyRecord = FeedingRecord | PoopRecord | PeeRecord | SleepRecord | OtherRecord;

function formatDateTitle(dateKey: string) {
  const date = parseLocalDateKey(dateKey);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]}`;
}

export function RecordsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { date: dateIntent } = useLocalSearchParams<{ date?: string | string[] }>();
  const { babyProfile, feedingService, poopService, peeService, sleepService, otherService } = useAppState();
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateKey(Date.now()));
  const [filter, setFilter] = useState<Filter>('all');
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [today, setToday] = useState(() => toLocalDateKey(Date.now()));
  const [refreshedAtMs, setRefreshedAtMs] = useState(() => Date.now());

  useFocusEffect(useCallback(() => {
    const intendedDate = resolveRecordsDateIntent(dateIntent, toLocalDateKey(Date.now()));
    if (intendedDate === null) return;
    setSelectedDate(intendedDate);
    setFilter('all');
    setDatePickerVisible(false);
    router.setParams({ date: undefined });
  }, [dateIntent, router]));

  useFocusEffect(
    useCallback(() => {
      // The explicit retry generation reruns the focused read after a failed request.
      void reloadKey;
      if (!feedingService || !poopService || !peeService || !sleepService || !otherService) return undefined;
      let active = true;
      setToday(toLocalDateKey(Date.now()));
      setRefreshedAtMs(Date.now());
      setLoadError(null);
      setLoading(true);
      Promise.all([
        feedingService.getHistory(selectedDate),
        poopService.getHistory(selectedDate),
        peeService.getHistory(selectedDate),
        sleepService.getSourceHistory(selectedDate),
        otherService.getHistory(selectedDate),
      ])
        .then(([feeding, poop, pee, sleep, other]) => {
          if (active) {
            setRecords(sortRecordsByOccurrence([...feeding, ...poop, ...pee, ...sleep, ...other]));
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) {
            setLoadError('历史记录加载失败，请重试。');
            setLoading(false);
          }
        });
      return () => {
        active = false;
      };
    }, [feedingService, otherService, poopService, peeService, reloadKey, selectedDate, sleepService]),
  );

  const hasActiveSleep = records.some((record) => record.type === 'sleep' && record.status === 'sleeping');
  useFocusEffect(useCallback(() => {
    if (!hasActiveSleep) return;
    const timer = setInterval(() => setRefreshedAtMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [hasActiveSleep]));

  if (!feedingService || !poopService || !peeService || !sleepService || !otherService) return null;
  const handleDateChange = (_event: DateTimePickerChangeEvent, date: Date) => {
    setDatePickerVisible(false);
    setSelectedDate(toLocalDateKey(date.getTime()));
  };
  const openRecord = (id: string) =>
    router.push({ pathname: '/feeding/[id]', params: { id } });
  const openPoop = (id: string) => router.push({ pathname: '/poop/[id]', params: { id } });
  const openPee = (id: string) => router.push({ pathname: '/pee/[id]', params: { id } });
  const openSleep = (id: string) => router.push({ pathname: '/sleep/[id]', params: { id } });
  const openOther = (id: string) => router.push({ pathname: '/other/[id]', params: { id } });
  const visibleRecords = filter === 'all' ? records : records.filter((record) => record.type === filter);
  const selectedDay = parseLocalDateKey(selectedDate);

  return (
    <NativeTabScreenContainer contentStyle={styles.content}>
      <View style={styles.heading}>
        <BrandMark />
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <ThemedText style={styles.title} selectable>记录</ThemedText>
            <ThemedText selectable>{babyProfile ? `${babyProfile.name}的每一天` : '宝宝的每一天'}</ThemedText>
          </View>
          <AppIllustration name="babySmile" width={80} height={80} />
        </View>
        <View style={[styles.dateControls, { backgroundColor: theme.primaryContainer }]}>
          <Pressable
            accessibilityHint="查看前一天记录"
            accessibilityLabel="前一天"
            accessibilityRole="button"
            onPress={() => setSelectedDate((date) => shiftLocalDateKey(date, -1))}
            style={[styles.arrowButton, { backgroundColor: theme.surface }]}>
            <AppIcon color={theme.primaryOnContainer} name="previous" size={24} />
          </Pressable>
          <Pressable
            accessibilityHint="打开日期选择器"
            accessibilityLabel="选择记录日期"
            accessibilityRole="button"
            onPress={() => setDatePickerVisible(true)}
            style={styles.dateButton}>
            <AppIcon color={theme.primary} name="calendar" size={20} />
            <ThemedText style={styles.dateText}>{formatDateTitle(selectedDate)}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityHint="查看后一天记录"
            accessibilityLabel="后一天"
            accessibilityRole="button"
            accessibilityState={{ disabled: selectedDate >= today }}
            disabled={selectedDate >= today}
            onPress={() => setSelectedDate((date) => shiftLocalDateKey(date, 1))}
            style={[styles.arrowButton, { backgroundColor: theme.surface }, selectedDate >= today && styles.disabled]}>
            <AppIcon color={theme.textPrimary} name="next" size={24} />
          </Pressable>
        </View>
        {datePickerVisible && (
          <DateTimePicker
            value={parseLocalDateKey(selectedDate)}
            mode="date"
            display="default"
            maximumDate={parseLocalDateKey(today)}
            onValueChange={handleDateChange}
            onDismiss={() => setDatePickerVisible(false)}
          />
        )}
      </View>

      <ScrollView
        accessibilityLabel="记录类型筛选"
        contentContainerStyle={styles.filterContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}>
        {([
          ['all', '全部'],
          ['feeding', '喝奶'],
          ['poop', '大便'],
          ['pee', '小便'],
          ['sleep', '睡眠'],
          ['other', '其他'],
        ] as const).map(([value, label]) => {
          const selected = filter === value;
          return (
            <ChoiceChip
              key={value}
              accessibilityLabel={`筛选${label}${selected ? '，已选择' : ''}`}
              label={label}
              onPress={() => setFilter(value)}
              selected={selected}
            />
          );
        })}
      </ScrollView>

      <View style={[styles.dayLabel, { backgroundColor: theme.primaryContainer }]}>
        <ThemedText type="smallBold" selectable>
          {selectedDay.getMonth() + 1}月{selectedDay.getDate()}日{selectedDate === today ? ' · 今天' : ''}
        </ThemedText>
      </View>

      {loading ? (
        <LoadingState message="正在读取这一天的记录" />
      ) : loadError ? (
        <ErrorState message={loadError} actionLabel="重新加载历史记录" onAction={() => setReloadKey((value) => value + 1)} />
      ) : visibleRecords.length ? (
        <View style={styles.list}>
          {visibleRecords.map((record, index) => {
            const connector = visibleRecords.length === 1 ? 'single' : index === 0 ? 'start' : index === visibleRecords.length - 1 ? 'end' : 'middle';
            if (record.type === 'feeding') {
              return <FeedingRecordRow key={record.id} record={record} connector={connector} onPress={() => openRecord(record.id)} />;
            }
            if (record.type === 'poop') {
              return <PoopRecordRow key={record.id} record={record} connector={connector} onPress={() => openPoop(record.id)} />;
            }
            if (record.type === 'sleep') {
              return (
                <SleepHistoryRow
                  key={record.id}
                  record={record}
                  connector={connector}
                  nowMs={refreshedAtMs}
                  onPress={() => openSleep(record.id)}
                />
              );
            }
            if (record.type === 'other') {
              return <OtherRecordRow key={record.id} record={record} connector={connector} onPress={() => openOther(record.id)} />;
            }
            return <PeeRecordRow key={record.id} record={record} connector={connector} onPress={() => openPee(record.id)} />;
          })}
        </View>
      ) : (
        <EmptyState message={filter === 'feeding'
            ? '这一天还没有喝奶记录'
            : filter === 'poop'
              ? '这一天还没有大便记录'
              : filter === 'pee'
                ? '这一天还没有小便记录'
                : filter === 'sleep'
                  ? '这一天还没有睡眠记录'
                  : filter === 'other'
                  ? '这一天还没有其他记录'
                : '这一天还没有记录'} />
      )}
    </NativeTabScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.xxl, gap: Spacing.lg },
  heading: { paddingTop: Spacing.xs, gap: Spacing.xl },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  heroCopy: { flex: 1, minWidth: 0, gap: Spacing.xs },
  title: { ...Typography.pageTitle },
  dateControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, padding: Spacing.sm, borderRadius: Radius.card },
  arrowButton: { width: 48, minHeight: 48, borderRadius: Radius.control, alignItems: 'center', justifyContent: 'center' },
  dateButton: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.xs },
  dateText: { textAlign: 'center', flexShrink: 1 },
  filterScroll: { flexGrow: 0 },
  filterContent: { gap: Spacing.sm, paddingRight: Spacing.lg },
  dayLabel: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.control },
  list: { gap: 0 },
  disabled: { opacity: 0.35 },
});
