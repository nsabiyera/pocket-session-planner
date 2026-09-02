'use client';

import { useEffect, useRef } from 'react';
import { haptic } from '@/lib/haptics';
import { formatPhaseTimer, type PhaseClock } from '@/domain/session/timer';

/**
 * The big numerals.
 *
 * Every state carries a **text or symbol cue** as well as a colour — `+`, `OVER`, `PAUSED` —
 * because colour alone fails WCAG 1.4.1 and, more practically, because a coach glancing at a
 * glare-washed screen at arm's length reads shape before hue.
 *
 * `aria-live` is `off` on the timer itself: a region updating every 250ms is unusable with a
 * screen reader. The parent announces only the events that matter.
 */
export function TimerDial({
  clock,
  paused,
  nextPhaseTitle,
}: {
  clock: PhaseClock;
  paused: boolean;
  nextPhaseTitle?: string;
}) {
  const warnedMinute = useRef(false);
  const warnedOverrun = useRef(false);
  const lastSecond = useRef(-1);

  useEffect(() => {
    if (clock.isFinalMinute && !clock.isFinalTenSeconds && !warnedMinute.current) {
      warnedMinute.current = true;
      haptic('warn');
    }
    if (clock.isOverrun && !warnedOverrun.current) {
      warnedOverrun.current = true;
      haptic('overrun');
    }
    if (!clock.isFinalMinute && !clock.isOverrun) {
      warnedMinute.current = false;
      warnedOverrun.current = false;
    }

    if (clock.isFinalTenSeconds) {
      const second = Math.ceil(clock.remainingMs / 1000);
      if (second !== lastSecond.current) {
        lastSecond.current = second;
        haptic('tap');
      }
    }
  }, [clock]);

  const tone = clock.isOverrun ? 'stop' : clock.isFinalMinute ? 'warn' : 'ink';

  return (
    <div className="timer">
      <output
        className={`timer-value tabular timer-value--${tone} ${
          clock.isFinalTenSeconds ? 'timer-value--pulse' : ''
        }`}
        role="timer"
        aria-live="off"
      >
        {formatPhaseTimer(clock)}
      </output>

      <div
        className={`timer-bar timer-bar--${tone}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clock.progress * 100)}
        aria-label="Phase progress"
      >
        <span style={{ width: `${Math.round(clock.progress * 100)}%` }} />
      </div>

      <p className={`timer-label timer-label--${tone}`}>
        {paused ? 'PAUSED' : clock.isOverrun ? 'OVER' : clock.isFinalMinute ? '1 min left' : null}
      </p>

      {nextPhaseTitle ? <p className="card-meta">Next: {nextPhaseTitle}</p> : null}
    </div>
  );
}
