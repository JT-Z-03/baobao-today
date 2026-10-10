import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AppTextInput } from '@/components/ui/app-text-input';
import { Colors } from '@/constants/theme';

test('text input has consistent focus and error presentation', async () => {
  const view = await render(
    <AppTextInput accessibilityLabel="备注" error="备注内容无效" onChangeText={jest.fn()} placeholder="选填" value="" />,
  );
  const input = view.getByLabelText('备注');
  expect(input.props.placeholderTextColor).toBe(Colors.light.textMuted);
  expect(input.props.accessibilityHint).toBe('备注内容无效');
  expect(StyleSheet.flatten(input.props.style).borderColor).toBe(Colors.light.danger);

  await view.rerender(<AppTextInput accessibilityLabel="备注" onChangeText={jest.fn()} placeholder="选填" value="" />);
  const normalInput = view.getByLabelText('备注');
  await fireEvent(normalInput, 'focus');
  expect(StyleSheet.flatten(view.getByLabelText('备注').props.style).borderColor).toBe(Colors.light.inputFocused);
});

test.each([20, 200])('accepts %i code points without an Android UTF-16 cutoff', async (limit) => {
  const onChangeText = jest.fn();
  const view = await render(
    <AppTextInput accessibilityLabel="码点输入" maxCodePointLength={limit} onChangeText={onChangeText} value="" />,
  );
  const input = view.getByLabelText('码点输入');
  // Android maxLength counts UTF-16 units: reserve two units per allowed code point.
  expect(input.props.maxLength).toBe(limit * 2);
  const allowed = '字'.repeat(limit - 1) + '🍼';
  await fireEvent.changeText(input, allowed);
  expect(onChangeText).toHaveBeenLastCalledWith(allowed);
  await fireEvent.changeText(input, allowed + '多');
  expect(onChangeText).toHaveBeenLastCalledWith(allowed);
  await fireEvent.changeText(input, '🍼'.repeat(limit) + '多');
  expect(onChangeText).toHaveBeenLastCalledWith('🍼'.repeat(limit));
});

test('keeps native numeric limits and onChangeText unchanged without a code-point limit', async () => {
  const onChangeText = jest.fn();
  const view = await render(<AppTextInput accessibilityLabel="奶量" maxLength={3} onChangeText={onChangeText} value="" />);
  expect(view.getByLabelText('奶量').props.maxLength).toBe(3);
  await fireEvent.changeText(view.getByLabelText('奶量'), '120');
  expect(onChangeText).toHaveBeenLastCalledWith('120');
});

test('rejects excess inserted text without deleting the unchanged end of a full note', async () => {
  const onChangeText = jest.fn();
  const value = '前'.repeat(100) + '后'.repeat(99) + '🍼';
  const view = await render(<AppTextInput accessibilityLabel="完整备注" maxCodePointLength={200} onChangeText={onChangeText} value={value} />);
  await fireEvent.changeText(view.getByLabelText('完整备注'), '前'.repeat(100) + '新增' + '后'.repeat(99) + '🍼');
  expect(onChangeText).toHaveBeenLastCalledWith(value);
});

test('allows replacing selected text at the code-point limit and counts combining marks separately', async () => {
  const onChangeText = jest.fn();
  const value = '宝'.repeat(19) + '🍼';
  const view = await render(<AppTextInput accessibilityLabel="昵称编辑" maxCodePointLength={20} onChangeText={onChangeText} value={value} />);
  await fireEvent.changeText(view.getByLabelText('昵称编辑'), '宝'.repeat(19) + '😀');
  expect(onChangeText).toHaveBeenLastCalledWith('宝'.repeat(19) + '😀');
  await view.rerender(<AppTextInput accessibilityLabel="昵称编辑" maxCodePointLength={20} onChangeText={onChangeText} value="" />);
  await fireEvent.changeText(view.getByLabelText('昵称编辑'), '宝'.repeat(18) + 'e\u0301' + '多');
  expect(onChangeText).toHaveBeenLastCalledWith('宝'.repeat(18) + 'e\u0301');
});

test.each([20, 200])('clips a full-selection paste at %i code points even with shared ends', async (limit) => {
  const onChangeText = jest.fn();
  const value = '宝'.repeat(limit - 1) + '🍼';
  const view = await render(<AppTextInput accessibilityLabel="全选粘贴" maxCodePointLength={limit} onChangeText={onChangeText} value={value} />);
  for (const replacement of ['新'.repeat(limit + 5) + '🍼', '宝宝' + '新'.repeat(limit + 5) + '🍼']) {
    await fireEvent(view.getByLabelText('全选粘贴'), 'selectionChange', { nativeEvent: { selection: { start: 0, end: value.length } } });
    await fireEvent.changeText(view.getByLabelText('全选粘贴'), replacement);
    expect(onChangeText).toHaveBeenLastCalledWith([...replacement].slice(0, limit).join(''));
  }
});

test('clips only the selected replacement and preserves the real unselected emoji suffix', async () => {
  const onChangeText = jest.fn();
  const value = '🍼前' + '旧'.repeat(16) + '尾🍼';
  const view = await render(<AppTextInput accessibilityLabel="局部粘贴" maxCodePointLength={20} onChangeText={onChangeText} value={value} />);
  await fireEvent(view.getByLabelText('局部粘贴'), 'selectionChange', { nativeEvent: { selection: { start: 3, end: 19 } } });
  await fireEvent.changeText(view.getByLabelText('局部粘贴'), '🍼前' + '新'.repeat(22) + '尾🍼');
  expect(onChangeText).toHaveBeenLastCalledWith('🍼前' + '新'.repeat(16) + '尾🍼');
});

