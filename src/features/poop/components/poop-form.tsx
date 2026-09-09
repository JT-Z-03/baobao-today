import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppTextInput } from '@/components/ui/app-text-input';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { FormField } from '@/components/ui/form-field';
import { FormScreen } from '@/components/ui/form-screen';
import { RecordDateTimeField } from '@/components/ui/record-date-time-field';
import { Radius, Spacing } from '@/constants/theme';
import type {
  LocalPhotoSource,
  PoopAmount,
  PoopColor,
  PoopCoreInput,
  PoopPhotoChange,
  PoopTexture,
} from '@/domain/poop/poop';
import {
  POOP_AMOUNT_LABELS,
  POOP_COLOR_LABELS,
  POOP_TEXTURE_LABELS,
} from '@/features/poop/poop-format';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  initialInput: PoopCoreInput;
  initialPhotoPreviewUri: string | null;
  hasInitialPhoto?: boolean;
  clientRequestId: string | null;
  headerSubtitle?: string;
  submitLabel?: string;
  onSave(input: PoopCoreInput, photoChange: PoopPhotoChange, clientRequestId: string | null): Promise<void>;
  onDelete?: () => void;
};

export function createPoopSubmissionLock() {
  let active = false;
  return {
    async run(task: () => Promise<void>) {
      if (active) return false;
      active = true;
      try {
        await task();
        return true;
      } finally {
        active = false;
      }
    },
  };
}

export function shouldRequestMediaLibraryPermission(os = process.env.EXPO_OS) {
  return os === 'ios';
}

const colorOptions = Object.entries(POOP_COLOR_LABELS) as [PoopColor, string][];
const textureOptions = Object.entries(POOP_TEXTURE_LABELS) as [PoopTexture, string][];
const amountOptions = Object.entries(POOP_AMOUNT_LABELS) as [PoopAmount, string][];

