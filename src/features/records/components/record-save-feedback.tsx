import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton } from '@/components/ui/app-button';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/constants/theme';
import { RECORD_KIND_LABELS, type RecordKind } from '@/domain/drafts/record-draft';
import { formatRecordTime } from '@/domain/date/record-time-shortcuts';

type Feedback = { kind: RecordKind; id: string; message: string };
const listeners = new Set<(feedback: Feedback) => void>();
export function showRecordSaved(kind: RecordKind, record: Record<string, unknown>) {
  const timestamp = Number(record.eventTimeMs ?? record.startMs ?? Date.now());
  const details = kind === 'feeding'
    ? [record.milkAmountMl ? `奶粉 ${record.milkAmountMl} ml` : '', record.breastMilkAmountMl ? `瓶喂母乳 ${record.breastMilkAmountMl} ml` : '',
      Number(record.leftDurationMin) + Number(record.rightDurationMin) > 0 ? `亲喂 ${Number(record.leftDurationMin) + Number(record.rightDurationMin)} 分钟` : ''].filter(Boolean).join('，')
    : RECORD_KIND_LABELS[kind];
  const feedback = { kind, id: String(record.id), message: `已记录：${formatRecordTime(timestamp, Date.now())}，${details}` };
  listeners.forEach((listener) => listener(feedback));
}

export function RecordSaveFeedback() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [screenReader, setScreenReader] = useState(true);
  const [focused, setFocused] = useState(false);
  const theme = useTheme(); const router = useRouter(); const insets = useSafeAreaInsets();
  useEffect(() => {
    const receive = (value: Feedback) => { setFocused(false); setFeedback(value); };
    listeners.add(receive);
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => { listeners.delete(receive); subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!feedback || screenReader || focused) return;
    const timer = setTimeout(() => setFeedback(null), 7_000);
    return () => clearTimeout(timer);
  }, [feedback, screenReader, focused]);
  if (!feedback) return null;
  return <View style={[styles.box, { marginBottom: insets.bottom + 12, backgroundColor: theme.surface, borderColor: theme.border }]}>
    <ThemedText accessibilityLiveRegion="polite">{feedback.message}</ThemedText>
    <View style={styles.actions}>
      <AppButton onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} label="查看 / 修改" variant="secondary" onPress={() => {
        const target = `/${feedback.kind}/${feedback.id}` as Href; setFeedback(null); setFocused(false); router.push(target);
      }} />
      <AppButton onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} label="知道了" variant="secondary" onPress={() => { setFeedback(null); setFocused(false); }} />
    </View>
  </View>;
}
const styles = StyleSheet.create({ box: { marginHorizontal: 12, marginTop: 8, flexShrink: 0, borderWidth: 1, borderRadius: Radius.card,
  padding: Spacing.md, gap: Spacing.sm, elevation: 8 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm } });
