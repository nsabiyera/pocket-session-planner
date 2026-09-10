'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Empty, Loading, Screen, ScreenHead, formatShortDate } from '../../_components/ui';
import { showToast } from '../../_components/toast-host';
import {
  getServiceContext,
  periodizationEnabled,
  refresh,
  useAppState,
} from '@/modules/app/app-store';
import { addFixtures, listFixtures } from '@/modules/planning/planning-service';
import {
  FIXTURE_LIST_EXAMPLE,
  describeParsedFixture,
  parseFixtureLines,
  type FixtureParse,
} from '@/domain/fixture-list';
import { describeFixture } from '@/domain/match-day';
import { isErr } from '@/lib/result';
import type { Session } from '@/domain/session';

/**
 * The fixture list.
 *
 * The gap the tactical periodization work left, and a structural one rather than a missing
 * screen: `startMatchDraft` replaces the squad's single draft (ADR 0003), so a coach could hold
 * exactly one upcoming match — while `/plan/week` and `/plan/prepare` both assume a run of them.
 *
 * Fixtures are committed straight to `planned`, where sessions accumulate freely, leaving the
 * draft slot for the session a coach is actually composing.
 *
 * **Paste, then confirm.** The parse is shown before anything is written, the same two-step
 * shape as import: a coach pasting a season deserves to see what the app read, and to be told
 * plainly which lines it could not.
 */
