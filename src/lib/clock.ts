/**
 * The clock port.
 *
 * Every time-dependent function in the domain takes time as data — either an `IsoDateTime`
 * or an epoch-millisecond number — rather than calling `Date.now()` itself. This port exists
 * so services that need "now" can be handed a deterministic one in tests.
 */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** The same instant as a UTC ISO-8601 string. */
  nowIso(): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};