test('uses UTF-16 cursor offsets but crops inserted text at code-point boundaries', async () => {
  const onChangeText = jest.fn();
  const value = '🍼' + '前'.repeat(8) + '后'.repeat(9) + '🍼';
  const view = await render(<AppTextInput accessibilityLabel="插入补充字符" maxCodePointLength={20} onChangeText={onChangeText} value={value} />);
  await fireEvent(view.getByLabelText('插入补充字符'), 'selectionChange', { nativeEvent: { selection: { start: 10, end: 10 } } });
  await fireEvent.changeText(view.getByLabelText('插入补充字符'), value.slice(0, 10) + '🍼新' + value.slice(10));
  expect(onChangeText).toHaveBeenLastCalledWith(value.slice(0, 10) + '🍼' + value.slice(10));
});

test('rejects ambiguous overflowing edits without changing existing text', async () => {
  const onChangeText = jest.fn();
  const value = '宝'.repeat(19) + '🍼';
  const view = await render(<AppTextInput accessibilityLabel="选区缺失" maxCodePointLength={20} onChangeText={onChangeText} value={value} />);
  await fireEvent.changeText(view.getByLabelText('选区缺失'), '新'.repeat(25) + '🍼');
  expect(onChangeText).toHaveBeenLastCalledWith(value);
  await fireEvent(view.getByLabelText('选区缺失'), 'selectionChange', { nativeEvent: { selection: { start: 19, end: 21 } } });
  await fireEvent.changeText(view.getByLabelText('选区缺失'), '新'.repeat(25) + '🍼');
  expect(onChangeText).toHaveBeenLastCalledWith(value);
});

test.each([{ start: 1, end: 1 }, { start: -1, end: 3 }, { start: 3, end: 2 }])('rejects an invalid UTF-16 selection %j', async (selection) => {
  const onChangeText = jest.fn();
  const value = '🍼' + '宝'.repeat(19);
  const view = await render(<AppTextInput accessibilityLabel="无效选区" maxCodePointLength={20} onChangeText={onChangeText} value={value} />);
  await fireEvent(view.getByLabelText('无效选区'), 'selectionChange', { nativeEvent: { selection } });
  await fireEvent.changeText(view.getByLabelText('无效选区'), '🍼' + '新'.repeat(25));
  expect(onChangeText).toHaveBeenLastCalledWith(value);
});

test('consumes selection snapshots and invalidates them when the controlled value changes', async () => {
  const onChangeText = jest.fn();
  const value = '宝'.repeat(19) + '🍼';
  const view = await render(<AppTextInput accessibilityLabel="选区时效" maxCodePointLength={20} onChangeText={onChangeText} value={value} />);
  await fireEvent(view.getByLabelText('选区时效'), 'selectionChange', { nativeEvent: { selection: { start: 0, end: value.length } } });
  await fireEvent.changeText(view.getByLabelText('选区时效'), '合法替换');
  await fireEvent.changeText(view.getByLabelText('选区时效'), '新'.repeat(25) + '🍼');
  expect(onChangeText).toHaveBeenLastCalledWith(value);
  await fireEvent(view.getByLabelText('选区时效'), 'selectionChange', { nativeEvent: { selection: { start: 0, end: value.length } } });
  await view.rerender(<AppTextInput accessibilityLabel="选区时效" maxCodePointLength={20} onChangeText={onChangeText} value="另一个值" />);
  await view.rerender(<AppTextInput accessibilityLabel="选区时效" maxCodePointLength={20} onChangeText={onChangeText} value={value} />);
  await fireEvent.changeText(view.getByLabelText('选区时效'), '新'.repeat(25) + '🍼');
  expect(onChangeText).toHaveBeenLastCalledWith(value);
});

test('forwards caller selection events and leaves numeric input behavior unchanged', async () => {
  const onSelectionChange = jest.fn();
  const onChangeText = jest.fn();
  const view = await render(<AppTextInput accessibilityLabel="数字选区" maxLength={3} onChangeText={onChangeText} onSelectionChange={onSelectionChange} value="12" />);
  const event = { nativeEvent: { selection: { start: 0, end: 2 } } };
  await fireEvent(view.getByLabelText('数字选区'), 'selectionChange', event);
  expect(onSelectionChange).toHaveBeenCalledWith(event);
  await fireEvent.changeText(view.getByLabelText('数字选区'), '123');
  expect(onChangeText).toHaveBeenLastCalledWith('123');
  expect(view.getByLabelText('数字选区').props.maxLength).toBe(3);
});

test('forwards a code-point selection once and discards it when the input loses focus', async () => {
  const onSelectionChange = jest.fn();
  const onChangeText = jest.fn();
  const value = '宝'.repeat(19) + '🍼';
  const view = await render(<AppTextInput accessibilityLabel="失焦选区" maxCodePointLength={20} onChangeText={onChangeText} onSelectionChange={onSelectionChange} value={value} />);
  const event = { nativeEvent: { selection: { start: 0, end: value.length } } };
  await fireEvent(view.getByLabelText('失焦选区'), 'selectionChange', event);
  expect(onSelectionChange).toHaveBeenCalledTimes(1);
  expect(onSelectionChange).toHaveBeenCalledWith(event);
  await fireEvent(view.getByLabelText('失焦选区'), 'blur');
  await fireEvent.changeText(view.getByLabelText('失焦选区'), '新'.repeat(25) + '🍼');
  expect(onChangeText).toHaveBeenLastCalledWith(value);
});
