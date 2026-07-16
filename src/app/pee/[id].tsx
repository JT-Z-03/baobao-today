import { useLocalSearchParams } from 'expo-router';

import { PeeFormScreen } from '@/features/pee/screens/pee-form-screen';

export default function EditPeeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PeeFormScreen recordId={id} />;
}
