'use client';

import { useEffect, useState } from 'react';

/**
 * Install prompting.
 *
 * Two surfaces only — a permanent row in Settings, and one dismissible bar on `/` after the
 * coach's *second* completed session. **Never during the create flow**: an install banner
 * appearing between "objective" and "build session" is the fastest way to make a
 * twenty-second flow take a minute.
 *
 * Worth knowing: on iOS an installed PWA gets a **separate storage bucket** from Safari, so
 * data does not carry over. That is why the prompt is worth showing early, and why the
 * export file is offered as the bridge.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;

export function useInstallState() {
  const [available, setAvailable] = useState(deferred !== null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      deferred = event as BeforeInstallPromptEvent;
      setAvailable(true);
    };
    const onInstalled = () => {
      deferred = null;
      setAvailable(false);
      setInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    deferred = null;
    setAvailable(false);
    return choice.outcome === 'accepted';
  };

  // iOS has no `beforeinstallprompt` at all, so it gets instructions rather than a button.
  const isIos =
    typeof navigator !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !/crios|fxios/i.test(navigator.userAgent);

  return { available, installed, isIos, install };
}

/** The permanent Settings row. */
export function InstallRow() {
  const { available, installed, isIos, install } = useInstallState();

  if (installed) {
    return (
      <div className="card card--sunk">
        <span className="card-title">Installed</span>
        <span className="card-meta">Works in airplane mode.</span>
      </div>
    );
  }

  if (isIos) {
    return (
      <div className="card card--sunk">
        <span className="card-title">Add to home screen</span>
        <span className="card-meta">
          Tap Share, then Add to Home Screen. Note that an installed app on iOS gets its own storage
          — export first if you have sessions here already.
        </span>
      </div>
    );
  }

  if (!available) {
    return (
      <div className="card card--sunk">
        <span className="card-title">Install</span>
        <span className="card-meta">
          Use your browser menu to install this app for offline use.
        </span>
      </div>
    );
  }

  return (
    <button type="button" className="btn btn--lg btn--block" onClick={() => void install()}>
      Install for offline use
    </button>
  );
}

/** The one dismissible bar on `/`, shown only after a second completed session. */
export function InstallBar({ completedSessions }: { completedSessions: number }) {
  const { available, installed, install } = useInstallState();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem('psp.install-dismissed') === '1');
  }, []);

  if (installed || dismissed || !available || completedSessions < 2) return null;

  return (
    <div className="banner banner--signal row row--between">
      <span>Install this so it works with no signal.</span>
      <span className="row">
        <button type="button" className="btn btn--quiet" onClick={() => void install()}>
          Install
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => {
            localStorage.setItem('psp.install-dismissed', '1');
            setDismissed(true);
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      </span>
    </div>
  );
}
