import { z } from 'zod';

/**
 * A synchronous mirror of just enough state to paint the home screen before IndexedDB has
 * finished opening.
 *
 * IndexedDB is asynchronous, and on a cold start on a mid-range phone it can be a couple of
 * hundred milliseconds before the first row comes back. A coach who opens the app mid-drill
 * should not see an empty screen for that long — they should see
 * `Resume — Main practice, 8:42 left` immediately.
 *
 * `localStorage` is the only synchronous storage the platform offers, so this is the one
 * place we use it. It is a **cache, never a source of truth**: everything here is
 * re-derived from IndexedDB the moment it opens, and a stale or absent mirror costs nothing
 * but the placeholder.
 */

const KEY = 'psp.resume';

export const ResumeMirrorSchema = z.object({
  activeSessionId: z.string().nullable(),
  squadId: z.string().nullable(),
  /** Enough to render the hero line without a database. */
  sessionTitle: z.string().max(120).nullable(),
  phaseTitle: z.string().max(80).nullable(),
  status: z.enum(['draft', 'planned', 'in_progress', 'completed', 'abandoned']).nullable(),
  /** Wall-clock anchors again — the mirror stores the derivation inputs, not a countdown. */
  phaseRunningSince: z.string().nullable(),
  phaseAccumulatedMs: z.number().int().min(0).nullable(),
  phasePlannedMs: z.number().int().min(0).nullable(),
  updatedAt: z.string(),
});
export type ResumeMirror = z.infer<typeof ResumeMirrorSchema>;

export function readResumeMirror(): ResumeMirror | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = ResumeMirrorSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Private mode, disabled storage, corrupt JSON. All the same outcome: no shortcut.
    return null;
  }
}

export function writeResumeMirror(mirror: ResumeMirror): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(mirror));
  } catch {
    // A full or disabled localStorage must never break a session. The mirror is optional.
  }
}

export function clearResumeMirror(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do, and nothing that matters.
  }
}

/** Elapsed time for the mirrored phase, derived the same way the real timer derives it. */
export function mirrorRemainingMs(mirror: ResumeMirror, nowMs: number): number | null {
  if (mirror.phasePlannedMs === null || mirror.phaseAccumulatedMs === null) return null;
  const running =
    mirror.phaseRunningSince === null
      ? 0
      : Math.max(0, nowMs - Date.parse(mirror.phaseRunningSince));
  return Math.max(0, mirror.phasePlannedMs - (mirror.phaseAccumulatedMs + running));
}
