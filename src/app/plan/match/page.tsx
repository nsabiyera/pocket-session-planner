'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Loading, Screen, ScreenHead, Segmented, Stepper } from '../../_components/ui';
import { showToast } from '../../_components/toast-host';
import { getServiceContext, refresh, useAppState } from '@/modules/app/app-store';
import { startMatchDraft } from '@/modules/planning/planning-service';
import { DEFAULT_PERIOD_MIN } from '@/domain/session/build-match';
import {
  FIXTURE_TYPE_LABELS,
  MATCH_FORMATS,
  MATCH_UNIT_LABELS,
  MATCH_VENUE_LABELS,
  describeShape,
  matchFormatOf,
  periodCountLabel,
  shapesFor,
  unitsOf,
  type FixtureType,
  type MatchFormat,
  type MatchUnit,
  type MatchVenue,
  type PeriodCount,
} from '@/domain/match-day';
import { ageBandOf } from '@/domain/practice/match';
import { OBJECTIVE_LIBRARY } from '@/domain/objectives';
import { isErr } from '@/lib/result';

/**
 * Match day, planned.
 *
 * Same bar as the training composer: everything that can be answered without a tap already
 * is. The format comes from the squad's age group, the shape from that format, the periods
 * default to halves, and the objective grid is the same fourteen chips — because the thing
 * you worked on on Tuesday is nearly always the thing you want to see on Saturday.
 *
 * **Only the opponent needs typing.** There is no way around that one: an app cannot know who
 * you are playing, and a list of local clubs would be a database this app has no business
 * carrying.
 */
