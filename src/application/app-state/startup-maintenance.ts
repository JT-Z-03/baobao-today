export type StartupMaintenanceTask = { name: string; run(isActive: () => boolean): Promise<void> };

// Each step starts in a later JS turn, after the ready tree can commit. The token
// is checked again by tasks after async work/queued locks, before mutating state.
export function scheduleStartupMaintenance(tasks: readonly StartupMaintenanceTask[], onFailure: (name: string) => void) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (index: number) => {
    if (!active || index >= tasks.length) return;
    timer = setTimeout(() => {
      if (!active) return;
      void tasks[index].run(() => active).catch(() => {
        if (active) onFailure(tasks[index].name);
      }).finally(() => { schedule(index + 1); });
    }, 0);
  };
  schedule(0);
  return () => { active = false; if (timer !== undefined) clearTimeout(timer); };
}
