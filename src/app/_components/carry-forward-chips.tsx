'use client';

import Link from 'next/link';
import { CHAIN_DEPTH_WARNING, type CarryForwardAction } from '@/domain/carry-forward';
import { Why } from './why';

/**
 * Open carry-forward actions, shown in three places: as a pre-ticked checklist above the
 * objective on `/plan`, as one-tap fills on an empty objective field, and here on Today.
 *
 * The chain-depth flag is the useful bit. *"You've chased this for 3 sessions — change the
 * practice, not the point."* is genuinely good coaching feedback, and it falls straight out
 * of the model rather than needing any analysis.
 */
export function CarryForwardChips({
  actions,
  selectedIds,
  onToggle,
}: {
  actions: readonly CarryForwardAction[];
  selectedIds?: ReadonlySet<string>;
  onToggle?: (action: CarryForwardAction) => void;
}) {
  if (actions.length === 0) return null;

  const stuck = actions.filter((action) => action.chainDepth >= CHAIN_DEPTH_WARNING);

  return (
    <section className="stack">
      <div className="row row--between">
        <h2>Carried forward</h2>
        {onToggle ? null : (
          <Link href="/plan" className="btn btn--quiet">
            Use these
          </Link>
        )}
      </div>

      {stuck.length > 0 ? (
        <div className="banner banner--warn">
          {stuck.length === 1
            ? `You've chased "${stuck[0]?.title}" for ${(stuck[0]?.chainDepth ?? 0) + 1} sessions`
            : `${stuck.length} points have run for three sessions or more`}{' '}
          — change the practice, not the point.
          <Why id="carry-forward:chain-stuck" />
        </div>
      ) : null}

      <ul className="stack stack--tight">
        {actions.map((action) => {
          const selected = selectedIds?.has(action.id) ?? false;
          const label = (
            <>
              <span className="card-title">{action.title}</span>
              {action.detail ? <span className="card-meta">{action.detail}</span> : null}
              <span className="row row--wrap">
                <span className="pill">{action.kind.replace(/_/g, ' ')}</span>
                {action.priority === 'high' ? <span className="pill pill--over">high</span> : null}
                {action.chainDepth >= CHAIN_DEPTH_WARNING ? (
                  <span className="pill pill--over">{action.chainDepth + 1}th session</span>
                ) : null}
              </span>
            </>
          );

          return (
            <li key={action.id}>
              {onToggle ? (
                <button
                  type="button"
                  className="card card--link"
                  aria-pressed={selected}
                  data-selected={selected}
                  onClick={() => onToggle(action)}
                >
                  <span className="row">
                    <span className="check" aria-hidden="true">
                      {selected ? '✓' : ''}
                    </span>
                    <span className="stack stack--tight">{label}</span>
                  </span>
                </button>
              ) : (
                <div className="card">{label}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
