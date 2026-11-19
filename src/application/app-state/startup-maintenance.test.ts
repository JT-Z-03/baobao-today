import { scheduleStartupMaintenance } from './startup-maintenance';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('maintenance yields before each task and canceled initialization never starts queued tasks', async () => {
  const first = jest.fn(async () => undefined); const second = jest.fn(async () => undefined);
  const cancel = scheduleStartupMaintenance([{ name: 'photos', run: first }, { name: 'receipts', run: second }], jest.fn());
  expect(first).not.toHaveBeenCalled();
  await jest.runOnlyPendingTimersAsync();
  expect(first).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled();
  cancel(); await jest.runAllTimersAsync();
  expect(second).not.toHaveBeenCalled();
});

test('cancellation reaches in-flight task and suppresses obsolete failure feedback', async () => {
  let reject!: (error: Error) => void; let isActive!: () => boolean;
  const failed = jest.fn();
  const cancel = scheduleStartupMaintenance([{ name: 'receipts', run: (active) => {
    isActive = active; return new Promise((_, fail) => { reject = fail; });
  } }], failed);
  await jest.runOnlyPendingTimersAsync();
  expect(isActive()).toBe(true); cancel(); expect(isActive()).toBe(false);
  reject(new Error('slow read')); await Promise.resolve(); await Promise.resolve();
  expect(failed).not.toHaveBeenCalled();
});

test('failure is reported and other tasks still run; a fresh retry can succeed', async () => {
  const failed = jest.fn(); const run = jest.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
  const next = jest.fn(async () => undefined);
  scheduleStartupMaintenance([{ name: 'photos', run }, { name: 'receipts', run: next }], failed);
  await jest.runAllTimersAsync();
  expect(failed).toHaveBeenCalledWith('photos'); expect(next).toHaveBeenCalledTimes(1);
  scheduleStartupMaintenance([{ name: 'photos', run }], failed);
  await jest.runAllTimersAsync();
  expect(run).toHaveBeenCalledTimes(2); expect(failed).toHaveBeenCalledTimes(1);
});
