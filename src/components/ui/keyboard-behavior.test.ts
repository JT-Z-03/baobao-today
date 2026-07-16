import {
  formKeyboardVerticalOffset,
  keyboardAvoidingBehavior,
} from '@/components/ui/keyboard-behavior';

test('uses a shrinking viewport on Android and padding on iOS', () => {
  expect(keyboardAvoidingBehavior('android')).toBe('height');
  expect(keyboardAvoidingBehavior('ios')).toBe('padding');
});

test('accounts for the native stack header above a form', () => {
  expect(formKeyboardVerticalOffset('android', 30)).toBe(86);
  expect(formKeyboardVerticalOffset('ios', 47)).toBe(91);
  expect(formKeyboardVerticalOffset('android', 30, false)).toBe(0);
});