export default function FixturesPage() {
  const state = useAppState();
  const [fixtures, setFixtures] = useState<Session[] | null>(null);
  const [text, setText] = useState('');
  const [parse, setParse] = useState<FixtureParse | null>(null);
  const [busy, setBusy] = useState(false);

  const squadId = state.squad?.id;

  const reload = useCallback(async () => {
    if (!squadId) return;
    setFixtures(await listFixtures(getServiceContext(), squadId));
  }, [squadId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (state.status !== 'ready' || fixtures === null) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  if (!state.squad) {
    return (
      <Screen>
        <ScreenHead title="No squad yet" />
        <Link href="/" className="btn btn--primary btn--block">
          Create a squad first
        </Link>
      </Screen>
    );
  }

  const squad = state.squad;
  const nowIso = new Date().toISOString();
  const upcoming = fixtures.filter((fixture) => fixture.scheduledFor >= nowIso);
  const played = fixtures.filter((fixture) => fixture.scheduledFor < nowIso).reverse();

  const add = async () => {
    if (parse === null || parse.fixtures.length === 0 || busy) return;
    setBusy(true);
    try {
      const result = await addFixtures(getServiceContext(), squad.id, parse.fixtures);
      if (isErr(result)) {
        showToast('Could not add those fixtures.', { tone: 'stop' });
        return;
      }
      setText('');
      setParse(null);
      await refresh();
      await reload();
      showToast(`${result.value.length} fixture(s) added`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHead eyebrow="Fixtures" title={squad.name} />

      <section className="stack">
        <div className="field">
          <label htmlFor="fixture-list">Paste your fixtures, one per line</label>
          <textarea
            id="fixture-list"
            value={text}
            rows={6}
            placeholder={FIXTURE_LIST_EXAMPLE}
            onChange={(event) => {
              setText(event.target.value);
              setParse(null);
            }}
          />
        </div>
        <p className="card-meta">
          Date first, then <code>H</code>, <code>A</code> or <code>N</code>, then who you are
          playing. The venue is optional and defaults to home; a time is optional too.
        </p>

        <button
          type="button"
          className="btn btn--block"
          disabled={text.trim() === ''}
          onClick={() => setParse(parseFixtureLines(text))}
        >
          Read the list
        </button>

        {/* Shown before anything is written, the same two-step shape as import. */}
        {parse === null ? null : (
          <div className="card">
            <span className="card-title">
              {parse.fixtures.length} fixture{parse.fixtures.length === 1 ? '' : 's'} read
            </span>
            <ul className="stack stack--tight">
              {parse.fixtures.map((fixture) => (
                <li className="card-meta" key={`${fixture.kickOffAt}-${fixture.opponent}`}>
                  {describeParsedFixture(fixture)}
                </li>
              ))}
            </ul>

            {parse.rejected.length > 0 ? (
              <>
                <p className="banner banner--warn">
                  {parse.rejected.length} line{parse.rejected.length === 1 ? '' : 's'} could not be
                  read. Nothing is added for these.
                </p>
                <ul className="stack stack--tight">
                  {parse.rejected.map((entry) => (
                    <li className="card-meta" key={entry.line}>
                      <strong>{entry.line}</strong> — {entry.reason}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {parse.fixtures.length > 0 ? (
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={busy}
                onClick={add}
              >
                Add {parse.fixtures.length} fixture{parse.fixtures.length === 1 ? '' : 's'}
              </button>
            ) : null}
          </div>
        )}
      </section>

      <section className="stack">
        <h2>Coming up</h2>
        {upcoming.length === 0 ? (
          <Empty>
            {periodizationEnabled(state)
              ? 'No fixtures ahead. The week and the match brief both work from this list, so it is worth putting the season in once.'
              : 'No fixtures ahead. Put the season in once and every match day starts from a fixture rather than from a blank screen.'}
          </Empty>
        ) : (
          upcoming.map((fixture) => <FixtureRow key={fixture.id} fixture={fixture} />)
        )}
      </section>

      {played.length > 0 ? (
        <section className="stack">
          <h2>Played</h2>
          {played.slice(0, 10).map((fixture) => (
            <FixtureRow key={fixture.id} fixture={fixture} />
          ))}
        </section>
      ) : null}

      {/*
        The two periodization screens this list feeds (ADR 0008). The fixture list itself is
        not behind the flag: a run of dated matches is useful to any coach who plans match
        days, and it is the only way to commit more than one fixture at a time.
      */}
      {periodizationEnabled(state) ? (
        <div className="row row--wrap">
          <Link href="/plan/week" className="btn">
            The week
          </Link>
          <Link href="/plan/prepare" className="btn">
            Match brief
          </Link>
        </div>
      ) : null}

      <details className="card card--sunk">
        <summary>What a fixture starts as</summary>
        <p className="card-meta">
          A fixture is a planned match with a date, an opponent and your age group&apos;s format. It
          has <strong>no shape and no team objective yet</strong> — in July you do not know what
          March&apos;s game is about, so its title is just the fixture and the app counts it as
          unlinked until you write the brief.
        </p>
        <p className="card-meta">
          Fill the rest in the week of the game: the shape on{' '}
          <Link href="/plan/match">Match day</Link>
          {periodizationEnabled(state) ? (
            <>
              , the brief on <Link href="/plan/prepare">Match brief</Link>.
            </>
          ) : (
            '.'
          )}
        </p>
      </details>
    </Screen>
  );
}

function FixtureRow({ fixture }: { fixture: Session }) {
  if (!fixture.match) return null;

  return (
    <Link href={`/sessions/detail/?s=${fixture.id}`} className="card card--link">
      <div className="row row--between">
        <span className="card-title">{describeFixture(fixture.match)}</span>
        <span className="card-meta">{formatShortDate(fixture.scheduledFor)}</span>
      </div>
      <span className="row row--wrap">
        <span className="pill pill--match">{fixture.match.format}</span>
        {fixture.match.shapeName === null ? (
          <span className="pill">No shape yet</span>
        ) : (
          <span className="pill">{fixture.match.shapeName}</span>
        )}
        {fixture.match.unitObjectives.length > 0 ? (
          <span className="pill">
            {fixture.match.unitObjectives.length} unit
            {fixture.match.unitObjectives.length === 1 ? '' : 's'} briefed
          </span>
        ) : null}
      </span>
    </Link>
  );
}
