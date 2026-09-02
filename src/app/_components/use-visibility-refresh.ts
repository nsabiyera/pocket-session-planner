'use client';

import { useEffect } from 'react';

/**
 * Re-reads from the store whenever the tab becomes visible again.
 *
 * **Never trust in-memory state after a background stint.** The browser may have discarded
 * the page, another tab may have written, or the phone may simply have been in a pocket for
 * ten minutes. On a pitch that is the difference between a correct timer and a wrong one.
 */
export function useVisibilityRefresh(refresh: () => void | Promise<void>): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);
}
