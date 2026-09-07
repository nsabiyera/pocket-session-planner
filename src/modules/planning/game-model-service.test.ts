import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPrinciple,
  editPrinciple,
  getGameModel,
  removePrinciple,
  setIdentity,
  setNotes,
} from './game-model-service';
import { createSquad } from '../squad/squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { asPrincipleId, asSquadId, type SquadId } from '@/domain/ids';
import { childrenOf, momentsWithoutPrinciples, type Moment } from '@/domain/game-model';
import { T0, testId } from '@/test/builders';
import type { ServiceContext } from '../context';

let ctx: ServiceContext;
let squadId: SquadId;

beforeEach(async () => {
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
  squadId = (await createSquad(ctx, { name: 'First Team' })).id;
});

const withIdentity = async () =>
  unwrap(await setIdentity(ctx, squadId, 'We build from the back and attack through the middle'));

const addMacro = async (moment: Moment = 'offensive_organisation', text = 'Build from the back') =>
  unwrap(await addPrinciple(ctx, { squadId, moment, level: 'macro', text }));

describe('creating a model', () => {
  it('does not exist until something is written', async () => {
    // A coach who never opens this screen has no game model, not an empty one — and those are
    // different statements once the app starts reporting on gaps.
    expect(await getGameModel(ctx, squadId)).toBeUndefined();
  });

  it('is created by the identity line alone', async () => {
    const model = await withIdentity();
    expect(model.identity).toBe('We build from the back and attack through the middle');
    expect(model.principles).toEqual([]);
    expect((await getGameModel(ctx, squadId))?.id).toBe(model.id);
  });

  it('replaces the identity without disturbing the principles', async () => {
    await withIdentity();
    await addMacro();
    const updated = unwrap(await setIdentity(ctx, squadId, 'We press high and play forward'));

    expect(updated.identity).toBe('We press high and play forward');
    expect(updated.principles).toHaveLength(1);
  });

  it('refuses a squad that does not exist', async () => {
    const result = await setIdentity(ctx, asSquadId(testId('nope')), 'Anything');
    expect(isErr(result)).toBe(true);
  });

  it('refuses an empty identity', async () => {
    expect(isErr(await setIdentity(ctx, squadId, '   '))).toBe(true);
  });

  it('keeps one model per squad however many times it is written', async () => {
    await withIdentity();
    await setIdentity(ctx, squadId, 'Changed my mind');
    expect(await ctx.store.gameModels.listAll()).toHaveLength(1);
  });
});

describe('adding principles', () => {
  it('refuses anything before a model exists', async () => {
    expect(
      isErr(
        await addPrinciple(ctx, {
          squadId,
          moment: 'offensive_organisation',
          level: 'macro',
          text: 'x',
        }),
      ),
    ).toBe(true);
  });

  it('adds a macro with no parent', async () => {
    await withIdentity();
    const model = await addMacro();
    expect(model.principles[0]).toMatchObject({ level: 'macro', parentId: null });
  });

  it('refuses a meso with no parent named', async () => {
    await withIdentity();
    const result = await addPrinciple(ctx, {
      squadId,
      moment: 'offensive_organisation',
      level: 'meso',
      text: 'Through the pivot',
    });
    expect(isErr(result)).toBe(true);
  });

  it('refuses a parent that does not exist', async () => {
    await withIdentity();
    const result = await addPrinciple(ctx, {
      squadId,
      moment: 'offensive_organisation',
      level: 'meso',
      text: 'Through the pivot',
      parentId: asPrincipleId(testId('ghost')),
    });
    expect(isErr(result)).toBe(true);
  });

  /**
   * The moment comes from the parent, not the caller. A UI that let a coach add a micro under
   * an in-possession macro and file it under defending would be offering a way to build the
   * incoherence the schema then rejects — better to make it impossible than to report it.
   */
  it('inherits the moment from the parent, ignoring a contradictory one', async () => {
    await withIdentity();
    const macro = (await addMacro()).principles[0]!;

    const model = unwrap(
      await addPrinciple(ctx, {
        squadId,
        moment: 'defensive_organisation',
        level: 'meso',
        text: 'Through the pivot',
        parentId: macro.id,
      }),
    );

    expect(model.principles[1]?.moment).toBe('offensive_organisation');
  });

  it('builds a full chain down to a cue', async () => {
    await withIdentity();
    const macro = (await addMacro()).principles[0]!;
    const meso = unwrap(
      await addPrinciple(ctx, {
        squadId,
        moment: 'offensive_organisation',
        level: 'meso',
        text: 'Through the pivot',
        parentId: macro.id,
      }),
    ).principles[1]!;
    const micro = unwrap(
      await addPrinciple(ctx, {
        squadId,
        moment: 'offensive_organisation',
        level: 'micro',
        text: 'Pivot drops in',
        parentId: meso.id,
      }),
    ).principles[2]!;
    const model = unwrap(
      await addPrinciple(ctx, {
        squadId,
        moment: 'offensive_organisation',
        level: 'sub',
        text: 'Open body shape',
        parentId: micro.id,
      }),
    );

    expect(model.principles.map((p) => p.level)).toEqual(['macro', 'meso', 'micro', 'sub']);
  });

  it('closes a moment’s gap once something is said about it', async () => {
    await withIdentity();
    const model = await addMacro('transition_to_defence', 'Counter-press for six seconds');
    expect(momentsWithoutPrinciples(model)).not.toContain('transition_to_defence');
  });
});

