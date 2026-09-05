'use client';

import { useEffect, useRef, useState } from 'react';
import { Empty, Loading, Screen, ScreenHead, Segmented } from '../_components/ui';
import { showToast } from '../_components/toast-host';
import { InstallRow } from '../_components/install-prompt';
import { FeedbackBox } from '../_components/feedback-box';
import { getServiceContext, refresh, reopen, useAppState } from '@/modules/app/app-store';
import {
  commitImport,
  exportAll,
  planImport,
  type ImportPlan,
} from '@/modules/transfer/transfer-service';
import { exportFilename } from '@/modules/transfer/envelope';
import {
  formatBytes,
  getStorageStatus,
  requestPersistentStorage,
  shouldNagToExport,
  type StorageStatus,
} from '@/data/idb/storage-persistence';
import { isErr } from '@/lib/result';

type ThemeChoice = 'system' | 'light' | 'dark';
type ContrastChoice = 'system' | 'normal' | 'high';

/**
 * Settings: appearance, storage, and the export/import bridge.
 *
 * With no backend, the JSON file is the only route between devices *and* the only backup, so
 * it gets the most space on this screen — and the storage row exists because IndexedDB is
 * evictable by default and a coach deserves to know whether that has been mitigated.
 */
export default function SettingsPage() {
  const state = useAppState();
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [contrast, setContrast] = useState<ContrastChoice>('system');
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Appearance is a per-device preference, not squad data, so it lives in localStorage.
  useEffect(() => {
    const storedTheme = (localStorage.getItem('psp.theme') as ThemeChoice | null) ?? 'system';
    const storedContrast =
      (localStorage.getItem('psp.contrast') as ContrastChoice | null) ?? 'system';
    setTheme(storedTheme);
    setContrast(storedContrast);
    applyTheme(storedTheme);
    applyContrast(storedContrast);
  }, []);

  useEffect(() => {
    void getStorageStatus().then(setStorage);
  }, [state.status]);

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const lastExportAt = state.meta?.lastExportAt ?? null;
  const nag = shouldNagToExport(lastExportAt, Date.now());

  const doExport = async () => {
    setBusy(true);
    try {
      const envelope = await exportAll(getServiceContext());
      const json = JSON.stringify(envelope, null, 2);
      const filename = exportFilename(state.squad?.name ?? null, envelope.exportedAt);
      await saveFile(filename, json);
      await refresh();
      showToast(`Exported ${envelope.counts.sessions} session(s)`);
    } finally {
      setBusy(false);
    }
  };

  const previewImport = async (file: File) => {
    setBusy(true);
    try {
      const raw: unknown = JSON.parse(await file.text());
      const result = await planImport(getServiceContext(), raw, 'merge');
      if (isErr(result)) {
        showToast(describeProblem(result.error), { tone: 'stop' });
        return;
      }
      setPlan(result.value);
    } catch {
      showToast('That file is not valid JSON.', { tone: 'stop' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHead eyebrow="Settings" title="Preferences" />

      <InstallRow />

      <Segmented
        legend="Theme"
        value={theme}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        onChange={(value) => {
          setTheme(value);
          localStorage.setItem('psp.theme', value);
          applyTheme(value);
        }}
      />

      <Segmented
        legend="Contrast"
        value={contrast}
        options={[
          { value: 'system', label: 'System' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
        ]}
        onChange={(value) => {
          setContrast(value);
          localStorage.setItem('psp.contrast', value);
          applyContrast(value);
        }}
      />

      <section className="stack">
        <h2>Storage</h2>
        <div className="card card--sunk">
          {storage?.supported ? (
            <>
              <p>
                {formatBytes(storage.usageBytes)} used of {formatBytes(storage.quotaBytes)}
              </p>
              <p className="card-meta">
                {storage.persisted
                  ? 'Protected — the browser will not evict your data.'
                  : 'Not protected. The browser may clear this data under storage pressure.'}
              </p>
            </>
          ) : (
            <p className="card-meta">This browser does not report storage usage.</p>
          )}

          {storage?.supported && !storage.persisted ? (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const granted = await requestPersistentStorage();
                setStorage(await getStorageStatus());
                showToast(
                  granted
                    ? 'Storage protected'
                    : 'The browser declined — keep exporting regularly.',
                  { tone: granted ? 'default' : 'warn' },
                );
              }}
            >
              Ask to protect it
            </button>
          ) : null}
        </div>
      </section>

      <section className="stack">
        <h2>Backup</h2>
        {nag ? (
          <p className="banner banner--warn">
            {lastExportAt === null
              ? 'You have never exported. This file is the only backup there is.'
              : 'It has been over a month since your last export.'}
          </p>
        ) : null}

        <button
          type="button"
          className="btn btn--primary btn--lg btn--block"
          disabled={busy}
          onClick={doExport}
        >
          Export everything
        </button>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void previewImport(file);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="btn btn--lg btn--block"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          Import a file
        </button>

        {/* Import is always two steps: this is the dry run, and nothing is written yet. */}
        {plan ? (
          <div className="card">
            <span className="card-title">Ready to import</span>
            <ul className="stack stack--tight">
              {(Object.keys(plan.entries) as Array<keyof typeof plan.entries>).map((name) => {
                const entry = plan.entries[name];
                if (entry.create + entry.update + entry.skip === 0) return null;
                return (
                  <li key={name} className="card-meta">
                    {name}: {entry.create} new, {entry.update} updated, {entry.skip} unchanged
                  </li>
                );
              })}
            </ul>

            {plan.dropped.length > 0 ? (
              <p className="banner banner--warn">
                {plan.dropped.length} row(s) will be skipped — they reference data that is not in
                this file or on this device.
              </p>
            ) : null}

            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await commitImport(getServiceContext(), plan);
                    if (isErr(result)) {
                      showToast(describeProblem(result.error), { tone: 'stop' });
                      return;
                    }
                    setPlan(null);
                    await reopen();
                    showToast(`Imported ${result.value.written.sessions} session(s)`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setPlan(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <FeedbackBox />

      <section className="stack">
        <h2>About</h2>
        <Empty>
          Everything is stored on this device only. There is no account and no server — which is why
          the export file matters.
        </Empty>
      </section>
    </Screen>
  );
}

function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

function applyContrast(choice: ContrastChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-contrast');
  else root.setAttribute('data-contrast', choice);
}

function describeProblem(problem: { kind: string; message?: string; found?: string }): string {
  if (problem.kind === 'session_running') return 'Finish your session before importing.';
  if (problem.kind === 'wrong_format') return `That file is from ${problem.found}, not this app.`;
  return problem.message ?? 'That file could not be read.';
}

/**
 * `showSaveFilePicker` where it exists, falling back to a `Blob` download.
 *
 * iOS Safari has neither the picker nor a real download manager, so the fallback link is the
 * only route there — and it is the reason the export is a single self-contained file.
 */
async function saveFile(filename: string, contents: string): Promise<void> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      return;
    } catch {
      // Cancelled, or unsupported in this context. Fall through to the link.
    }
  }

  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
