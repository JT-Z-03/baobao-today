import { Image } from 'expo-image';
import { View } from 'react-native';

import { UiAssets } from '@/constants/ui-assets';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  name: 'babySmile' | 'babySleeping' | 'happinessNote' | 'brandFlower';
  width: number;
  height: number;
};

export function AppIllustration({ name, width, height }: Props) {
  const theme = useTheme();
  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={UiAssets[name]} contentFit="contain" style={{ width, height }}
        tintColor={name === 'happinessNote' || name === 'brandFlower' ? theme.primary : undefined} />
    </View>
  );
}
