import {
  EFFORT_QUALITY_LABELS,
  isAcquisitive,
  repeatedQualities,
  type EffortQuality,
  type Morphocycle,
} from '../morphocycle';
import type { PrincipleId } from '../ids';
import {
  MOMENT_LABELS,
  levelDepth,
  type GameModel,
  type Moment,
  type Principle,
  type PrincipleLevel,
} from '../game-model';

/**
 * Did the week contain the game model?
 *
 * The report Phase 5 exists for, and the only part of this feature that can **falsify** a
 * coach's own plan across a week rather than merely display it.
 *
 * **What it deliberately does not flag.** The roadmap originally proposed reporting "the same
 * moment worked three times" as a fault. That is wrong, and encoding it would have marked good
 * practice as a fault: in tactical periodization a morphocycle **has a theme**, and working one
 * macro principle across the week at descending levels is the normal shape of an acquisition
 * week, not a failure of alternation. Horizontal alternation is a claim about the *sub-dynamics
 * of effort* — tension, duration, velocity — and not about the moments.
 *
 * So the findings here are only the ones the sources support:
 *
 * - an **effort quality worked on consecutive days**, which alternation genuinely speaks to;
 * - **sessions naming no principle**, where the week simply did not refer to the model — a fact
 *   about the record, not a judgement about the coaching;
 * - **how many distinct macro principles** the week touched, reported and not judged, because a
 *   week spanning four unrelated macros is a coherence question the app can raise and is in no
 *   position to answer.
 */

export interface WeekDay {
  readonly label: string;
  readonly title: string;
  readonly scheduledFor: string;
  readonly effortQuality: EffortQuality | null;
  /** Null when the session named no principle, or one the model no longer has. */
  readonly principle: Principle | null;
  readonly moment: Moment | null;
  readonly level: PrincipleLevel | null;
}

export type WeekFindingKind =
  'quality_repeated' | 'sessions_unlinked' | 'macro_spread' | 'no_acquisitive_day';

export interface WeekFinding {
  readonly kind: WeekFindingKind;
  readonly text: string;
}

export interface WeekReview {
  readonly days: readonly WeekDay[];
  readonly findings: readonly WeekFinding[];
  /** Sessions naming a principle the model still has, over sessions in the week. */
  readonly linked: number;
  readonly total: number;
  /** Distinct macro principles the week's work rolled up to. */
  readonly macroPrinciples: readonly Principle[];
}

/** Below two sessions there is no week to review, only a session. */
export const MIN_SESSIONS_FOR_WEEK_REVIEW = 2;

export function reviewWeek(
  cycle: Morphocycle,
  model: GameModel | null,
  principleIdOf: (sessionId: string) => PrincipleId | null,
): WeekReview {
  const byId = new Map((model?.principles ?? []).map((p) => [p.id as string, p]));

  const days: WeekDay[] = cycle.days.map((day) => {
    const id = principleIdOf(day.session.id);
    const principle = id === null ? null : (byId.get(id) ?? null);
    return {
      label: day.label,
      title: day.session.title,
      scheduledFor: day.session.scheduledFor,
      effortQuality: day.session.effortQuality,
      principle,
      moment: principle?.moment ?? null,
      level: principle?.level ?? null,
    };
  });

  const linked = days.filter((day) => day.principle !== null).length;
  const macros = macroRootsOf(days, byId);

  return {
    days,
    findings: findingsFor(cycle, days, linked, macros),
    linked,
    total: days.length,
    macroPrinciples: macros,
  };
}

/**
 * The macro each day's principle rolls up to.
 *
 * Walks the tree upward rather than reading the day's own level, because a week working three
 * sub-principles of one macro is **one** theme and should report as one — which is the whole
 * reason `macro_spread` counts roots instead of principles.
 */
function macroRootsOf(days: readonly WeekDay[], byId: ReadonlyMap<string, Principle>): Principle[] {
  const roots = new Map<string, Principle>();

  for (const day of days) {
    let current = day.principle;
    // At most four levels, so this terminates; the guard is against a cycle an import could
    // in principle carry, since the schema cannot check a parent chain for loops.
    let hops = 0;
    while (current !== null && current.parentId !== null && hops < 8) {
      current = byId.get(current.parentId) ?? null;
      hops += 1;
    }
    if (current !== null && levelDepth(current.level) === 0) roots.set(current.id, current);
  }

  return [...roots.values()];
}

function findingsFor(
  cycle: Morphocycle,
  days: readonly WeekDay[],
  linked: number,
  macros: readonly Principle[],
): WeekFinding[] {
  const findings: WeekFinding[] = [];
  if (days.length < MIN_SESSIONS_FOR_WEEK_REVIEW) return findings;

  // Alternation, and the only finding here the sources genuinely support.
  for (const quality of repeatedQualities(cycle)) {
    findings.push({
      kind: 'quality_repeated',
      text: `${EFFORT_QUALITY_LABELS[quality]} on consecutive days.`,
    });
  }

  const unlinked = days.length - linked;
  if (unlinked > 0) {
    findings.push({
      kind: 'sessions_unlinked',
      text:
        unlinked === days.length
          ? 'No session this week named a principle, so the week cannot be checked against the model.'
          : `${unlinked} of ${days.length} sessions named no principle.`,
    });
  }

  // Reported, never judged. A week spanning four unrelated macros may be exactly what a coach
  // intended after a poor result; the app raises it and stops.
  if (macros.length > 1) {
    findings.push({
      kind: 'macro_spread',
      text: `The week's work spans ${macros.length} macro principles.`,
    });
  }

  if (
    cycle.loadLabellingAllowed &&
    days.some((day) => day.effortQuality !== null) &&
    !days.some((day) => day.effortQuality !== null && isAcquisitive(day.effortQuality))
  ) {
    findings.push({
      kind: 'no_acquisitive_day',
      text: 'Nothing this week was labelled as an acquisitive day.',
    });
  }

  return findings;
}

/**
 * One sentence, or nothing.
 *
 * Nothing below two sessions, and nothing at all when there is no game model — a coach who has
 * not authored one is not told their week failed to contain it.
 */
export function describeWeekReview(review: WeekReview, model: GameModel | null): string | null {
  if (model === null) return null;
  if (review.total < MIN_SESSIONS_FOR_WEEK_REVIEW) return null;

  const themed =
    review.macroPrinciples.length === 1 ? ` Themed on "${review.macroPrinciples[0]!.text}".` : '';

  const counted = `${review.linked} of ${review.total} sessions named a principle.${themed}`;

  if (review.findings.length === 0) return counted;
  return `${counted} ${review.findings.map((finding) => finding.text).join(' ')}`;
}

/**
 * The moments the week touched, in the model's own order.
 *
 * Offered for display rather than as a finding, for the reason at the top of this file: a week
 * concentrated on one moment is the normal shape of an acquisition week.
 */
export function momentsInWeek(review: WeekReview): Moment[] {
  const seen = new Set<Moment>();
  for (const day of review.days) if (day.moment !== null) seen.add(day.moment);
  return [...seen];
}

/** `In possession, when we lose it` — for the week's summary line. */
export function describeMomentsInWeek(review: WeekReview): string | null {
  const moments = momentsInWeek(review);
  if (moments.length === 0) return null;
  return moments.map((moment) => MOMENT_LABELS[moment]).join(', ');
}
