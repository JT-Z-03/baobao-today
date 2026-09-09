import { ThemedText } from '@/components/themed-text';
import { BrandMark } from '@/components/ui/brand-mark';
import { ScreenContainer } from '@/components/ui/screen-container';
import { ErrorState } from '@/components/ui/status-state';
import { Typography } from '@/constants/theme';
import { toSafeUiMessage } from '@/features/system/safe-ui-message';

type StartupErrorScreenProps = {
  message: string | null;
  onRetry(): void;
};

export function StartupErrorScreen({ message, onRetry }: StartupErrorScreenProps) {
  return (
    <ScreenContainer contentStyle={{ flexGrow: 1, maxWidth: 560, justifyContent: 'center' }}>
      <BrandMark />
      <ThemedText style={Typography.sectionTitle} selectable>无法打开本地数据</ThemedText>
      <ErrorState
        actionLabel="重试打开本地数据"
        message={toSafeUiMessage(message ? new Error(message) : null, '本地数据暂时无法打开，请重试。')}
        onAction={onRetry}
      />
    </ScreenContainer>
  );
}
