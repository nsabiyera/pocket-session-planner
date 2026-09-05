import { beforeEach, describe, expect, it } from 'vitest';
import {
  attachPhaseImage,
  describePhaseImageError,
  detachPhaseImage,
  loadPhaseImages,
} from './phase-image-service';
import { startDraft } from './planning-service';
import { createSquad } from '../squad/squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { MAX_IMAGES_PER_PHASE, type PhaseImage } from '@/domain/phase-image';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import { asPhaseId, asPhaseImageId, asSessionId, type SessionId } from '@/domain/ids';
import { T0, testId } from '@/test/builders';
import type { ServiceContext } from '../context';
import type { Session } from '@/domain/session';

/**
 * **The success path of `attachPhaseImage` is not covered here, and cannot be.**
 *
 * It runs `downscaleImage`, which needs `createImageBitmap` and a real canvas — neither of
 * which jsdom has. That half is verified in a browser. What is covered here is everything
 * that decides *whether* to write: the guards, and the two-store removal, which is the part
 * that can corrupt a plan rather than merely fail to add to one.
 */

let ctx: ServiceContext;

beforeEach(() => {
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator('aaaa') };
});

async function aDraft(): Promise<Session> {
  const squad = await createSquad(ctx, { name: 'U12 Reds' });
  return unwrap(
    await startDraft(ctx, {
      squadId: squad.id,
      objectiveText: 'Playing out from the back',
      objectiveTemplateId: 'playing-out-from-the-back',
    }),
  );
}

const anImage = (label: string, sessionId: SessionId): PhaseImage => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  createdAt: T0,
  updatedAt: T0,
  id: asPhaseImageId(testId(label)),
  sessionId,
  contentType: 'image/webp',
  bytes: 3,
  width: 1600,
  height: 1200,
  caption: '',
  capturedAt: T0,
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
});

/** Attaches without going near the browser-only downscaler. */
async function seedImage(session: Session, label: string): Promise<PhaseImage> {
  const image = anImage(label, session.id);
  await ctx.store.phaseImages.put(image);

  const fresh = (await ctx.store.sessions.get(session.id))!;
  await ctx.store.sessions.put({
    ...fresh,
    phases: fresh.phases.map((phase, index) =>
      index === 0 ? { ...phase, imageIds: [...phase.imageIds, image.id] } : phase,
    ),
  });
  return image;
}

describe('attachPhaseImage guards', () => {
  it('refuses a session that is not there', async () => {
    const result = await attachPhaseImage(
      ctx,
      asSessionId(testId('ghost')),
      asPhaseId(testId('phase')),
      new Blob(['x']),
    );
    expect(isErr(result) && result.error.kind).toBe('session_not_found');
  });

  it('refuses a phase that is not in the plan', async () => {
    const session = await aDraft();
    const result = await attachPhaseImage(
      ctx,
      session.id,
      asPhaseId(testId('not-a-phase')),
      new Blob(['x']),
    );
    expect(isErr(result) && result.error.kind).toBe('phase_not_found');
  });

  it('refuses a fourth picture, before touching the file', async () => {
    // The cap is checked ahead of the downscale, so a coach who is already full does not
    // wait for a 12 MP photo to be resized only to be told no.
    const session = await aDraft();
    for (let i = 0; i < MAX_IMAGES_PER_PHASE; i += 1) await seedImage(session, `img-${i}`);

    const fresh = (await ctx.store.sessions.get(session.id))!;
    const result = await attachPhaseImage(ctx, session.id, fresh.phases[0]!.id, new Blob(['x']));

    expect(isErr(result) && result.error.kind).toBe('too_many');
    expect(await ctx.store.phaseImages.listAll()).toHaveLength(MAX_IMAGES_PER_PHASE);
  });

  it('writes nothing when the file will not decode', async () => {
    // jsdom has no `createImageBitmap`, so this is the real "that is not a picture" path.
    const session = await aDraft();
    const fresh = (await ctx.store.sessions.get(session.id))!;

    const result = await attachPhaseImage(ctx, session.id, fresh.phases[0]!.id, new Blob(['nope']));

    expect(isErr(result) && result.error.kind).toBe('unreadable');
    // The important half: a failed decode leaves no orphaned blob eating the quota.
    expect(await ctx.store.phaseImages.listAll()).toEqual([]);
    const after = (await ctx.store.sessions.get(session.id))!;
    expect(after.phases.flatMap((phase) => phase.imageIds)).toEqual([]);
  });
});

describe('detachPhaseImage', () => {
  it('removes the id and the bytes together', async () => {
    const session = await aDraft();
    const image = await seedImage(session, 'img-1');
    const fresh = (await ctx.store.sessions.get(session.id))!;

    unwrap(await detachPhaseImage(ctx, session.id, fresh.phases[0]!.id, image.id));

    const after = (await ctx.store.sessions.get(session.id))!;
    expect(after.phases.flatMap((phase) => phase.imageIds)).toEqual([]);
    // A **hard** delete: a soft-deleted image would go on occupying the quota it was
    // removed to free, and there is nothing to recover — the camera roll still has it.
    expect(await ctx.store.phaseImages.get(image.id)).toBeUndefined();
  });

  it('leaves the other pictures on the phase alone', async () => {
    const session = await aDraft();
    const first = await seedImage(session, 'img-1');
    const second = await seedImage(session, 'img-2');
    const fresh = (await ctx.store.sessions.get(session.id))!;

    unwrap(await detachPhaseImage(ctx, session.id, fresh.phases[0]!.id, first.id));

    const after = (await ctx.store.sessions.get(session.id))!;
    expect(after.phases[0]!.imageIds).toEqual([second.id]);
    expect(await ctx.store.phaseImages.get(second.id)).toBeDefined();
  });

  it('refuses a session or phase that is not there', async () => {
    const session = await aDraft();
    const image = await seedImage(session, 'img-1');

    const gone = await detachPhaseImage(
      ctx,
      asSessionId(testId('ghost')),
      asPhaseId(testId('p')),
      image.id,
    );
    expect(isErr(gone) && gone.error.kind).toBe('session_not_found');

    const wrongPhase = await detachPhaseImage(
      ctx,
      session.id,
      asPhaseId(testId('not-a-phase')),
      image.id,
    );
    expect(isErr(wrongPhase) && wrongPhase.error.kind).toBe('phase_not_found');
    // Neither failure removed anything.
    expect(await ctx.store.phaseImages.get(image.id)).toBeDefined();
  });
});

describe('loadPhaseImages', () => {
  it('reads nothing for a phase with no pictures, without a round trip', async () => {
    expect(await loadPhaseImages(ctx, [])).toEqual([]);
  });

  it('reads the pictures a phase points at', async () => {
    const session = await aDraft();
    const first = await seedImage(session, 'img-1');
    const second = await seedImage(session, 'img-2');

    const rows = await loadPhaseImages(ctx, [first.id, second.id]);
    expect(rows.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(rows[0]?.blob.size).toBe(3);
  });
});

describe('describePhaseImageError', () => {
  it('says something a coach can act on for every kind', () => {
    expect(describePhaseImageError({ kind: 'too_many' })).toContain(String(MAX_IMAGES_PER_PHASE));
    expect(describePhaseImageError({ kind: 'unreadable' })).toMatch(/picture/i);
    expect(describePhaseImageError({ kind: 'too_large', bytes: 9 })).toMatch(/too big/i);
    expect(describePhaseImageError({ kind: 'phase_not_found' })).toMatch(/plan/i);
  });
});
