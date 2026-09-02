'use client';

import { useEffect, useState } from 'react';

/**
 * A repaint ticker.
 *
 * This does **not** drive the timer — elapsed time is derived from persisted wall-clock
 * anchors, and deleting this hook would change the refresh rate and not one displayed
 * number. It exists solely to tell React to ask again.
 *
 * It also re-ticks on `visibilitychange → visible`, so the first frame after unlocking the
 * phone is already correct rather than showing the pre-lock value for up to `intervalMs`.
 */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);

  return now;
}
