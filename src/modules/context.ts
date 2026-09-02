import type { PocketDataStore } from '@/data/ports/data-store';
import type { Clock } from '@/lib/clock';
import type { IdGenerator } from '@/lib/id';
import { isoFromMs, type IsoDateTime } from '@/domain/primitives';

/**
 * What every service needs and nothing more: somewhere to persist, a clock, and a source of
 * ids. Passing these explicitly is what lets a service test run headless and deterministic
 * against `FakeDataStore`, `FakeClock` and `FakeIdGenerator`.
 */
export interface ServiceContext {
  readonly store: PocketDataStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** `now` as the branded ISO string the domain expects. */
export function now(ctx: ServiceContext): IsoDateTime {
  return isoFromMs(ctx.clock.now());
}
