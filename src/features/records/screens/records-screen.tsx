import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import { ThemedText } from '@/components/themed-text';
import { AppIcon } from '@/components/ui/app-icon';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { NativeTabScreenContainer } from '@/components/ui/screen-container';
import { EmptyState, ErrorState } from '@/components/ui/status-state';
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
import { useTheme } from '@/hooks/use-theme';

type Filter = 'all' | 'feeding' | 'poop' | 'pee' | 'sleep' | 'other';
type DailyRecord = FeedingRecord | PoopRecord | PeeRecord | SleepRecord | OtherRecord;

function formatDateTitle(dateKey: string) {
  const date = parseLocalDateKey(dateKey);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function RecordsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { feedingService, poopService, peeService, sleepService, otherService } = useAppState();
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateKey(Date.now()));
  const [filter, setFilter] = useState<Filter>('all');
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [today, setToday] = useState(() => toLocalDateKey(Date.now()));
  const [refreshedAtMs, setRefreshedAtMs] = useState(() => Date.now());

  useFocusEffect(
    useCallback(() => {
      if (!feedingService || !poopService || !peeService || !sleepService || !otherService) return undefined;
      let active = true;
      setToday(toLocalDateKey(Date.now()));
      setRefreshedAtMs(Date.now());
      setLoadError(null);
      Promise.all([
        feedingService.getHistory(selectedDate),
        poopService.getHistory(selectedDate),
        peeService.getHistory(selectedDate),
        sleepService.getSourceHistory(selectedDate),
        otherService.getHistory(selectedDate),
      ])
        .then(([feeding, poop, pee, sleep, other]) => {
          if (active) setRecords(sortRecordsByOccurrence([...feeding, ...poop, ...pee, ...sleep, ...other]));
        })
        .catch((error) => {
          if (active) setLoadError(error instanceof Error ? error.message : String(error));
        });
      return () => {
        active = false;
      };
    }, [feedingService, otherService, poopService, peeService, selectedDate, sleepService]),
  );

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

  return (
    <NativeTabScreenContainer contentStyle={styles.content}>
      <View style={styles.heading}>
        <ThemedText style={styles.title} selectable>记录</ThemedText>
        <View style={styles.dateControls}>
          <Pressable
            accessibilityHint="查看前一天记录"
            accessibilityLabel="前一天"
            accessibilityRole="button"
            onPress={() => setSelectedDate((date) => shiftLocalDateKey(date, -1))}
            style={[styles.arrowButton, { borderColor: theme.border }]}>
            <AppIcon color={theme.textPrimary} name="previous" size={24} />
          </Pressable>
          <Pressable
            accessibilityHint="打开日期选择器"
            accessibilityLabel="选择记录日期"
            accessibilityRole="button"
            onPress={() => setDatePickerVisible(true)}
            style={[styles.dateButton, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <AppIcon color={theme.primary} name="calendar" size={20} />
            <ThemedText numberOfLines={2} style={styles.dateText} selectable>{formatDateTitle(selectedDate)}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityHint="查看后一天记录"
            accessibilityLabel="后一天"
            accessibilityRole="button"
            accessibilityState={{ disabled: selectedDate >= today }}
            disabled={selectedDate >= today}
            onPress={() => setSelectedDate((date) => shiftLocalDateKey(date, 1))}
            style={[styles.arrowButton, { borderColor: theme.border }, selectedDate >= today && styles.disabled]}>
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

      {loadError ? (
        <ErrorState message="历史记录加载失败，请重新进入页面重试。" />
      ) : visibleRecords.length ? (
        <View style={styles.list}>
          {visibleRecords.map((record) => {
            if (record.type === 'feeding') {
              return <FeedingRecordRow key={record.id} record={record} onPress={() => openRecord(record.id)} />;
            }
            if (record.type === 'poop') {
              return <PoopRecordRow key={record.id} record={record} onPress={() => openPoop(record.id)} />;
            }
            if (record.type === 'sleep') {
              return (
                <SleepHistoryRow
                  key={record.id}
                  record={record}
                  nowMs={refreshedAtMs}
                  onPress={() => openSleep(record.id)}
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
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: 120, gap: Spacing.xl },
  heading: { paddingTop: Spacing.xs, gap: Spacing.md },
  title: { ...Typography.pageTitle },
  dateControls: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.sm },
  arrowButton: { width: 48, minHeight: 52, borderWidth: 1, borderRadius: Radius.card, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  dateButton: { flex: 1, minWidth: 0, minHeight: 52, borderWidth: 1, borderRadius: Radius.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.sm },
  dateText: { textAlign: 'center', flexShrink: 1 },
  filterScroll: { flexGrow: 0 },
  filterContent: { gap: Spacing.sm, paddingRight: Spacing.lg },
  list: { gap: Spacing.sm },
  disabled: { opacity: 0.35 },
});
