'use client';

import { useEffect, useState } from 'react';
import { useAppState } from '@/modules/app/app-store';
import { SERVICE_WORKER_SCOPE, SERVICE_WORKER_URL } from '@/lib/base-path';

/**
 * Service-worker updates are a **field-safety concern**, not a housekeeping one.
 *
 * `skipWaiting` is false in `sw.ts`, so a new worker sits in `waiting` until we let it
 * through. And while a session is running we do not even *mention* it: no toast, no hint, no
 * dot. Nothing swaps under a coach mid-drill. Once the session is complete, the offer
 * appears.
 */
export function UpdateToast() {
  const { activeSession } = useAppState();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
          scope: SERVICE_WORKER_SCOPE,
        });
        if (cancelled) return;

        if (registration.waiting) setWaiting(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // `controller` is null on the very first install — that is not an update, it is
            // the app becoming offline-capable, and there is nothing to tell the coach.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });
      } catch {
        // A failed registration means no offline support, which is worth knowing about in
        // Settings but must never block the app from running.
      }
    };

    void register();
    return () => {
      cancelled = true;
    };
  }, []);

  const running = activeSession?.status === 'in_progress';
  if (!waiting || running) return null;

  return (
    <div className="toast-host toast-host--update">
      <div className="toast toast--default">
        <span className="toast-message">Update ready</span>
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            waiting.postMessage({ type: 'SKIP_WAITING' });
            // The new worker takes control and reloads every client from `sw.ts`.
            waiting.addEventListener('statechange', () => {
              if (waiting.state === 'activated') location.reload();
            });
          }}
        >
          Tap to restart
        </button>
      </div>
    </div>
  );
}
