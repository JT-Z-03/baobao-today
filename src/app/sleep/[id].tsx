import { useLocalSearchParams } from 'expo-router';

import { SleepFormScreen } from '@/features/sleep/screens/sleep-form-screen';

export default function SleepRecordRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SleepFormScreen recordId={id} />;
}
