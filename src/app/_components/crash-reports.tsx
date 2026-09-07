'use client';

import { useEffect, useState } from 'react';
import { showToast } from './toast-host';
import { openCrashIssue } from './crash-boundary';
import { clearAllCrashes, clearCrash, loadCrashes } from '@/lib/crash-store';
import { CRASH_SOURCE_LABELS, type CrashReport } from '@/domain/crash';
import { formatShortDate } from './ui';

/**
 * Crash reports waiting to be sent.
 *
 * Hidden entirely when there are none — an empty "no crashes" panel in Settings is a permanent
 * reminder that the app might crash, which is a worse thing to carry than the panel is worth.
 *
 * The report is shown in full before it goes anywhere. That is the whole bargain of capturing
 * automatically and posting deliberately: the coach can read exactly what would be published,
 * including seeing that the names have already been replaced.
 */
export function CrashReports() {
  const [reports, setReports] = useState<CrashReport[] | null>(null);

  useEffect(() => {
    setReports(loadCrashes());
  }, []);

  if (reports === null || reports.length === 0) return null;

  return (
    <section className="stack">
      <h2>Crash reports</h2>
      <p className="card-meta">
        {reports.length === 1 ? 'One error was' : `${reports.length} errors were`} saved on this
        device. Player and squad names have already been replaced with <code>[name]</code>. Nothing
        is sent until you send it.
      </p>

      {reports.map((report) => (
        <div className="card" key={report.id}>
          <span className="card-title">{report.message}</span>
          <span className="card-meta">
            {report.route} · {CRASH_SOURCE_LABELS[report.source]} ·{' '}
            {formatShortDate(report.occurredAt)}
            {report.seen > 1 ? ` · seen ${report.seen} times` : ''}
          </span>

          <details className="card card--sunk">
            <summary>What would be sent</summary>
            {/* Pre-wrapped and scrollable: a stack trace must never stretch the page. */}
            <pre className="crash-stack">{report.stack || '(no stack trace)'}</pre>
          </details>

          <div className="row row--wrap">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                openCrashIssue(report);
                showToast('GitHub is open — press Create to post it.');
              }}
            >
              Send this crash
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setReports(clearCrash(report.id));
                showToast('Report discarded');
              }}
            >
              Discard
            </button>
          </div>
        </div>
      ))}

      {reports.length > 1 ? (
        <button
          type="button"
          className="btn btn--quiet btn--block"
          onClick={() => {
            clearAllCrashes();
            setReports([]);
            showToast('All reports discarded');
          }}
        >
          Discard all
        </button>
      ) : null}
    </section>
  );
}