export default function PlanMatchPage() {
  const state = useAppState();
  const router = useRouter();

  const [opponent, setOpponent] = useState('');
  const [venue, setVenue] = useState<MatchVenue>('home');
  const [fixtureType, setFixtureType] = useState<FixtureType>('league');
  const [formatChoice, setFormatChoice] = useState<MatchFormat | null>(null);
  const [shapeName, setShapeName] = useState<string | null>(null);
  const [periodCount, setPeriodCount] = useState<PeriodCount>(2);
  const [periodMin, setPeriodMin] = useState<number | null>(null);
  const [objectiveId, setObjectiveId] = useState<string | null>(null);
  const [customObjective, setCustomObjective] = useState('');
  const [unitTexts, setUnitTexts] = useState<Partial<Record<MatchUnit, string>>>({});
  const [busy, setBusy] = useState(false);

  // The squad's age group already answers the format — `practice/match.ts` has had the FA's
  // table since the practice-design work. A coach in a league that plays differently can
  // still override it, which is why this is a default and not a lock.
  const derivedFormat = useMemo(() => {
    const band = ageBandOf(state.squad?.ageGroup);
    return band ? matchFormatOf(band) : null;
  }, [state.squad?.ageGroup]);

  const format = formatChoice ?? derivedFormat ?? '7v7';
  const shapes = shapesFor(format);
  const chosenShape = shapes.find((shape) => shape.name === shapeName) ?? null;
  const chosenPeriodMin = periodMin ?? DEFAULT_PERIOD_MIN[periodCount];

  const objective = OBJECTIVE_LIBRARY.find((candidate) => candidate.id === objectiveId);
  const objectiveText = objective?.text ?? customObjective.trim();

  if (state.status !== 'ready')
    return (
      <Screen>
        <Loading />
      </Screen>
    );

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
  const canBuild = opponent.trim().length > 0 && objectiveText.length > 0 && !busy;

  const build = async () => {
    if (!canBuild) return;
    setBusy(true);
    try {
      const created = await startMatchDraft(getServiceContext(), {
        squadId: squad.id,
        objectiveText,
        ...(objective ? { objectiveTemplateId: objective.id } : {}),
        periodMin: chosenPeriodMin,
        match: {
          opponent: opponent.trim(),
          venue,
          fixtureType,
          format,
          shapeName: chosenShape?.name ?? null,
          periodCount,
          unitObjectives: unitObjectivesFrom(unitTexts, chosenShape, format),
        },
      });

      if (isErr(created)) {
        showToast('Could not build that match.', { tone: 'stop' });
        return;
      }

      await refresh();
      router.push('/plan/phases');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHead eyebrow="Match day" title={squad.name} />

      {/* The one thing that has to be typed, so it goes first and nothing hides it. */}
      <section className="stack">
        <div className="field">
          <label htmlFor="opponent">Who are you playing?</label>
          <input
            id="opponent"
            type="text"
            value={opponent}
            maxLength={60}
            placeholder="Eastfield Rovers"
            onChange={(event) => setOpponent(event.target.value)}
          />
        </div>

        <Segmented<MatchVenue>
          legend="Where"
          value={venue}
          onChange={setVenue}
          options={[
            { value: 'home', label: MATCH_VENUE_LABELS.home },
            { value: 'away', label: MATCH_VENUE_LABELS.away },
            { value: 'neutral', label: MATCH_VENUE_LABELS.neutral },
          ]}
        />

        <Segmented<FixtureType>
          legend="What kind of game"
          value={fixtureType}
          onChange={setFixtureType}
          options={(Object.keys(FIXTURE_TYPE_LABELS) as FixtureType[]).map((value) => ({
            value,
            label: FIXTURE_TYPE_LABELS[value],
          }))}
        />
      </section>

      <section className="stack">
        <details className="fold" open>
          <summary>
            <h2>What are you working on?</h2>
            {objectiveText ? <span className="fold-value">{objectiveText}</span> : null}
          </summary>
          <div className="stack fold-body">
            {/* The same library as training, on purpose: Saturday is where Tuesday shows up. */}
            <div className="chip-grid">
              {OBJECTIVE_LIBRARY.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="chip"
                  aria-pressed={candidate.id === objectiveId}
                  onClick={() => {
                    setObjectiveId(candidate.id);
                    setCustomObjective('');
                  }}
                >
                  {candidate.text}
                </button>
              ))}
            </div>
            <details className="card card--sunk">
              <summary>Something else</summary>
              <div className="field">
                <label htmlFor="custom-objective">Team objective</label>
                <input
                  id="custom-objective"
                  type="text"
                  value={customObjective}
                  placeholder="Stay compact when we lose it"
                  onChange={(event) => {
                    setCustomObjective(event.target.value);
                    setObjectiveId(null);
                  }}
                />
              </div>
            </details>
          </div>
        </details>
      </section>

      <section className="stack">
        <h2>The shape</h2>

        <Segmented<MatchFormat>
          legend="Format"
          value={format}
          onChange={(value) => {
            setFormatChoice(value);
            // A shape from the old format would field the wrong number of players.
            setShapeName(null);
          }}
          options={MATCH_FORMATS.map((value) => ({ value, label: value }))}
        />
        {derivedFormat && formatChoice === null ? (
          <p className="card-meta">
            From your squad&apos;s age group. Change it if your league plays differently.
          </p>
        ) : null}

        <div className="chip-grid">
          {shapes.map((shape) => (
            <button
              key={shape.name}
              type="button"
              className="chip"
              aria-pressed={shape.name === shapeName}
              onClick={() => setShapeName(shape.name === shapeName ? null : shape.name)}
            >
              {shape.name}
            </button>
          ))}
        </div>
        {chosenShape ? <p className="card-meta">{describeShape(chosenShape, format)}</p> : null}
      </section>

      {/*
        Unit objectives, and only for the units this shape actually fields. A 2-1 has no
        midfield, so offering a midfield objective would be asking a coach to brief nobody.
      */}
      {chosenShape ? (
        <section className="stack">
          <details className="card card--sunk">
            <summary>A word for each unit</summary>
            <div className="stack">
              <p className="card-meta">
                The level you actually talk in at half time. Leave any of them blank.
              </p>
              {unitsOf(chosenShape, format).map((unit) => (
                <div className="field" key={unit}>
                  <label htmlFor={`unit-${unit}`}>{MATCH_UNIT_LABELS[unit]}</label>
                  <input
                    id={`unit-${unit}`}
                    type="text"
                    maxLength={140}
                    value={unitTexts[unit] ?? ''}
                    placeholder={UNIT_PLACEHOLDERS[unit]}
                    onChange={(event) =>
                      setUnitTexts((current) => ({ ...current, [unit]: event.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          </details>
        </section>
      ) : null}

      <section className="stack">
        <h2>How long</h2>
        <Segmented<'2' | '4'>
          legend="Periods"
          value={periodCount === 2 ? '2' : '4'}
          onChange={(value) => {
            const next: PeriodCount = value === '2' ? 2 : 4;
            setPeriodCount(next);
            setPeriodMin(null);
          }}
          options={[
            { value: '2', label: periodCountLabel(2) },
            { value: '4', label: periodCountLabel(4) },
          ]}
        />
        <Stepper
          label={periodCount === 2 ? 'Minutes per half' : 'Minutes per quarter'}
          value={chosenPeriodMin}
          min={1}
          max={45}
          step={5}
          onChange={setPeriodMin}
        />
      </section>

      <button
        type="button"
        className="btn btn--primary btn--xl btn--block"
        disabled={!canBuild}
        onClick={build}
      >
        Build the match
      </button>

      {opponent.trim().length === 0 ? (
        <p className="card-meta">Add who you are playing to build it.</p>
      ) : null}
    </Screen>
  );
}

const UNIT_PLACEHOLDERS: Record<MatchUnit, string> = {
  goalkeeper: 'Start the play, do not just clear it',
  defence: 'First pass forward, not sideways',
  midfield: 'Screen in front of the back three',
  attack: 'Press their first pass out',
};

/**
 * Only units the shape fields, and only ones the coach actually wrote in.
 *
 * Trimmed here rather than in the schema because an empty string is a coach who opened the
 * disclosure and changed their mind, not an objective of no words.
 */
function unitObjectivesFrom(
  texts: Partial<Record<MatchUnit, string>>,
  shape: { name: string; lines: readonly number[] } | null,
  format: MatchFormat,
): { unit: MatchUnit; text: string }[] {
  if (!shape) return [];
  return unitsOf(shape, format)
    .map((unit) => ({ unit, text: (texts[unit] ?? '').trim() }))
    .filter((objective) => objective.text.length > 0);
}