function sourceFromResult(result: ImagePicker.ImagePickerResult): LocalPhotoSource | null {
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

type ChoiceGroupProps<T extends string> = {
  title: string;
  accessibilityPrefix: string;
  value: T | null;
  options: readonly [T, string][];
  onChange(value: T | null): void;
  leading?: (value: T) => ReactNode;
  choiceStyle?: StyleProp<ViewStyle>;
};

function ChoiceGroup<T extends string>({ title, accessibilityPrefix, value, options, onChange, leading, choiceStyle }: ChoiceGroupProps<T>) {
  return (
    <FormField label={title} optional>
      <View style={styles.choiceGrid}>
        {options.map(([option, label]) => {
          const selected = value === option;
          return (
            <ChoiceChip
              key={option}
              accessibilityLabel={`${accessibilityPrefix} ${label}`}
              label={label}
              leading={leading?.(option)}
              onPress={() => onChange(selected ? null : option)}
              selected={selected}
              style={choiceStyle}
            />
          );
        })}
      </View>
    </FormField>
  );
}

export function PoopForm({
  initialInput,
  initialPhotoPreviewUri,
  hasInitialPhoto = Boolean(initialPhotoPreviewUri),
  clientRequestId,
  headerSubtitle,
  submitLabel = '保存记录',
  onSave,
  onDelete,
}: Props) {
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const roomyChoices = width < 360 || fontScale > 1.3;
  const colorSwatches: Record<PoopColor, string> = {
    yellow: theme.observationYellow,
    green: theme.observationGreen,
    brown: theme.observationBrown,
    black: theme.observationBlack,
    red: theme.observationRed,
    other: theme.observationOther,
  };
  const submissionLock = useRef(createPoopSubmissionLock());
  const [eventTimeMs, setEventTimeMs] = useState(initialInput.eventTimeMs);
  const [color, setColor] = useState(initialInput.color);
  const [texture, setTexture] = useState(initialInput.texture);
  const [amount, setAmount] = useState(initialInput.amount);
  const [note, setNote] = useState(initialInput.note ?? '');
  const [photoChange, setPhotoChange] = useState<PoopPhotoChange>({ kind: 'keep' });
  const [previewUri, setPreviewUri] = useState(initialPhotoPreviewUri);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [photoLoadError, setPhotoLoadError] = useState(false);
  const [fullPhotoVisible, setFullPhotoVisible] = useState(false);

  const applyPhoto = (source: LocalPhotoSource | null) => {
    if (!source) return;
    setPhotoChange({ kind: 'replace', source });
    setPreviewUri(source.uri);
    setPhotoLoadError(false);
    setPhotoMessage(null);
  };

  useEffect(() => {
    let active = true;
    ImagePicker.getPendingResultAsync()
      .then((result) => {
        if (!active || !result || 'code' in result) return;
        applyPhoto(sourceFromResult(result));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const choosePhoto = async (kind: 'camera' | 'library') => {
    setErrorMessage(null);
    setPhotoMessage(null);
    try {
      const permission = kind === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : shouldRequestMediaLibraryPermission()
          ? await ImagePicker.requestMediaLibraryPermissionsAsync()
          : null;
      if (permission && !permission.granted) {
        setPhotoMessage(permission.canAskAgain
          ? '未获得照片权限，仍可保存不带照片的大便记录。'
          : '照片权限已关闭，可在系统设置中开启；仍可保存不带照片的记录。');
        return;
      }
      const result = kind === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      applyPhoto(sourceFromResult(result));
    } catch {
      setPhotoMessage(`${kind === 'camera' ? '相机' : '相册'}暂时无法打开，照片没有添加，仍可继续保存记录。`);
    }
  };

  const handleSave = async () => {
    await submissionLock.current.run(async () => {
      setSaving(true);
      setErrorMessage(null);
      try {
        await onSave({ eventTimeMs, color, texture, amount, note: note || null }, photoChange, clientRequestId);
      } catch (error) {
        setErrorMessage(toSafeUiMessage(error, '保存失败，请检查填写内容后重试。'));
      } finally {
        setSaving(false);
      }
    });
  };

  const removePhoto = () => {
    setFullPhotoVisible(false);
    setPreviewUri(null);
    setPhotoLoadError(false);
    setPhotoMessage(null);
    setPhotoChange(hasInitialPhoto ? { kind: 'remove' } : { kind: 'keep' });
  };

  const photoUnavailable = photoLoadError || (hasInitialPhoto && photoChange.kind === 'keep' && !initialPhotoPreviewUri);

  return (
    <>
      <FormScreen
        compact
        title="记录大便"
        subtitle={headerSubtitle}
        icon="poop"
        footer={(
          <>
            {errorMessage ? <ThemedText accessibilityLiveRegion="polite" themeColor="danger" selectable>{errorMessage}</ThemedText> : null}
            <AppButton accessibilityLabel="保存大便记录" label={submitLabel} loading={saving} onPress={() => { void handleSave(); }} />
            {onDelete ? <AppButton accessibilityLabel="删除大便记录" disabled={saving} label="删除记录" onPress={onDelete} variant="destructive-ghost" /> : null}
          </>
        )}>
        <RecordDateTimeField
          label="记录时间"
          valueMs={eventTimeMs}
          onChange={setEventTimeMs}
          maximumDate={new Date()}
          dateAccessibilityLabel="修改记录日期"
          timeAccessibilityLabel="修改记录时间"
        />

        <ChoiceGroup<PoopColor>
          title="颜色"
          accessibilityPrefix="选择大便颜色"
          value={color}
          options={colorOptions}
          onChange={setColor}
          choiceStyle={[styles.colorChoice, roomyChoices && styles.wideColorChoice]}
          leading={(option) => <View accessible={false} style={[styles.swatch, { backgroundColor: colorSwatches[option] }]} />}
        />
        <ChoiceGroup<PoopTexture> title="状态" accessibilityPrefix="选择大便状态" value={texture} options={textureOptions} onChange={setTexture} choiceStyle={[styles.textureChoice, roomyChoices && styles.wideTextureChoice]} />
        <ChoiceGroup<PoopAmount> title="量" accessibilityPrefix="选择大便量" value={amount} options={amountOptions} onChange={setAmount} choiceStyle={[styles.amountChoice, roomyChoices && styles.wideAmountChoice]} />

        <FormField label="照片" optional hint="照片仅保存在当前手机。">
          {previewUri && !photoLoadError ? (
            <Pressable
              accessibilityHint="打开全屏照片预览"
              accessibilityLabel="查看照片大图"
              accessibilityRole="button"
              onPress={() => setFullPhotoVisible(true)}
              style={[styles.photoPreview, { backgroundColor: theme.surfaceElevated }]}>
              <Image
                accessibilityLabel="大便记录照片预览"
                contentFit="contain"
                onError={() => setPhotoLoadError(true)}
                onLoad={() => setPhotoLoadError(false)}
                source={{ uri: previewUri }}
                style={styles.previewImage}
              />
            </Pressable>
          ) : null}
          {photoUnavailable ? <View accessibilityLabel="照片暂时无法显示" style={[styles.unavailablePhoto, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}><ThemedText themeColor="textSecondary">照片暂时无法显示</ThemedText></View> : null}
          <View style={styles.photoActions}>
            {(['camera', 'library'] as const).map((kind) => (
              <Pressable
                key={kind}
                accessibilityLabel={kind === 'camera' ? '拍照' : '从相册选择'}
                accessibilityRole="button"
                onPress={() => { void choosePhoto(kind); }}
                style={({ pressed }) => [styles.photoAction, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}>
                <AppIcon name={kind === 'camera' ? 'camera' : 'photo'} color={theme.primary} size={24} />
                <ThemedText>{kind === 'camera' ? '拍照' : '相册'}</ThemedText>
              </Pressable>
            ))}
            {(previewUri || photoUnavailable) ? <AppButton accessibilityLabel="移除照片" compact label="移除" onPress={removePhoto} variant="destructive-ghost" /> : null}
          </View>
          {photoMessage ? <ThemedText accessibilityLiveRegion="polite" themeColor="warning" type="small" selectable>{photoMessage}</ThemedText> : null}
        </FormField>

        <FormField label="备注" optional>
          <AppTextInput accessibilityLabel="备注" maxLength={200} multiline onChangeText={setNote} placeholder="选填" value={note} />
        </FormField>

      </FormScreen>
    <Modal animationType="fade" onRequestClose={() => setFullPhotoVisible(false)} statusBarTranslucent visible={fullPhotoVisible && Boolean(previewUri)}>
      <SafeAreaView accessibilityViewIsModal style={[styles.fullPhoto, { backgroundColor: theme.background }]}>
        <AppButton accessibilityLabel="关闭照片大图" compact label="关闭" onPress={() => setFullPhotoVisible(false)} style={styles.closePhoto} variant="secondary" />
        {previewUri ? (
          <Image
            accessibilityLabel="大便照片大图"
            contentFit="contain"
            onError={() => setPhotoLoadError(true)}
            source={{ uri: previewUri }}
            style={styles.fullPhotoImage}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  colorChoice: { flexBasis: '30%', flexGrow: 1, minWidth: 96, paddingHorizontal: Spacing.sm },
  wideColorChoice: { flexBasis: '45%', minWidth: 120 },
  textureChoice: { flexBasis: 56, flexGrow: 1, paddingHorizontal: Spacing.xs },
  wideTextureChoice: { minWidth: 100 },
  amountChoice: { flexBasis: '30%', flexGrow: 1, minWidth: 80 },
  wideAmountChoice: { minWidth: 112 },
  swatch: { width: 22, height: 22, borderRadius: 11, flexShrink: 0 },
  photoPreview: { width: '100%', aspectRatio: 4 / 3, maxHeight: 360, borderRadius: Radius.card },
  previewImage: { width: '100%', height: '100%', borderRadius: Radius.card },
  fullPhoto: { flex: 1, padding: Spacing.lg, gap: Spacing.md },
  closePhoto: { alignSelf: 'flex-end' },
  fullPhotoImage: { flex: 1, width: '100%' },
  unavailablePhoto: { minHeight: 160, borderWidth: 1, borderStyle: 'dashed', borderRadius: Radius.card, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photoAction: { flexBasis: '45%', flexGrow: 1, minHeight: 48, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderWidth: 1, borderRadius: Radius.control },
  pressed: { opacity: 0.7 },
});
