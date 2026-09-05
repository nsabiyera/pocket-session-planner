'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  CarriedPill,
  Chip,
  Empty,
  Loading,
  Screen,
  ScreenHead,
  Sheet,
  Stepper,
  formatShortDate,
} from '../../_components/ui';
import { Why } from '../../_components/why';
import { PhaseImageEditor, PhaseImageStrip } from '../../_components/phase-images';
import {
  attachPhaseImage,
  describePhaseImageError,
  detachPhaseImage,
  loadPhaseImages,
} from '@/modules/planning/phase-image-service';
import { MAX_IMAGES_PER_PHASE, type PhaseImage } from '@/domain/phase-image';
import type { SessionId } from '@/domain/ids';
import { showToast } from '../../_components/toast-host';
import { getServiceContext, refresh, useAppState } from '@/modules/app/app-store';
import {
  commitAndStart,
  discardDraft,
  reorderPhases,
  updateDraft,
  updatePhase,
} from '@/modules/planning/planning-service';
import { describeInterventionPlan, resolvePhaseIntervention } from '@/domain/intervention';
import { phaseKindLabel } from '@/domain/methodology';
import {
  type AdjustmentDirection,
  adjustmentPlanLabel,
  MAX_CONSTRAINTS_PER_PHASE,
  type PhaseConstraint,
  STEP_LETTERS,
  stepDescription,
  stepLabel,
  type StepLetter,
  describePracticeArea,
  MAX_ADJUSTMENT_TEXT,
  MAX_ADJUSTMENTS_PER_PHASE,
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE,
  PRACTICE_SPECTRUM,
  spectrumDescription,
  spectrumShortLabel,
} from '@/domain/practice';
import {
  phasesInOrder,
  totalPlannedPhaseMin,
  type Session,
  type SessionPhase,
} from '@/domain/session';
import { shortPlayerName, type Player } from '@/domain/player';
import { isErr } from '@/lib/result';

/**
 * The phase editor, landed on in **accept posture**: the plan is already built and the coach
 * is expected to glance at it and hit `Start session ▸`. Everything editable is one tap
 * deeper, so nobody has to fight a form to get onto the pitch.
 */
