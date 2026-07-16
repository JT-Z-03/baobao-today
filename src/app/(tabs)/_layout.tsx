import { Redirect } from 'expo-router';

import { useAppState } from '@/application/app-state/app-state-provider';
import AppTabs from '@/components/app-tabs';

export default function TabsLayout() {
  const { babyProfile } = useAppState();
  if (!babyProfile) return <Redirect href="/baby-setup" />;
  return <AppTabs />;
}
