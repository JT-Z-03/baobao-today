import { render } from '@testing-library/react-native';
import { TextInput } from 'react-native';

import { FormField } from '@/components/ui/form-field';

test('form field labels optional input and exposes a nearby error', async () => {
  const view = await render(
    <FormField error="请输入有效奶量" label="奶量" optional>
      <TextInput accessibilityLabel="奶量输入" />
    </FormField>,
  );

  expect(view.getByText('奶量')).toBeTruthy();
  expect(view.getByText('选填')).toBeTruthy();
  expect(view.getByText('请输入有效奶量').props.accessibilityLiveRegion).toBe('polite');
});
