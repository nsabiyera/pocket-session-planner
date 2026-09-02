'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { initApp, useAppState } from '@/modules/app/app-store';
import { BottomNav } from './bottom-nav';
import { ToastHost } from './toast-host';
import { UpdateToast } from './update-toast';

/**
 * The client boundary everything else lives inside.
 *
 * Opens the database once, mounts the persistent chrome, and re-reads on
 * `visibilitychange → visible` — because after a stint in the background the in-memory state
 * may be minutes stale, and on a pitch that is the difference between a correct timer and a
 * wrong one.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const state = useAppState();
  const pathname = usePathname();

  useEffect(() => {
    void initApp();
  }, []);

  return (
    <>
      {state.needsReload ? (
        <div className="banner banner--warn reload-banner" role="alert">
          Another tab updated the app.{' '}
          <button type="button" className="btn btn--quiet" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      ) : null}

      {children}

      {/* Do mode is a mode, not a page: no nav to mis-tap while the timer runs. */}
      {pathname?.startsWith('/run') ? null : <BottomNav />}

      <ToastHost />
      <UpdateToast />
    </>
  );
}
