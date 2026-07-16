import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  NativeTabScreenContainer,
  nativeTabSafeAreaEdges,
} from '@/components/ui/screen-container';

test('native tab screens consume Android top and side insets while leaving the bottom to Native Tabs', async () => {
  expect(nativeTabSafeAreaEdges('android')).toEqual(['top', 'left', 'right']);
  expect(nativeTabSafeAreaEdges('ios')).toEqual(['left', 'right']);

  const view = await render(
    <NativeTabScreenContainer>
      <Text>内容</Text>
    </NativeTabScreenContainer>,
  );

  let ancestor = view.getByText('内容').parent;
  while (ancestor && !ancestor.props.edges) ancestor = ancestor.parent;
  expect(ancestor?.props.edges).toEqual(expect.objectContaining({
    bottom: 'off',
    left: 'additive',
    right: 'additive',
  }));
});
