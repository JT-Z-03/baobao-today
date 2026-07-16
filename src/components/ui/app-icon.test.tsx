import { render } from '@testing-library/react-native';

import { AppIcon } from '@/components/ui/app-icon';

test('decorative native icon cannot intercept its parent button touch target', async () => {
  const view = await render(<AppIcon color="#123456" name="feeding" />);
  expect(view.getByTestId('app-icon-wrapper').props.pointerEvents).toBe('none');
});
