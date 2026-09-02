import { describe, expect, it } from 'vitest';
import { ObservationSchema } from './observation';
import { PlayerSchema } from './player';
import { SquadSchema } from './squad';
import { SessionSchema } from './session';
import { aPlayer, anObservation, aSession, aSquad } from '@/test/builders';

/**
 * **The one IndexedDB rule that bites.**
 *
 * IDB cannot store `null` as a key, and it *skips* records whose index key path resolves to
 * `undefined`. So any nullable field that is also **indexed** must be an optional omitted
 * property, never `T | null` — otherwise every not-yet-deleted record would either throw on
 * write or land in the index under a key that is not a key.
 *
 * Non-indexed nullable fields (`Session.run`, `endedAt`, `reviewId`) keep `| null` freely,
 * because an explicit null round-trips through JSON export better than an absent key.
 *
 * This file pins both halves. If someone "tidies" one of these into `.nullable()`, the
 * failure would otherwise show up as records mysteriously missing from a list months later.
 */

const INDEXED_OPTIONAL_FIELDS = [
  ['squads.deletedAt', () => aSquad(), SquadSchema, 'deletedAt'],
  ['squads.archivedAt', () => aSquad(), SquadSchema, 'archivedAt'],
  ['players.deletedAt', () => aPlayer('kai'), PlayerSchema, 'deletedAt'],
  ['players.archivedAt', () => aPlayer('kai'), PlayerSchema, 'archivedAt'],
  ['observations.playerId', () => anObservation('obs1'), ObservationSchema, 'playerId'],
] as const;

describe('indexed nullable fields are optional-omitted, never null', () => {
  it.each(INDEXED_OPTIONAL_FIELDS)(
    '%s is absent rather than null by default',
    (_name, build, _schema, field) => {
      const record = build() as Record<string, unknown>;
      expect(field in record).toBe(false);
      expect(record[field]).toBeUndefined();
    },
  );

  it.each(INDEXED_OPTIONAL_FIELDS)('%s rejects an explicit null', (_name, build, schema, field) => {
    const record = { ...(build() as Record<string, unknown>), [field]: null };
    expect(schema.safeParse(record).success).toBe(false);
  });

  it('a team-wide observation omits playerId entirely, which is what keeps it out of by-player-at', () => {
    const teamNote = anObservation('teamnote', { kind: 'note' });
    expect('playerId' in teamNote).toBe(false);

    // Round-tripping through the structured clone IndexedDB would perform must not
    // resurrect the key as `undefined`-valued-but-present.
    const cloned = structuredClone(teamNote);
    expect(Object.keys(cloned)).not.toContain('playerId');
  });
});

describe('non-indexed nullable fields keep an explicit null', () => {
  it('Session.run, reviewId and abandonReason are null, not absent', () => {
    const session = aSession();
    expect(session.run).toBeNull();
    expect(session.reviewId).toBeNull();
    expect(session.abandonReason).toBeNull();
    expect(SessionSchema.safeParse({ ...session, run: null }).success).toBe(true);
  });

  it('a phase intervention override is null when inherited, so JSON export reads clearly', () => {
    const [phase] = aSession().phases;
    expect(phase?.intervention).toBeNull();
  });
});
