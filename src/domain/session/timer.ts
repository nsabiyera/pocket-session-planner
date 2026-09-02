import type { PhaseRun, SessionRunState } from '../session-run';
import type { Session, SessionPhase } from '../session';

/**
 * Elapsed time is **derived**, never counted.
 *
 * `setInterval` in this app forces repaints and nothing else — deleting it would change the
 * refresh rate and not one displayed number. That is what makes screen lock, tab discard,
 * throttled timers, a refresh and a force-quit all survivable with no catch-up logic: on
 * wake we simply ask the wall clock again.
 */
export function phaseElapsedMs(run: PhaseRun, nowMs: number): number {
  if (run.endedAt !== null || run.runningSince === null) return run.accumulatedMs;
  // `Math.max` guards a device clock moved *backwards* mid-session — a real thing when a
  // phone picks up network time, and one that would otherwise show a shrinking timer.
  return run.accumulatedMs + Math.max(0, nowMs - Date.parse(run.runningSince));
}

export interface PhaseClock {
  readonly elapsedMs: number;
  readonly plannedMs: number;
  /** Clamped at zero — a finished phase reads `0:00`, never a negative countdown. */
  readonly remainingMs: number;
  readonly overrunMs: number;
  readonly isRunning: boolean;
  readonly isOverrun: boolean;
  /** Drives the last-minute colour change and its haptic. */
  readonly isFinalMinute: boolean;
  /** Drives the per-second pulse. Suppressed under `prefers-reduced-motion` by the UI. */
  readonly isFinalTenSeconds: boolean;
  /** 0-1, clamped. The progress bar. */
  readonly progress: number;
}

export const FINAL_MINUTE_MS = 60_000;
export const FINAL_TEN_SECONDS_MS = 10_000;

export function phaseClock(phase: SessionPhase, run: PhaseRun, nowMs: number): PhaseClock {
  const elapsedMs = phaseElapsedMs(run, nowMs);
  const plannedMs = phase.plannedDurationMin * 60_000;
  const remainingMs = Math.max(0, plannedMs - elapsedMs);
  const overrunMs = Math.max(0, elapsedMs - plannedMs);
  const isRunning = run.endedAt === null && run.runningSince !== null;

  return {
    elapsedMs,
    plannedMs,
    remainingMs,
    overrunMs,
    isRunning,
    isOverrun: overrunMs > 0,
    isFinalMinute: overrunMs === 0 && remainingMs <= FINAL_MINUTE_MS,
    isFinalTenSeconds: overrunMs === 0 && remainingMs <= FINAL_TEN_SECONDS_MS,
    progress: plannedMs === 0 ? 1 : Math.min(1, elapsedMs / plannedMs),
  };
}

/** Total elapsed across every phase run, including ones already ended. */
export function sessionElapsedMs(run: SessionRunState, nowMs: number): number {
  return run.phaseRuns.reduce((total, phaseRun) => total + phaseElapsedMs(phaseRun, nowMs), 0);
}

export interface SessionClock {
  readonly elapsedMs: number;
  readonly plannedMs: number;
  readonly remainingMs: number;
  readonly phaseNumber: number;
  readonly phaseCount: number;
}

export function sessionClock(session: Session, nowMs: number): SessionClock | null {
  if (session.run === null) return null;
  const elapsedMs = sessionElapsedMs(session.run, nowMs);
  const plannedMs = session.plannedDurationMin * 60_000;

  // `2/5` counts position in the **plan**, not in the run log. A coach who goes back to a
  // practice adds a second `PhaseRun` for it, and reading `4/3` on the way back would be
  // both wrong and alarming.
  const ordered = [...session.phases].sort((a, b) => a.order - b.order);
  const currentPhaseId = session.run.phaseRuns[session.run.currentPhaseIndex]?.phaseId;
  const position = ordered.findIndex((phase) => phase.id === currentPhaseId);

  return {
    elapsedMs,
    plannedMs,
    remainingMs: Math.max(0, plannedMs - elapsedMs),
    // 1-based, because `2/5` is what the coach reads, not `1/5`.
    phaseNumber: position >= 0 ? position + 1 : 0,
    phaseCount: ordered.length,
  };
}

/**
 * `34:20` — or `1:04:20` once a session passes the hour. Never `00:34:20`, which wastes two
 * characters of a display that is being read at arm's length in daylight.
 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * What the big numerals show. An overrun reads `+2:14`, because a bare `2:14` next to a
 * colour change is ambiguous at a glance — and colour alone would fail WCAG 1.4.1 anyway.
 */
export function formatPhaseTimer(clock: PhaseClock): string {
  return clock.isOverrun ? `+${formatClock(clock.overrunMs)}` : formatClock(clock.remainingMs);
}

/** `8:42 left` / `2:14 over` — the resume line on the home screen. */
export function describePhaseClock(clock: PhaseClock): string {
  return clock.isOverrun
    ? `${formatClock(clock.overrunMs)} over`
    : `${formatClock(clock.remainingMs)} left`;
}
