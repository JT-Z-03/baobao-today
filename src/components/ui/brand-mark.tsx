import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { AppIllustration } from '@/components/ui/app-illustration';
import { Spacing } from '@/constants/theme';

export function BrandMark() {
  return (
    <View style={styles.row}>
      <ThemedText themeColor="primary" type="smallBold">宝宝今天</ThemedText>
      <AppIllustration name="brandFlower" width={16} height={16} />
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs } });
