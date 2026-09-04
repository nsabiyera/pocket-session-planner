import { z } from 'zod';
import { ChallengeEventSchema } from './challenge';
import { InterventionEventSchema } from './intervention';
import { PhaseIdSchema } from './ids';
import { IsoDateTimeSchema } from './primitives';

/**
 * WALL-CLOCK ANCHORS, NOT A COUNTDOWN.
 *
 * A decrementing counter is the obvious way to build a timer and it is wrong for this app.
 * It drifts under throttled `setInterval`, it freezes when the tab is discarded, and it
 * needs catch-up logic on every resume — logic that is subtly wrong in exactly the
 * situation a coach cannot debug: mid-drill, in the rain.
 *
 * Instead the persisted state is `{ startedAt, runningSince, accumulatedMs }` and elapsed
 * time is **derived** from those timestamps whenever anyone asks. `setInterval` only forces
 * a repaint; deleting it would change nothing but the refresh rate. Screen lock, tab
 * discard, throttling, refresh and app kill all survive for free, because the drill
 * genuinely *is* still running and the wall clock genuinely does know how long it has been.
 */
export const PhaseRunSchema = z.object({
  phaseId: PhaseIdSchema,
  startedAt: IsoDateTimeSchema,
  /** `null` => paused (or stopped by an open, play-stopping intervention). */
  runningSince: IsoDateTimeSchema.nullable(),
  accumulatedMs: z.number().int().min(0),
  endedAt: IsoDateTimeSchema.nullable().default(null),
  skipped: z.boolean().default(false),
});
export type PhaseRun = z.infer<typeof PhaseRunSchema>;
export type PhaseRunInput = z.input<typeof PhaseRunSchema>;

/**
 * Why a phase clock is stopped. `intervention` is distinct from `coach` because an
 * intervention pause is what makes ball-rolling time measurable — resuming it also closes
 * the open `InterventionEvent`.
 */
export const PauseReasonSchema = z.enum(['coach', 'intervention']);
export type PauseReason = z.infer<typeof PauseReasonSchema>;

export const SessionRunStateSchema = z.object({
  startedAt: IsoDateTimeSchema,
  endedAt: IsoDateTimeSchema.nullable().default(null),
  /** Index into `phaseRuns`, not into `session.phases` — a coach may revisit a practice. */
  currentPhaseIndex: z.number().int().min(0),
  phaseRuns: z.array(PhaseRunSchema).min(1).max(12),
  pauseReason: PauseReasonSchema.nullable().default(null),
  /**
   * The intervention whose clock-stop is currently open. Resuming play closes it and
   * stamps its `durationMs`. Null the rest of the time.
   */
  openInterventionId: z.string().uuid().nullable().default(null),
  /**
   * Written every ~30s. If `now - lastHeartbeatAt > 3h` on resume, the app offers a
   * reconciliation sheet rather than silently claiming a five-hour session.
   */
  lastHeartbeatAt: IsoDateTimeSchema,
  /** Low-volume, same writer as the session document — see the ADR discussion in the plan. */
  interventionEvents: z.array(InterventionEventSchema).max(200).default([]),
  /**
   * Challenge sightings, for the same reason interventions live here rather than in their
   * own store: low-volume, written by the same timer-owning code path, and never queried
   * across sessions. The **tally is the length of this array**, never a stored counter.
   */
  challengeEvents: z.array(ChallengeEventSchema).max(400).default([]),
});
export type SessionRunState = z.infer<typeof SessionRunStateSchema>;
export type SessionRunStateInput = z.input<typeof SessionRunStateSchema>;

/** A run left open for longer than this is almost certainly a forgotten session. */
export const STALE_RUN_THRESHOLD_MS = 3 * 60 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 30_000;

export function currentPhaseRun(run: SessionRunState): PhaseRun | undefined {
  return run.phaseRuns[run.currentPhaseIndex];
}

export function isRunStale(run: SessionRunState, nowMs: number): boolean {
  return nowMs - Date.parse(run.lastHeartbeatAt) > STALE_RUN_THRESHOLD_MS;
}
