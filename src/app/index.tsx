import { Redirect } from 'expo-router';

import { useAppState } from '@/application/app-state/app-state-provider';
import { StartupErrorScreen } from '@/features/system/screens/startup-error-screen';
import { RestoreResultNotice } from '@/features/backup/components/restore-result-notice';

export default function StartupRoute() {
  const { status, babyProfile, errorMessage, retryInitialization, restoreService } = useAppState();

  if (status === 'error') {
    return <StartupErrorScreen message={errorMessage} onRetry={retryInitialization}>
      <RestoreResultNotice service={restoreService} />
    </StartupErrorScreen>;
  }
  if (status === 'loading') return null;
  return <Redirect href={babyProfile ? '/today' : '/baby-setup'} />;
}