export default function PhaseEditorPage() {
  const state = useAppState();
  const router = useRouter();
  const [editing, setEditing] = useState<SessionPhase | null>(null);
  const [busy, setBusy] = useState(false);
  const [imagesById, setImagesById] = useState<ReadonlyMap<string, PhaseImage>>(new Map());

  /*
   * Every drawing in the plan, in one read.
   *
   * One `getMany` across all the phases rather than a read per card: a nine-phase session
   * would otherwise open nine transactions on a screen the coach scrolls through. The key is
   * the joined id list, so this re-runs when a photo is attached or removed and at no other
   * time.
   */
  // `state.activeSession`, not the `session` alias below: hooks run before the guards
  // that narrow it, and a conditional hook is worse than a slightly longer name.
  const allImageIds = (state.activeSession?.phases ?? []).flatMap((phase) => phase.imageIds);
  const imageKey = allImageIds.join(',');

  useEffect(() => {
    if (allImageIds.length === 0) {
      setImagesById(new Map());
      return;
    }
    let cancelled = false;
    void loadPhaseImages(getServiceContext(), allImageIds).then((rows) => {
      if (!cancelled) setImagesById(new Map(rows.map((row) => [row.id, row])));
    });
    return () => {
      cancelled = true;
    };
    // Depends on `imageKey` (the id list) alone — see the note above.
  }, [imageKey]);

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const session = state.activeSession;
  if (!session || session.status === 'in_progress') {
    return (
      <Screen>
        <ScreenHead title="No session in progress" />
        <Empty>Nothing is being planned right now.</Empty>
        <Link href="/plan" className="btn btn--primary btn--block">
          Plan a session
        </Link>
      </Screen>
    );
  }

  const phases = phasesInOrder(session);
  const phaseTotal = totalPlannedPhaseMin(session);
  const mismatch = phaseTotal !== session.plannedDurationMin;

  const start = async () => {
    setBusy(true);
    try {
      const result = await commitAndStart(getServiceContext(), session.id);
      if (isErr(result)) {
        showToast(
          result.error.kind === 'transition'
            ? result.error.error.message
            : 'Could not start the session.',
          { tone: 'stop' },
        );
        return;
      }
      await refresh();
      router.push('/run');
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, delta: number) => {
    const next = [...phases];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    await reorderPhases(
      getServiceContext(),
      session.id,
      next.map((phase) => phase.id),
    );
    await refresh();
  };

  return (
    <Screen>
      <ScreenHead eyebrow="Plan" title={session.objective.text} />

      <div className="card card--sunk">
        <div className="row row--between">
          <span className="card-meta">
            {session.methodology.name} · {formatShortDate(session.scheduledFor)}
          </span>
          <Link href="/plan/intervention" className="btn btn--quiet">
            Intervention
          </Link>
        </div>
        <p>{describeInterventionPlan(session.intervention)}</p>
        {session.objective.sourceActionId ? <CarriedPill /> : null}
      </div>

      {/*
        Challenges cost **zero taps** on the default path: one summary line and a link into
        the detour, exactly like intervention. A session with none says so in a single word.
      */}
      <div className="card card--sunk">
        <div className="row row--between">
          <span className="eyebrow">Player challenges</span>
          <Link href="/plan/challenges" className="btn btn--quiet">
            {session.challenges.length === 0 ? 'Set' : 'Edit'}
          </Link>
        </div>
        <p>{describeChallengePlan(session, state.players)}</p>
      </div>

      <Stepper
        label="Session length"
        value={session.plannedDurationMin}
        min={20}
        max={150}
        onChange={async (value) => {
          await updateDraft(getServiceContext(), session.id, { totalMin: value });
          await refresh();
        }}
      />

      {/* A phase total that does not match is a **warning, not a block** — slack is fine. */}
      {mismatch ? (
        <p className="banner banner--warn">
          Phases add up to {phaseTotal} min, session is {session.plannedDurationMin} min.
        </p>
      ) : null}

      {session.reminders.length > 0 ? (
        <section className="stack">
          <h2>Before you go</h2>
          <ul className="stack stack--tight">
            {session.reminders.map((reminder) => (
              <li key={reminder} className="card card--sunk">
                {reminder}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stack">
        <h2>Phases</h2>
        <ul className="stack stack--tight">
          {phases.map((phase, index) => (
            <li key={phase.id} className="card">
              <div className="row row--between">
                <span className="card-title">{phase.title}</span>
                <span className="tabular card-meta">{phase.plannedDurationMin} min</span>
              </div>
              <span className="card-meta">
                {phaseKindLabel(phase.kind)} ·{' '}
                {describeInterventionPlan(resolvePhaseIntervention(session, phase))}
              </span>

              {phase.coachingPoints.length > 0 ? (
                <ul className="stack stack--tight">
                  {phase.coachingPoints.map((point) => (
                    <li key={point.id} className="row">
                      <span>{point.text}</span>
                      {point.source === 'carry_forward' ? <CarriedPill /> : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {phase.focusPlayerIds.length > 0 ? (
                <span className="row row--wrap">
                  {phase.focusPlayerIds.map((playerId) => {
                    const player = state.players.find((candidate) => candidate.id === playerId);
                    return player ? (
                      <span key={playerId} className="pill">
                        {shortPlayerName(player, state.players)}
                      </span>
                    ) : null;
                  })}
                </span>
              ) : null}

              {/*
                The drawing, on the card rather than only behind Edit. A coach checking the
                plan wants to see the practice, not read a summary of it — and tapping opens
                the same full-screen view Do mode uses, so the gesture is learned once.
              */}
              <PhaseImageStrip
                heading={null}
                images={phase.imageIds
                  .map((id) => imagesById.get(id))
                  .filter((image): image is PhaseImage => image !== undefined)}
              />

              <div className="row">
                <button type="button" className="btn btn--quiet" onClick={() => setEditing(phase)}>
                  Edit
                </button>
                <span className="spacer" />
                {/* Reorder is always paired with buttons — never drag-only (WCAG 2.5.7). */}
                <button
                  type="button"
                  className="btn btn--quiet"
                  aria-label={`Move ${phase.title} earlier`}
                  disabled={index === 0}
                  onClick={() => void move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  aria-label={`Move ${phase.title} later`}
                  disabled={index === phases.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        className="btn btn--primary btn--xl btn--block"
        disabled={busy}
        onClick={start}
      >
        Start session ▸
      </button>

      {/* Destructive action, far from the primary one and recoverable by re-planning. */}
      <button
        type="button"
        className="btn btn--danger btn--block"
        onClick={async () => {
          await discardDraft(getServiceContext(), session.squadId);
          await refresh();
          showToast('Draft discarded');
          router.push('/');
        }}
      >
        Discard this plan
      </button>

      <PhaseSheet
        phase={editing}
        sessionId={session.id}
        rosterSize={state.players.length}
        onClose={() => setEditing(null)}
        onSave={async (next) => {
          await updatePhase(getServiceContext(), session.id, next);
          await refresh();
          setEditing(null);
        }}
      />
    </Screen>
  );
}

/**
 * *"Kai · three forward passes, and 2 others"* — the one line the plan editor shows.
 *
 * Names the first player rather than counting them, because "3 challenges" tells the coach
 * nothing they can check and a name tells them whether they set the one they meant to.
 */
function describeChallengePlan(session: Session, roster: readonly Player[]): string {
  const [first] = session.challenges;
  if (!first) return 'None set.';

  const player = roster.find((candidate) => candidate.id === first.playerId);
  const who = player ? shortPlayerName(player, roster) : 'Someone';
  const rest = session.challenges.length - 1;

  const head = `${who} · ${first.text}`;
  return rest === 0 ? `${head}.` : `${head}, and ${rest} other${rest === 1 ? '' : 's'}.`;
}

function PhaseSheet({
  phase,
  sessionId,
  rosterSize,
  onClose,
  onSave,
}: {
  phase: SessionPhase | null;
  sessionId: SessionId;
  /** Seeds the group-size stepper. See the note on the stepper itself. */
  rosterSize: number;
  onClose: () => void;
  onSave: (phase: SessionPhase) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SessionPhase | null>(phase);
  const [images, setImages] = useState<PhaseImage[]>([]);
  const [imageBusy, setImageBusy] = useState(false);

  /**
   * Images are written straight through, not held in `draft`.
   *
   * Everything else in this sheet is saved on `Save phase`, but a photograph is not a form
   * field: the coach has already taken it, holding megabytes in React state until they
   * remember to save would be a good way to lose one, and the attach is a two-store
   * transaction that has to own its own consistency anyway.
   */
  useEffect(() => {
    if (!phase) return;
    let cancelled = false;
    void loadPhaseImages(getServiceContext(), phase.imageIds).then((rows) => {
      if (!cancelled) setImages(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [phase?.id, phase?.imageIds, phase]);

  const addImage = async (file: File) => {
    if (!phase) return;
    setImageBusy(true);
    try {
      const result = await attachPhaseImage(getServiceContext(), sessionId, phase.id, file);
      if (isErr(result)) {
        showToast(describePhaseImageError(result.error), { tone: 'stop' });
        return;
      }
      setImages((current) => [...current, result.value]);
      await refresh();
    } finally {
      setImageBusy(false);
    }
  };

  const removeImage = async (image: PhaseImage) => {
    if (!phase) return;
    setImageBusy(true);
    try {
      await detachPhaseImage(getServiceContext(), sessionId, phase.id, image.id);
      setImages((current) => current.filter((candidate) => candidate.id !== image.id));
      await refresh();
    } finally {
      setImageBusy(false);
    }
  };

  // Re-seed when a different phase is opened.
  if (phase && draft?.id !== phase.id) setDraft(phase);

  if (!draft) {
    return (
      <Sheet open={false} title="Edit phase" onClose={onClose}>
        {null}
      </Sheet>
    );
  }

  return (
    <Sheet open={phase !== null} title="Edit phase" onClose={onClose}>
      <div className="field">
        <label htmlFor="phase-title">Title</label>
        <input
          id="phase-title"
          type="text"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </div>

      <Stepper
        label="Length"
        value={draft.plannedDurationMin}
        min={1}
        max={90}
        onChange={(value) => setDraft({ ...draft, plannedDurationMin: value })}
      />

      {/*
        **The practice spectrum.** One tap, already answered by the methodology, and tapping
        the pressed chip again clears it back to "not said" — the same take-it-back gesture
        the challenge verdicts use. A wrapping chip row rather than `Segmented`, because
        "Unopposed with interference" will not fit four-across on a 375px screen.
      */}
      <div className="field">
        <label id="phase-spectrum">How game-like is this?</label>
        <div className="row row--wrap" role="group" aria-labelledby="phase-spectrum">
          {PRACTICE_SPECTRUM.map((spectrum) => (
            <Chip
              key={spectrum}
              label={spectrumShortLabel(spectrum)}
              pressed={draft.spectrum === spectrum}
              onClick={() =>
                setDraft({ ...draft, spectrum: draft.spectrum === spectrum ? null : spectrum })
              }
            />
          ))}
        </div>
        <p className="card-meta">
          {draft.spectrum ? spectrumDescription(draft.spectrum) : 'Not set.'}
          <Why id="report:practice-spectrum" />
        </p>
      </div>

      {/*
        **Everything the methodology already answered, behind one disclosure.**

        The default path stays exactly as long as it was — a coach who never opens this plans
        a session in the same taps as before and gets the preset values. That matters more
        than it sounds: by phase 6 this sheet had grown to 2.7 screens of scrolling before
        `Save phase` came into reach, and the four blocks in here are the ones a coach edits
        least and the presets fill best.

        Space and numbers stay `null` when untouched, which every report reads as *"the coach
        did not say"* rather than as zero.
      */}
      <details className="card card--sunk">
        <summary>Practice detail</summary>

        {draft.area ? (
          <>
            <Stepper
              label="Grid length"
              value={draft.area.lengthM}
              step={5}
              min={3}
              max={120}
              suffix="m"
              onChange={(lengthM) => setDraft({ ...draft, area: { ...draft.area!, lengthM } })}
            />
            <Stepper
              label="Grid width"
              value={draft.area.widthM}
              step={5}
              min={3}
              max={90}
              suffix="m"
              onChange={(widthM) => setDraft({ ...draft, area: { ...draft.area!, widthM } })}
            />
          </>
        ) : (
          <button
            type="button"
            className="btn btn--block"
            onClick={() => setDraft({ ...draft, area: { lengthM: 20, widthM: 20 } })}
          >
            Set the area
          </button>
        )}

        {draft.groupSize === null ? (
          <button
            type="button"
            className="btn btn--block"
            /*
             * Seeded from the roster, not derived from it. `focusPlayerIds` is the watch
             * list — a subset of the session's focus players, enforced in `session.ts` — so
             * it can never answer "how many are in this practice". The roster is merely the
             * closest number the app already knows, and the coach steps down from it.
             */
            onClick={() =>
              setDraft({
                ...draft,
                groupSize: Math.min(MAX_GROUP_SIZE, Math.max(MIN_GROUP_SIZE, rosterSize || 10)),
              })
            }
          >
            Set the group size
          </button>
        ) : (
          <Stepper
            label="Players in this practice"
            value={draft.groupSize}
            step={1}
            min={MIN_GROUP_SIZE}
            max={MAX_GROUP_SIZE}
            suffix={draft.groupSize === 1 ? 'player' : 'players'}
            onChange={(groupSize) => setDraft({ ...draft, groupSize })}
          />
        )}

        {/* The derived line. Bare m² per player, no adjective — see `relativePlayingArea`. */}
        <p className="card-meta">
          {describePracticeArea(draft.area, draft.groupSize) ?? 'Not set.'}
          {draft.area ? <Why id="report:relative-playing-area" /> : null}
        </p>

        {draft.area || draft.groupSize !== null ? (
          <button
            type="button"
            className="btn btn--quiet btn--block"
            onClick={() => setDraft({ ...draft, area: null, groupSize: null })}
          >
            Clear space and numbers
          </button>
        ) : null}

        {/*
        **Progressions and regressions.** The Challenge Point Framework, already answered by
        the methodology — Play-Practice-Play arrives with three of each — so this is a list
        the coach edits rather than a form they fill in. Do mode puts these under their thumb.
      */}
        {/*
        The FA's fourth area, as one optional tap. Records that a choice was *offered*, which
        is a fact; it does not claim anything about how the session felt to play in. See the
        note in `domain/engagement.ts` on why the word "autonomy" never reaches the screen.
      */}
        <div className="field">
          <label id="phase-choice">Did the players choose something?</label>
          <div className="row" role="group" aria-labelledby="phase-choice">
            <Chip
              label={draft.playerChoice ? 'Yes, they chose' : 'No'}
              pressed={draft.playerChoice}
              onClick={() => setDraft({ ...draft, playerChoice: !draft.playerChoice })}
            />
          </div>
          <p className="card-meta">
            Which practice, which constraint, which target - anything they picked themselves.
          </p>
        </div>

        {/*
        **STEP.** The letter is a tap and the text is theirs — the only split that survives
        a phone in the rain. Placed above the progressions because a constraint is the state of
        the practice and a progression is a change to it.
      */}
        <ConstraintList
          items={draft.constraints}
          onChange={(constraints) => setDraft({ ...draft, constraints })}
        />

        <AdjustmentList
          direction="progressed"
          items={draft.progressions}
          onChange={(progressions) => setDraft({ ...draft, progressions })}
        />
        <AdjustmentList
          direction="regressed"
          items={draft.regressions}
          onChange={(regressions) => setDraft({ ...draft, regressions })}
        />
      </details>

      {/*
        Directly under `organisation`, because the picture and the prose are the same thought:
        the box is the summary a schema can read, and this is the plan the coach actually drew.
      */}
      <PhaseImageEditor
        images={images}
        busy={imageBusy}
        full={images.length >= MAX_IMAGES_PER_PHASE}
        onAdd={(file) => void addImage(file)}
        onRemove={(image) => void removeImage(image)}
      />

      <div className="field">
        <label htmlFor="phase-organisation">Organisation</label>
        <textarea
          id="phase-organisation"
          value={draft.organisation}
          placeholder="4v2 rondo, two neutrals, keeper joins in"
          onChange={(event) => setDraft({ ...draft, organisation: event.target.value })}
        />
      </div>

      <button
        type="button"
        className="btn btn--primary btn--lg btn--block"
        onClick={() => void onSave(draft)}
      >
        Save phase
      </button>
    </Sheet>
  );
}

/**
 * A capped list of one-line texts, for progressions and regressions.
 *
 * Rows rather than a textarea: each one is read aloud on the pitch as a single instruction,
 * and a blob of newline-separated prose would have to be re-split every time Do mode wanted
 * to put one under a thumb. Blank rows are dropped on the way out, so clearing the text *is*
 * the delete gesture and there is no separate destructive button to mis-tap.
 */
function AdjustmentList({
  direction,
  items,
  onChange,
}: {
  direction: AdjustmentDirection;
  items: readonly string[];
  onChange: (items: string[]) => void;
}) {
  const label = adjustmentPlanLabel(direction);

  const setAt = (index: number, text: string) =>
    onChange(
      items
        .map((item, i) => (i === index ? text : item))
        .filter((item, i) => i === index || item.trim().length > 0),
    );

  return (
    <div className="field">
      <label>{label}</label>
      <ul className="stack stack--tight">
        {items.map((item, index) => (
          // Index keys are correct here: the rows have no identity of their own, and the
          // list is only ever edited in place or appended to.
          <li key={index}>
            <input
              type="text"
              value={item}
              maxLength={MAX_ADJUSTMENT_TEXT}
              aria-label={`${label} ${index + 1}`}
              placeholder={direction === 'progressed' ? 'Add a defender' : 'Take a defender out'}
              onChange={(event) => setAt(index, event.target.value)}
            />
          </li>
        ))}
      </ul>
      {items.length < MAX_ADJUSTMENTS_PER_PHASE ? (
        <button type="button" className="btn btn--quiet" onClick={() => onChange([...items, ''])}>
          Add {label.toLowerCase().slice(0, -1)}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The STEP list: four letter chips and a line of the coach's own words per row.
 *
 * The letter is never inferred from the text. Keyword-matching free prose is exactly what
 * ADR 0004 refused to do to `organisation`, and a silently wrong letter in a season report is
 * worse than no letter — so the coach taps it, once, and the app keeps quiet otherwise.
 *
 * Clearing the text deletes the row on save, matching `AdjustmentList`: one gesture, no
 * separate destructive button to mis-tap with gloves on.
 */
function ConstraintList({
  items,
  onChange,
}: {
  items: readonly PhaseConstraint[];
  onChange: (items: PhaseConstraint[]) => void;
}) {
  const setAt = (index: number, patch: Partial<PhaseConstraint>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <div className="field">
      <label>Constraints</label>
      <ul className="stack stack--tight">
        {items.map((constraint, index) => (
          // Index keys: rows have no identity of their own and are only edited in place.
          <li key={index} className="stack stack--tight">
            <div
              className="row row--wrap"
              role="group"
              aria-label={`Constraint ${index + 1} letter`}
            >
              {STEP_LETTERS.map((letter) => (
                <Chip
                  key={letter}
                  label={stepLabel(letter)}
                  pressed={constraint.letter === letter}
                  onClick={() => setAt(index, { letter })}
                />
              ))}
            </div>
            <input
              type="text"
              value={constraint.text}
              maxLength={120}
              aria-label={`Constraint ${index + 1}`}
              placeholder="Two touches maximum"
              onChange={(event) => setAt(index, { text: event.target.value })}
            />
            <p className="card-meta">{stepDescription(constraint.letter)}</p>
          </li>
        ))}
      </ul>
      {items.length < MAX_CONSTRAINTS_PER_PHASE ? (
        <button
          type="button"
          className="btn btn--quiet"
          // Task is the letter coaches reach for most, so it is the cheapest default to be
          // wrong about - and the chips are right there.
          onClick={() => onChange([...items, { letter: 'task' as StepLetter, text: '' }])}
        >
          Add constraint
        </button>
      ) : null}
    </div>
  );
}
