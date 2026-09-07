'use client';

import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { APP_VERSION } from '@/modules/transfer/transfer-service';
import { captureCrash } from '@/lib/crash-store';
import { crashIssueUrl, type CrashReport } from '@/domain/crash';

/**
 * The last line of defence.
 *
 * Without this, a render error unmounts the tree and leaves a **blank white screen** — which on
 * a pitch, mid-session, with a timer running, is the worst thing this app can do. The boundary
 * catches the throw, writes the report to `localStorage` before rendering anything, and shows a
 * screen whose first action is getting the coach back to their session.
 *
 * A class component because that is still the only way to catch a render error in React.
 */
export class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    captureCrash({
      error,
      source: 'render',
      route: typeof location === 'undefined' ? 'unknown' : location.pathname,
      appVersion: APP_VERSION,
      ...(info.componentStack ? { componentStack: info.componentStack } : {}),
    });
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return <CrashScreen />;
  }
}

/**
 * What a coach sees instead of a white screen.
 *
 * `Reload` is the primary action and deliberately the biggest thing here. A crash mid-session
 * is a session still running — the timer is wall-clock anchored, so reloading resumes it with
 * the elapsed time intact and nothing observed is lost. Reporting matters, but not more than
 * getting the coach back to the pitch.
 */
function CrashScreen() {
  return (
    <main className="screen">
      <header className="screen-head">
        <p className="eyebrow">Something broke</p>
        <h1>The app hit an error</h1>
      </header>

      <p>
        Nothing you logged is lost — it was saved as you tapped, and your session is still running.
        Reloading picks it up where it was.
      </p>

      <button
        type="button"
        className="btn btn--primary btn--xl btn--block"
        onClick={() => location.reload()}
      >
        Reload and carry on
      </button>

      <p className="card-meta">
        The error was saved on this device. When you have a moment,{' '}
        <strong>Settings → Crash reports</strong> will send it to whoever builds this — with player
        names removed.
      </p>
    </main>
  );
}

/**
 * The two crashes a React boundary cannot see: a plain uncaught error, and a rejected promise
 * nobody caught. Both are common in this app's shape — an `await` in an event handler that
 * throws is a rejection, not a render error.
 *
 * Mounted once from `AppProviders`. Deliberately does **not** show a screen: these do not
 * necessarily break the UI, and replacing a working session with an error page because a
 * background write failed would be a worse bug than the one being reported.
 */
export function useCrashHandlers(): void {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      captureCrash({
        error: event.error ?? event.message,
        source: 'window',
        route: location.pathname,
        appVersion: APP_VERSION,
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      captureCrash({
        error: event.reason,
        source: 'promise',
        route: location.pathname,
        appVersion: APP_VERSION,
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
}

/** Opens GitHub with the crash already written up. Same hand-off as the feedback box. */
export function openCrashIssue(report: CrashReport): void {
  window.open(crashIssueUrl(report), '_blank', 'noopener,noreferrer');
}
