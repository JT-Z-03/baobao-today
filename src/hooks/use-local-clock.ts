import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useLocalClock() {
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNowMs(Date.now());
    const timer = setInterval(refresh, 60_000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, []);
  return nowMs;
}