describe('editing and removing', () => {
  it('edits the text and nothing else', async () => {
    await withIdentity();
    const macro = (await addMacro()).principles[0]!;
    const model = unwrap(await editPrinciple(ctx, squadId, macro.id, 'Play out, do not clear'));

    expect(model.principles[0]?.text).toBe('Play out, do not clear');
    expect(model.principles[0]?.level).toBe('macro');
  });

  it('refuses to edit a principle that is not there', async () => {
    await withIdentity();
    expect(isErr(await editPrinciple(ctx, squadId, asPrincipleId(testId('ghost')), 'x'))).toBe(
      true,
    );
  });

  /**
   * Cascading is the only honest option. Leaving the children would orphan them — the leaf off
   * a tree — and the schema would refuse the next write, so the alternative is not "keep the
   * children" but "corrupt the model".
   */
  it('removes a principle and everything beneath it, and says how many', async () => {
    await withIdentity();
    const macro = (await addMacro()).principles[0]!;
    const meso = unwrap(
      await addPrinciple(ctx, {
        squadId,
        moment: 'offensive_organisation',
        level: 'meso',
        text: 'Through the pivot',
        parentId: macro.id,
      }),
    ).principles[1]!;
    unwrap(
      await addPrinciple(ctx, {
        squadId,
        moment: 'offensive_organisation',
        level: 'micro',
        text: 'Pivot drops in',
        parentId: meso.id,
      }),
    );

    const { model, removed } = unwrap(await removePrinciple(ctx, squadId, macro.id));

    expect(removed).toBe(3);
    expect(model.principles).toEqual([]);
  });

  it('removes only the branch asked for', async () => {
    await withIdentity();
    const macro = (await addMacro()).principles[0]!;
    const keep = unwrap(
      await addPrinciple(ctx, {
        squadId,
        moment: 'offensive_organisation',
        level: 'meso',
        text: 'Keep this',
        parentId: macro.id,
      }),
    ).principles[1]!;
    const drop = unwrap(
      await addPrinciple(ctx, {
        squadId,
        moment: 'offensive_organisation',
        level: 'meso',
        text: 'Drop this',
        parentId: macro.id,
      }),
    ).principles[2]!;

    const { model, removed } = unwrap(await removePrinciple(ctx, squadId, drop.id));

    expect(removed).toBe(1);
    expect(childrenOf(model, macro.id).map((p) => p.id)).toEqual([keep.id]);
  });

  it('records notes on the model itself', async () => {
    await withIdentity();
    const model = unwrap(await setNotes(ctx, squadId, 'Reviewed with the staff in August'));
    expect(model.notes).toBe('Reviewed with the staff in August');
  });
});
