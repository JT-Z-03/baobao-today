import { useLocalSearchParams } from 'expo-router';

import { OtherFormScreen } from '@/features/other/screens/other-form-screen';

export default function EditOtherRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OtherFormScreen recordId={id} />;
}
