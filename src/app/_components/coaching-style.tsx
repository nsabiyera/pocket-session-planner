'use client';

import {
  describeCoachingStyle,
  describeStyleEvidence,
  hasEnoughForStyle,
  type CoachingStyle,
} from '@/domain/coaching-style';
import { INTERVENTION_METHODS, interventionMethodLabel } from '@/domain/intervention';
import {
  describeQuestioning,
  hasEnoughForQuestioning,
  type QuestioningSummary,
} from '@/domain/questioning';
import { Why } from './why';

/**
 * **How you coach** — the coach's own style across a term.
 *
 * Five bars for the FA's Five Pillars, one sentence of counts, and one sentence saying how
 * much of it is evidence rather than plan. That second sentence is not a footnote: without
 * it the bars read as an observation of the coach, when most of them are a readback of what
 * the coach told the app they would do.
 *
 * No evenness score and no suggestion, for the same reason `PracticeMixPanel` has none — the
 * Five Pillars are five tools and not a ranking, and which one a session needed is not a
 * judgement this app is in a position to make.
 */
export function CoachingStylePanel({
  style,
  questioning,
}: {
  style: CoachingStyle;
  /** The term's questioning record. Its own floor, so it can be silent while the bars are not. */
  questioning: QuestioningSummary;
}) {
  if (!hasEnoughForStyle(style)) return null;

  const max = Math.max(1, ...INTERVENTION_METHODS.map((method) => style.countByMethod[method]));
  const evidence = describeStyleEvidence(style);

  return (
    <section className="stack">
      <h2>How you coach</h2>

      {/* The bar primitive is shared with the corner and practice-mix panels. */}
      <ul className="corner-bars corner-bars--labels-lg">
        {INTERVENTION_METHODS.map((method) => {
          const count = style.countByMethod[method];
          return (
            <li key={method} className="corner-bar">
              <span className="corner-bar-label">{interventionMethodLabel(method)}</span>
              <span className="corner-bar-track">
                <span
                  className="corner-bar-fill"
                  style={{ width: `${Math.round((count / max) * 100)}%` }}
                />
              </span>
              {/* "none" in words — a colour and a length alone are invisible in glare. */}
              <span className="corner-bar-count tabular">{count === 0 ? 'none' : count}</span>
            </li>
          );
        })}
      </ul>

      <div className="card-meta">
        {describeCoachingStyle(style)}
        <Why id="report:coaching-style" />
      </div>

      {/*
        How much of the above the app can actually stand behind. Rendered as a banner rather
        than a footnote because a coach who reads the bars and not this would come away with
        a belief about themselves the data does not support.
      */}
      {evidence ? (
        <div className="banner banner--warn">
          {evidence}
          <Why id="report:style-evidence" />
        </div>
      ) : null}

      {/*
        The questioning bar above says how often; this says to whom. It is the minutes report
        about a different scarce resource — except that naming who you asked is optional, so
        the sentence is scoped to what was recorded and never claims the rest.

        Its own floor rather than the panel's: a coach with plenty of interventions and four
        questions has a style worth showing and no questioning spread worth stating.
      */}
      {hasEnoughForQuestioning(questioning) ? (
        <div className="card-meta">
          {describeQuestioning(questioning)}
          <Why id="report:questioning" />
        </div>
      ) : null}
    </section>
  );
}
