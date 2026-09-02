import type { IdGenerator } from './id';

/**
 * A deterministic id generator producing valid v4-shaped UUIDs.
 *
 * Every id is a real UUID as far as `z.string().uuid()` is concerned, so branded schemas
 * parse it — but the sequence is predictable, which is what lets phase-scaling and
 * carry-forward tests assert on whole structures rather than picking fields apart.
 */
export class FakeIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = '0000') {}

  uuid(): string {
    this.counter += 1;
    const n = this.counter.toString(16).padStart(12, '0');
    return `${this.prefix}0000-0000-4000-8000-${n}`;
  }

  /** The number of ids handed out so far — occasionally the clearest assertion. */
  get issued(): number {
    return this.counter;
  }

  reset(): void {
    this.counter = 0;
  }
}
