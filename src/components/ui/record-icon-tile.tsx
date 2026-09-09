import { StyleSheet, View } from 'react-native';
import { AppIcon } from '@/components/ui/app-icon';
import { getRecordTypeTokens, type RecordVisualType } from '@/components/ui/record-type-badge';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function RecordIconTile({ type, size = 40 }: { type: RecordVisualType; size?: 40 | 48 }) {
  const theme = useTheme();
  const tokens = getRecordTypeTokens(type);
  return (
    <View pointerEvents="none" accessible={false} style={[styles.tile, { width: size, height: size, backgroundColor: theme[tokens.container] }]}>
      <AppIcon name={type} color={theme[tokens.color]} size={size * 0.7} />
    </View>
  );
}
const styles = StyleSheet.create({ tile: { alignItems: 'center', justifyContent: 'center', borderRadius: Radius.control, flexShrink: 0 } });
