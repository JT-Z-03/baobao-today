import { createThemeService } from './theme-service';

test('serializes theme changes with backup/restore and publishes the committed mode', async () => {
  const repository = { get: jest.fn(async () => 'system' as const), set: jest.fn(async () => undefined) };
  const coordinator = { busy: false, runExclusive: jest.fn(async (operation: () => Promise<unknown>) => operation()) };
  const onChanged = jest.fn();
  const service = createThemeService({ repository, coordinator: coordinator as never, now: () => 100, onChanged });
  await service.setMode('dark');
  expect(coordinator.runExclusive).toHaveBeenCalledTimes(1);
  expect(repository.set).toHaveBeenCalledWith('dark', 100);
  expect(onChanged).toHaveBeenCalledWith('dark');
});
