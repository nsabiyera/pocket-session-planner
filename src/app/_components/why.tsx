import { findRationale, type RationaleId } from '@/domain/rationale';

/**
 * Where the `?` hangs.
 *
 * `inline` trails the sentence it explains, for a banner or a heading. `corner` pins it to
 * the top-right of a card whose whole face is already a button — a `<details>` cannot live
 * *inside* a `<button>`, and a `?` on its own line under every one of eight carry-forward
 * chips would cost about 180px of a 667px screen. Both cost zero vertical space closed.
 */
export type WhyVariant = 'inline' | 'corner';

/**
 * *"Why am I seeing this?"* — a `?` you can ignore.
 *
 * Every judgement the app makes at the coach gets one of these. Collapsed it is a small `?`
 * that sits **inline at the end of the sentence it explains** and adds no vertical space at
 * all, which is the whole design constraint: a review screen where six explanations pushed
 * the Save button off a 667px phone would be a worse review screen, not a better-informed one.
 *
 * Explanations are pull, not push. Nothing here renders until the coach taps.
 *
 * A plain `<details>`, so the open/closed state is the browser's problem and every one of
 * these works before hydration and with JavaScript still in flight. No `'use client'` of its
 * own either: there is no state and no handler here, so it simply inherits whichever
 * environment imported it.
 */
export function Why({ id, variant = 'inline' }: { id: RationaleId; variant?: WhyVariant }) {
  // A `?` with nothing behind it is worse than no `?`. `findRationale` is the total lookup,
  // used rather than `rationaleFor` so a trigger string off an old stored action is safe too.
  const rationale = findRationale(id);
  if (!rationale) return null;

  return (
    <details className={`why why--${variant}`}>
      <summary aria-label="Why am I seeing this?">?</summary>
      <div className="why-body">
        <p className="eyebrow">{rationale.framework}</p>
        <p>{rationale.why}</p>
        {rationale.source ? (
          <a href={rationale.source} target="_blank" rel="noreferrer noopener">
            Read the source
          </a>
        ) : null}
      </div>
    </details>
  );
}

/**
 * The same disclosure against a trigger string rather than a known id.
 *
 * `CarryForwardProposal.trigger` and `CarryForwardAction` are typed `string`, and an action
 * saved by an older build can carry a rule this build has never heard of. That renders
 * nothing, which is the right answer.
 */
export function WhyTrigger({ trigger, variant }: { trigger: string; variant?: WhyVariant }) {
  const rationale = findRationale(trigger);
  if (!rationale) return null;
  return <Why id={rationale.id} variant={variant} />;
}
