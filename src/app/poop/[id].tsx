import { useLocalSearchParams } from 'expo-router';

import { PoopFormScreen } from '@/features/poop/screens/poop-form-screen';

export default function EditPoopRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PoopFormScreen recordId={id} />;
}
