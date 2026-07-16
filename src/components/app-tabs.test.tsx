import { render } from '@testing-library/react-native';
import AppTabs from '@/components/app-tabs';
import { Colors } from '@/constants/theme';
import { ThemeModeProvider } from '@/hooks/theme-mode-context';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: () => 'light',
}));

jest.mock('expo-router/unstable-native-tabs', () => {
  const { View } = jest.requireActual('react-native');
  const NativeTabs = (props: Record<string, unknown>) => {
    return <View testID="native-tabs" {...props} />;
  };
  const Trigger = Object.assign(
    ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    { Label: () => null, Icon: () => null },
  );
  NativeTabs.Trigger = Trigger;
  return { NativeTabs };
});

test('manual dark mode controls native tabs even when the system is light', async () => {
  const view = await render(
    <ThemeModeProvider mode="dark">
      <AppTabs />
    </ThemeModeProvider>,
  );

  const tabs = view.getByTestId('native-tabs');
  expect(tabs.props.backgroundColor).toBe(Colors.dark.surface);
  expect(tabs.props.iconColor).toEqual(expect.objectContaining({ selected: Colors.dark.primary }));
});
