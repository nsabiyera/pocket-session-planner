import {
  MAX_STACK_CHARS,
  recordCrash,
  scrubCrashText,
  type CrashReport,
  type CrashSource,
} from '@/domain/crash';

/**
 * Where crash reports live.
 *
 * **`localStorage`, not IndexedDB.** Every other record in this app goes through the data store,
 * and this one deliberately does not: the thing that just crashed may well *be* the database, or
 * the service that opens it, and a crash reporter that needs the broken subsystem to work is a
 * crash reporter that fails exactly when it is needed. `localStorage` is synchronous, needs no
 * open handle, and works before `initApp` has finished.
 *
 * Every access is wrapped, because a reporter that throws while reporting turns one crash into
 * two and loses the first.
 */
const KEY = 'psp.crashes';

export function loadCrashes(): CrashReport[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CrashReport[]).filter(isCrashReport) : [];
  } catch {
    // Corrupt or unavailable. An empty list is the right answer: the coach sees no reports
    // rather than a second crash on the recovery screen.
    return [];
  }
}

export function saveCrashes(reports: readonly CrashReport[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(reports));
  } catch {
    // Full, or blocked in a private window. Nothing to do and nothing worth saying — the
    // report is already on screen, which is the part that matters.
  }
}

export function clearCrash(id: string): CrashReport[] {
  const remaining = loadCrashes().filter((report) => report.id !== id);
  saveCrashes(remaining);
  return remaining;
}

export function clearAllCrashes(): void {
  saveCrashes([]);
}

/**
 * The names to redact. Read from the store's own cache rather than passed in, because a global
 * error handler has no React context and no `await` available to it.
 *
 * Written by `app-store` on every load. If it is missing — a crash during the very first open —
 * nothing is redacted **and nothing needs to be**, because no squad has been read yet.
 */
const NAMES_KEY = 'psp.crash-names';

export function rememberNamesToRedact(names: readonly string[]): void {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    // Non-fatal. `captureCrash` falls back to redacting nothing, and the coach still reads
    // the report before it goes anywhere.
  }
}

function namesToRedact(): string[] {
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Captures a crash: scrub, fold into what is stored, and persist immediately.
 *
 * Persisting before anything is rendered is the point. A crash on the pitch is usually followed
 * by the coach force-quitting the app, and a report held only in memory would be gone.
 */
export function captureCrash(input: {
  error: unknown;
  source: CrashSource;
  route: string;
  appVersion: string;
  componentStack?: string;
}): CrashReport[] {
  const names = namesToRedact();
  const { message, stack } = describeError(input.error, input.componentStack);

  const report: CrashReport = {
    id: crashId(),
    occurredAt: new Date().toISOString(),
    source: input.source,
    message: scrubCrashText(message, names).slice(0, 300),
    stack: scrubCrashText(stack, names).slice(0, MAX_STACK_CHARS),
    // The route can carry a query string; nothing in this app puts a name in one, but the
    // pathname alone is all the report needs.
    route: input.route.split('?')[0] ?? input.route,
    appVersion: input.appVersion,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    seen: 1,
  };

  const next = recordCrash(loadCrashes(), report);
  saveCrashes(next);
  return next;
}

/** A thrown value is not necessarily an `Error`. Strings, objects and `undefined` all happen. */
function describeError(
  error: unknown,
  componentStack?: string,
): { message: string; stack: string } {
  const suffix = componentStack ? `\n\nComponent stack:${componentStack}` : '';

  if (error instanceof Error) {
    return { message: error.message || error.name, stack: `${error.stack ?? ''}${suffix}` };
  }
  if (typeof error === 'string') return { message: error, stack: suffix.trim() };

  try {
    return { message: JSON.stringify(error) ?? String(error), stack: suffix.trim() };
  } catch {
    return { message: String(error), stack: suffix.trim() };
  }
}

/**
 * `crypto.randomUUID` needs a secure context and this may be a plain-http LAN test, so fall
 * back rather than throw — inside the crash reporter of all places.
 */
function crashId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `crash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function isCrashReport(value: unknown): value is CrashReport {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CrashReport>;
  return typeof candidate.id === 'string' && typeof candidate.message === 'string';
}
