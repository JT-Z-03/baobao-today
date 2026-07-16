import { StyleSheet } from 'react-native';

import { ScreenContainer } from '@/components/ui/screen-container';
import { ErrorState, LoadingState } from '@/components/ui/status-state';

export function FormScreenState({ error, loadingMessage }: { error?: string | null; loadingMessage: string }) {
  return (
    <ScreenContainer contentStyle={styles.content}>
      {error ? <ErrorState message={error} /> : <LoadingState message={loadingMessage} />}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({ content: { flexGrow: 1, justifyContent: 'center' } });
