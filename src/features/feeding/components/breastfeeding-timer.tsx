import { useEffect, useState, useRef } from 'react';
import { AppState, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { ThemedText } from '@/components/themed-text';
import { formatTimerDuration, timerTotals, transitionTimer, type BreastSide, type TimerAction } from '@/domain/feeding/breastfeeding-timer';
import { formatRecordTime } from '@/domain/date/record-time-shortcuts';
import { useRecordDraftContext } from '@/features/records/hooks/use-record-draft';
import { Spacing } from '@/constants/theme';

export function BreastfeedingTimerControl() {
  const context = useRecordDraftContext();
  const timer = context?.draft?.timer ?? null;
  const [nowMs, setNowMs] = useState(Date.now);
  const sample = useRef<{ wall: number; monotonic: number } | null>(null);
  const clockJump = useRef(false);
  const checking = useRef(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => {
      const wall = Date.now(); const monotonic = performance.now();
      if (sample.current && Math.abs((wall - sample.current.wall) - (monotonic - sample.current.monotonic)) > 60_000) clockJump.current = true;
      sample.current = { wall, monotonic }; setNowMs(wall);
    };
    const interval = setInterval(refresh, 1_000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearInterval(interval); listener.remove(); };
  }, []);
  useEffect(() => {
    if (!context || !timer?.side || timer.finished || checking.current) return;
    const action: TimerAction = clockJump.current ? { type: 'clock' } : { type: 'pause' };
    if (!transitionTimer(timer, action, Date.now()).issue) return;
    checking.current = true; clockJump.current = false;
    void context.timer(action).catch(() => setError('计时状态暂未保存，请结束计时后核对')).finally(() => { checking.current = false; });
  }, [context, timer, nowMs]);
  if (!context) return null;
  const totals = timer ? timerTotals(timer, nowMs) : { leftMs: 0, rightMs: 0 };
  const act = async (action: TimerAction | { type: 'start'; side: BreastSide }) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const next = await context.timer(action); setNowMs(next.updatedAtMs);

    } catch (cause) { setError(cause instanceof Error ? cause.message : '计时暂未保存，请重试'); }
    finally { setBusy(false); }
  };
  const button = (label: string, action: Parameters<typeof act>[0]) => <AppButton key={label}
    label={label} disabled={busy} variant="secondary" onPress={() => { void act(action); }} />;
  return <View style={{ gap: Spacing.sm }}>
    <ThemedText type="subtitle">{timer?.finished ? '计时已结束，请核对下方分钟数' : timer?.side ? `${timer.side === 'left' ? '左侧' : '右侧'}计时中` : timer ? '亲喂计时已暂停' : '亲喂计时'}</ThemedText>
    {timer ? <>
      <ThemedText>左侧 {formatTimerDuration(totals.leftMs)} · 右侧 {formatTimerDuration(totals.rightMs)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">开始于{formatRecordTime(timer.startedAtMs, nowMs)}</ThemedText>
    </> : <ThemedText type="small" themeColor="textSecondary">可左右计时，也可直接手动填写下方时长</ThemedText>}
    {timer?.issue ? <ThemedText themeColor="danger">设备时间或计时时长需要核对，请结束计时后手动修正。</ThemedText> : null}
    {error ? <ThemedText themeColor="danger" accessibilityLiveRegion="polite">{error}</ThemedText> : null}
    {!timer ? <View style={{ gap: Spacing.sm }}>
      {button('开始左侧', { type: 'start', side: 'left' })}{button('开始右侧', { type: 'start', side: 'right' })}
    </View> : !timer.finished ? <View style={{ gap: Spacing.sm }}>
      {timer.side !== 'left' ? button(timer.side ? '切换左侧' : '继续左侧', { type: 'switch', side: 'left' }) : null}
      {timer.side !== 'right' ? button(timer.side ? '切换右侧' : '继续右侧', { type: 'switch', side: 'right' }) : null}
      {timer.side ? button('暂停', { type: 'pause' }) : null}
      {button('结束计时', { type: 'finish' })}
    </View> : <ThemedText type="small" themeColor="textSecondary">
      按整分钟保存；不足 1 分钟按合计 1 分钟填写。请核对或修改下方结果，再保存记录。
    </ThemedText>}
  </View>;
}
