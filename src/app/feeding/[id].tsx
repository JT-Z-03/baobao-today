import { useLocalSearchParams } from 'expo-router';

import { FeedingFormScreen } from '@/features/feeding/screens/feeding-form-screen';

export default function EditFeedingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FeedingFormScreen recordId={id} />;
}
