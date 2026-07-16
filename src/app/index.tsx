import { Redirect } from 'expo-router';

import { useAppState } from '@/application/app-state/app-state-provider';
import { StartupErrorScreen } from '@/features/system/screens/startup-error-screen';

export default function StartupRoute() {
  const { status, babyProfile, errorMessage, retryInitialization } = useAppState();

  if (status === 'error') {
    return <StartupErrorScreen message={errorMessage} onRetry={retryInitialization} />;
  }
  if (status === 'loading') return null;
  return <Redirect href={babyProfile ? '/today' : '/baby-setup'} />;
}
