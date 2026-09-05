'use client';

import { useEffect, useState } from 'react';
import { Segmented } from './ui';
import { showToast } from './toast-host';
import { APP_VERSION } from '@/modules/transfer/transfer-service';
import {
  FEEDBACK_AREAS,
  FEEDBACK_AREA_LABELS,
  FEEDBACK_KIND_LABELS,
  MAX_NOTE_LENGTH,
  feedbackUrl,
  type FeedbackArea,
  type FeedbackContext,
  type FeedbackKind,
} from '@/domain/feedback';

/** The draft is a per-device convenience, like the theme — not squad data, so localStorage. */
const DRAFT_KEY = 'psp.feedback.draft';

/**
 * The feedback box.
 *
 * Writing happens here; posting happens on GitHub. Tapping the button opens GitHub's own
 * new-issue form with everything already filled in, and the coach presses Create themselves —
 * see `domain/feedback.ts` for why the app must not be the thing that publishes.
 *
 * Two consequences of being an offline-first app fall out of that:
 *
 * The draft is kept. A coach types this standing on a pitch, which is exactly where there is
 * no signal, so the note survives a reload and the button says so rather than throwing the
 * words away at the moment they were worth writing down.
 *
 * The context is shown before it is sent. It is four lines and no squad data — but "we
 * attached some diagnostics" is a sentence an app should never make a coach take on trust.
 */
export function FeedbackBox() {
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [note, setNote] = useState('');
  const [area, setArea] = useState<FeedbackArea | ''>('');
  const [includeContext, setIncludeContext] = useState(true);
  const [context, setContext] = useState<FeedbackContext | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setNote(localStorage.getItem(DRAFT_KEY) ?? '');
    setContext(readContext());

    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    if (note === '') localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, note);
  }, [note]);

  const send = () => {
    const trimmed = note.trim();
    if (trimmed === '') {
      showToast('Write a line about what happened first.', { tone: 'warn' });
      return;
    }

    // The draft is already saved, so there is nothing to rescue — just say so plainly.
    if (!online) {
      showToast('No signal. Your note is saved here — send it when you are back online.', {
        tone: 'warn',
      });
      return;
    }

    const url = feedbackUrl({
      kind,
      note: trimmed,
      area: area === '' ? null : area,
      context: includeContext ? (context ?? readContext()) : null,
    });

    window.open(url, '_blank', 'noopener,noreferrer');
    setNote('');
    showToast('GitHub is open — press Create to post it.');
  };

  return (
    <section className="stack">
      <h2>Feedback</h2>

      <Segmented<FeedbackKind>
        legend="What kind"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'bug', label: FEEDBACK_KIND_LABELS.bug },
          { value: 'idea', label: FEEDBACK_KIND_LABELS.idea },
        ]}
      />

      <div className="field">
        <label htmlFor="feedback-note">
          {kind === 'bug' ? 'What happened' : 'What would you change'}
        </label>
        <textarea
          id="feedback-note"
          value={note}
          maxLength={MAX_NOTE_LENGTH}
          placeholder={
            kind === 'bug'
              ? 'What you were doing, what you expected, and what the app did instead.'
              : 'What you wanted to do, and what got in the way.'
          }
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="feedback-area">Where in the app</label>
        <select
          id="feedback-area"
          value={area}
          onChange={(event) => setArea(event.target.value as FeedbackArea | '')}
        >
          <option value="">Not sure</option>
          {FEEDBACK_AREAS.map((value) => (
            <option key={value} value={value}>
              {FEEDBACK_AREA_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <Segmented<'on' | 'off'>
        legend="Device details"
        value={includeContext ? 'on' : 'off'}
        onChange={(value) => setIncludeContext(value === 'on')}
        options={[
          { value: 'on', label: 'Attach' },
          { value: 'off', label: 'Leave off' },
        ]}
      />

      <details className="card card--sunk">
        <summary>What gets attached</summary>
        <ul className="stack stack--tight">
          <li className="card-meta">App version: {APP_VERSION}</li>
          <li className="card-meta">
            Installed: {context?.standalone ? 'to the home screen' : 'no — a browser tab'}
          </li>
          <li className="card-meta">Screen: {context?.screen ?? '—'}</li>
          <li className="card-meta">Browser: {context?.userAgent ?? '—'}</li>
        </ul>
        <p className="card-meta">Nothing about your squad, players or sessions is ever attached.</p>
      </details>

      {!online ? (
        <p className="banner banner--warn">
          You are offline. Your note is saved on this device — the button needs signal, because the
          issue is posted on GitHub.
        </p>
      ) : null}

      <button type="button" className="btn btn--primary btn--lg btn--block" onClick={send}>
        Open GitHub to post it
      </button>

      <p className="card-meta">
        This opens GitHub with your report already written. It is public, and it posts under your
        GitHub name once you press Create there — nothing is sent until you do.
      </p>
    </section>
  );
}

/**
 * What the app knows about itself. Read once on mount rather than at send time, so the coach
 * is shown the same values that will be attached.
 */
function readContext(): FeedbackContext {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  return {
    appVersion: APP_VERSION,
    userAgent: navigator.userAgent,
    screen: `${window.screen.width}×${window.screen.height}`,
    standalone,
  };
}
