import { Redirect } from 'expo-router';

import { useAppState } from '@/application/app-state/app-state-provider';
import { BabySetupScreen } from '@/features/baby/screens/baby-setup-screen';

export default function BabySetupRoute() {
  const { babyProfile } = useAppState();
  if (babyProfile) return <Redirect href="/today" />;
  return <BabySetupScreen />;
}
