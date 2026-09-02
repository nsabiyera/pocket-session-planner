import type { Clock } from './clock';

/**
 * A hand-written clock fake — the house style is fakes over mocks.
 *
 * `advance` is what the timer tests use to walk a session through pause, resume, screen lock
 * and overrun. `set` exists for the one case a monotonic fake cannot express: a device clock
 * moved *backwards* mid-session, which the timer must survive.
 */
export class FakeClock implements Clock {
  private currentMs: number;

  constructor(start: string | number = '2026-08-31T18:00:00.000Z') {
    this.currentMs = typeof start === 'number' ? start : Date.parse(start);
  }

  now(): number {
    return this.currentMs;
  }

  nowIso(): string {
    return new Date(this.currentMs).toISOString();
  }

  /** Moves the clock forward. Negative deltas are allowed — see `set`. */
  advance(ms: number): this {
    this.currentMs += ms;
    return this;
  }

  advanceMinutes(minutes: number): this {
    return this.advance(minutes * 60_000);
  }

  advanceSeconds(seconds: number): this {
    return this.advance(seconds * 1000);
  }

  /** Jumps to an absolute instant, including one earlier than the current time. */
  set(at: string | number): this {
    this.currentMs = typeof at === 'number' ? at : Date.parse(at);
    return this;
  }
}
