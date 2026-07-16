export function formatOtherClock(timestampMs: number) {
  const date = new Date(timestampMs);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

export function summarizeOtherNote(note: string | null) {
  const normalized = note?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) return null;
  const characters = [...normalized];
  return characters.length > 40
    ? `${characters.slice(0, 40).join('')}…`
    : normalized;
}
