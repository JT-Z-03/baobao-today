import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, View } from 'react-native';

import { useAppState } from '@/application/app-state/app-state-provider';
import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppIllustration } from '@/components/ui/app-illustration';
import { AppTextInput } from '@/components/ui/app-text-input';
import { FormField } from '@/components/ui/form-field';
import { keyboardAvoidingBehavior, useFormKeyboardVerticalOffset } from '@/components/ui/keyboard-behavior';
import { ScreenContainer } from '@/components/ui/screen-container';
import { SectionCard } from '@/components/ui/section-card';
import { Radius, Spacing, Typography } from '@/constants/theme';
import { toLocalDateKey } from '@/domain/date/local-date';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';
import { useTheme } from '@/hooks/use-theme';

export function BabySetupScreen() {
  const theme = useTheme();
  const keyboardVerticalOffset = useFormKeyboardVerticalOffset(false);
  const router = useRouter();
  const { saveInitialBabyProfile } = useAppState();
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState(() => new Date());
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleDateChange = (_event: DateTimePickerChangeEvent, selectedDate: Date) => {
    setDatePickerVisible(false);
    setBirthDate(selectedDate);
  };

  const handleSubmit = async () => {
    if (saving) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const result = await saveInitialBabyProfile({ name, birthDate: toLocalDateKey(birthDate.getTime()) });
      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }
      router.replace('/today');
    } catch (error) {
      setErrorMessage(toSafeUiMessage(error, '宝宝资料保存失败，请重试。'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.background }]}
      behavior={keyboardAvoidingBehavior()}
      keyboardVerticalOffset={keyboardVerticalOffset}>
      <ScreenContainer contentStyle={styles.content}>
        <View style={styles.heading}>
          <View style={styles.hero}>
            <ThemedText style={styles.title} selectable>宝宝今天</ThemedText>
            <AppIllustration name="babySmile" width={80} height={80} />
          </View>
          <ThemedText themeColor="textSecondary" selectable>填写两项资料，就可以开始记录</ThemedText>
          <ThemedText type="small" themeColor="textMuted" selectable>资料和记录只保存在当前手机</ThemedText>
        </View>

        <SectionCard elevated>
          <FormField label="宝宝昵称" error={errorMessage}>
            <AppTextInput
              accessibilityLabel="宝宝昵称"
              autoCapitalize="none"
              autoCorrect={false}
              error={errorMessage}
              maxLength={20}
              onChangeText={setName}
              placeholder="小宝"
              returnKeyType="done"
              value={name}
            />
          </FormField>

          <FormField label="出生日期">
            <Pressable
              accessibilityLabel="选择出生日期"
              accessibilityRole="button"
              onPress={() => setDatePickerVisible((visible) => !visible)}
              style={({ pressed }) => [
                styles.dateButton,
                { backgroundColor: theme.inputBackground, borderColor: theme.border },
                pressed && styles.pressed,
              ]}>
              <AppIcon name="calendar" color={theme.primary} size={22} />
              <ThemedText style={styles.dateCopy}>
                {birthDate.getFullYear()}年{birthDate.getMonth() + 1}月{birthDate.getDate()}日
              </ThemedText>
              <AppIcon name="next" color={theme.textSecondary} size={20} />
            </Pressable>
            {datePickerVisible ? (
              <DateTimePicker
                value={birthDate}
                mode="date"
                display="default"
                maximumDate={new Date()}
                onValueChange={handleDateChange}
                onDismiss={() => setDatePickerVisible(false)}
              />
            ) : null}
          </FormField>

          <AppButton accessibilityLabel="开始记录" label="开始记录" loading={saving} onPress={() => { void handleSubmit(); }} />
          <AppButton accessibilityLabel="从完整备份恢复" disabled={saving} label="从完整备份恢复" onPress={() => router.push('/backup')} variant="secondary" />
        </SectionCard>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, maxWidth: 560, justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xxxl, gap: Spacing.xxl },
  heading: { gap: Spacing.sm },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { ...Typography.pageTitle, flex: 1 },
  dateButton: { minHeight: 54, borderWidth: 1, borderRadius: Radius.control, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dateCopy: { flex: 1, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.72 },
});
