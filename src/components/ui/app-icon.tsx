import { Host, Icon } from '@expo/ui';
import { StyleSheet, View } from 'react-native';

export type AppIconName =
  | 'feeding'
  | 'poop'
  | 'pee'
  | 'sleep'
  | 'other'
  | 'calendar'
  | 'previous'
  | 'next'
  | 'check'
  | 'photo'
  | 'camera'
  | 'edit'
  | 'delete'
  | 'settings'
  | 'notification'
  | 'appearance'
  | 'data'
  | 'info'
  | 'backup'
  | 'export'
  | 'add'
  | 'remove'
  | 'error'
  | 'loading';

const icons = {
  feeding: Icon.select({ ios: 'drop.fill', android: import('@expo/material-symbols/local_drink.xml') }),
  poop: Icon.select({ ios: 'leaf.fill', android: import('@expo/material-symbols/baby_changing_station.xml') }),
  pee: Icon.select({ ios: 'drop.triangle.fill', android: import('@expo/material-symbols/water_drop.xml') }),
  sleep: Icon.select({ ios: 'moon.fill', android: import('@expo/material-symbols/bedtime.xml') }),
  other: Icon.select({ ios: 'ellipsis', android: import('@expo/material-symbols/more_horiz.xml') }),
  calendar: Icon.select({ ios: 'calendar', android: import('@expo/material-symbols/calendar_today.xml') }),
  previous: Icon.select({ ios: 'chevron.left', android: import('@expo/material-symbols/chevron_left.xml') }),
  next: Icon.select({ ios: 'chevron.right', android: import('@expo/material-symbols/chevron_right.xml') }),
  check: Icon.select({ ios: 'checkmark', android: import('@expo/material-symbols/check.xml') }),
  photo: Icon.select({ ios: 'photo', android: import('@expo/material-symbols/image.xml') }),
  camera: Icon.select({ ios: 'camera', android: import('@expo/material-symbols/photo_camera.xml') }),
  edit: Icon.select({ ios: 'pencil', android: import('@expo/material-symbols/edit.xml') }),
  delete: Icon.select({ ios: 'trash', android: import('@expo/material-symbols/delete.xml') }),
  settings: Icon.select({ ios: 'gearshape', android: import('@expo/material-symbols/settings.xml') }),
  notification: Icon.select({ ios: 'bell', android: import('@expo/material-symbols/notifications.xml') }),
  appearance: Icon.select({ ios: 'paintpalette', android: import('@expo/material-symbols/palette.xml') }),
  data: Icon.select({ ios: 'externaldrive', android: import('@expo/material-symbols/database.xml') }),
  info: Icon.select({ ios: 'info.circle', android: import('@expo/material-symbols/info.xml') }),
  backup: Icon.select({ ios: 'archivebox', android: import('@expo/material-symbols/archive.xml') }),
  export: Icon.select({ ios: 'square.and.arrow.up', android: import('@expo/material-symbols/ios_share.xml') }),
  add: Icon.select({ ios: 'plus', android: import('@expo/material-symbols/add.xml') }),
  remove: Icon.select({ ios: 'minus', android: import('@expo/material-symbols/remove.xml') }),
  error: Icon.select({ ios: 'exclamationmark.circle', android: import('@expo/material-symbols/error.xml') }),
  loading: Icon.select({ ios: 'hourglass', android: import('@expo/material-symbols/hourglass.xml') }),
} satisfies Record<AppIconName, ReturnType<typeof Icon.select>>;

export function AppIcon({ name, color, size = 22, accessibilityLabel }: {
  name: AppIconName;
  color: string;
  size?: number;
  accessibilityLabel?: string;
}) {
  return (
    <View pointerEvents="none" style={[styles.host, { width: size, height: size }]} testID="app-icon-wrapper">
      <Host accessible={Boolean(accessibilityLabel)} matchContents style={styles.host}>
        <Icon accessibilityLabel={accessibilityLabel} color={color} name={icons[name]} size={size} />
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({ host: { flexShrink: 0 } });
