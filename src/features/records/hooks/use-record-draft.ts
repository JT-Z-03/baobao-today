import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { RecordDraft } from '@/domain/drafts/record-draft';
import type { LocalPhotoSource } from '@/domain/poop/poop';
import type { BreastSide, TimerAction } from '@/domain/feeding/breastfeeding-timer';

export type DraftFormContextValue = {
  isNew: boolean;
  locked: boolean;
  revision: number; values: Record<string, unknown>; draft: RecordDraft | null;
  register(name: string, value: unknown): void;
  change(name: string, value: unknown): void;
  cancelPhoto(): void;
  photo(source: LocalPhotoSource): Promise<LocalPhotoSource>;
  timer(action: TimerAction | { type: 'start'; side: BreastSide }): Promise<RecordDraft>;
};
export const DraftFormContext = createContext<DraftFormContextValue | null>(null);
export function useRecordDraftContext() { return useContext(DraftFormContext); }

export function useDraftField<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const context = useRecordDraftContext();
  const [value, setValue] = useState<T>(() => {
    if (context && Object.hasOwn(context.values, name)) return context.values[name] as T;
    const resolved = typeof initial === 'function' ? (initial as () => T)() : initial;
    context?.register(name, resolved);
    return resolved;
  });
  const current = useRef(value);
  useLayoutEffect(() => { current.current = value; }, [value]);
  const revision = context?.revision;
  const contextRef = useRef(context);
  useLayoutEffect(() => { contextRef.current = context; }, [context]);
  useEffect(() => {
    const next = contextRef.current;
    if (next && Object.hasOwn(next.values, name)) {
      current.current = next.values[name] as T;
      setValue(current.current);
    }
  }, [revision, name]);
  return [value, (action) => {
    if (contextRef.current?.locked) return;
    const next = typeof action === 'function' ? (action as (previous: T) => T)(current.current) : action;
    current.current = next; setValue(next); contextRef.current?.change(name, next);
  }];
}
