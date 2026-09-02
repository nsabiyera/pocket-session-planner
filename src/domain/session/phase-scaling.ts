import type { PhaseTemplateId } from '../ids';
import type { MethodologyPhaseTemplate } from '../methodology';

/**
 * Turns a methodology's duration *weights* into real minutes for the length of session the
 * coach actually has. Pure, and the second-most-tested function in the project.
 *
 * Two rules the arithmetic has to respect:
 *
 *  - **Round to `stepMin`.** No coach runs a 13-minute practice; they run 10 or 15. A phase
 *    plan full of odd numbers reads as noise and gets ignored.
 *  - **The total must be exact.** A coach who asks for 60 minutes and gets 57 will notice,
 *    and will trust the rest of the plan less for it.
 *
 * Those two rules are in tension, so the allocation is **largest-remainder (Hamilton)**
 * apportionment over whole steps, with any sub-step residual pushed onto the heaviest phase.
 *
 * A note on the method, because it is a deliberate change from the obvious one. Rounding
 * each phase independently and pushing the whole accumulated error onto the heaviest phase
 * is simpler, but it inverts the ordering as soon as several phases round up: for the
 * Command preset at 60 minutes it turns the 30%-weighted conditioned game into the joint
 * *shortest* phase. Largest-remainder cannot do that, because it only ever hands out whole
 * steps in weight order.
 */
export function scalePhaseDurations(
  templates: readonly MethodologyPhaseTemplate[],
  totalMin: number,
  stepMin = 5,
): Map<PhaseTemplateId, number> {
  const result = new Map<PhaseTemplateId, number>();

  // A zero weight means "fixed length, excluded from the scaled pool" — water breaks. They
  // keep `defaultDurationMin` and simply reduce what everything else has to share.
  const fixed = templates.filter((t) => t.durationWeight <= 0);
  const scaled = templates.filter((t) => t.durationWeight > 0);

  for (const template of fixed) {
    result.set(template.id, template.defaultDurationMin);
  }
  if (scaled.length === 0) return result;

  const fixedTotal = fixed.reduce((total, t) => total + t.defaultDurationMin, 0);
  const pool = totalMin - fixedTotal;

  // Degenerate: not even a minute each once the fixed phases have taken their cut. Floor
  // every phase at one minute and accept overshooting the target, because a zero-length
  // phase is not a thing a coach can run.
  if (pool < scaled.length) {
    for (const template of scaled) result.set(template.id, 1);
    return result;
  }

  // If the requested step is too coarse to give every phase one, fall back to minutes.
  const step = Math.round(pool / stepMin) >= scaled.length ? stepMin : 1;
  const totalSteps = Math.round(pool / step);

  const weightSum = scaled.reduce((total, t) => total + t.durationWeight, 0);
  const quotas = scaled.map((template) => ({
    template,
    // Renormalised, so this still behaves for a custom methodology whose weights are a
    // little off 1 — the schema tolerates ±0.001 and a hand-edited import may be worse.
    quota: (template.durationWeight / weightSum) * totalSteps,
  }));

  // **Reserve one step for every weighted phase first.** A phase that rounds away to
  // nothing is not a phase, and reserving up front means the apportionment below can only
  // ever hand out steps that exist — there is no over-allocation to claw back afterwards.
  const steps = new Map<PhaseTemplateId, number>(quotas.map(({ template }) => [template.id, 1]));
  const spare = totalSteps - scaled.length;

  // Largest-remainder over what each phase wants *beyond* its reserved step.
  const wants = quotas.map((entry) => ({ ...entry, want: Math.max(0, entry.quota - 1) }));
  const wantSum = wants.reduce((total, entry) => total + entry.want, 0) || 1;

  const shares = wants.map((entry) => ({ ...entry, share: (entry.want / wantSum) * spare }));
  let handedOut = 0;
  for (const { template, share } of shares) {
    const whole = Math.floor(share);
    steps.set(template.id, (steps.get(template.id) ?? 1) + whole);
    handedOut += whole;
  }

  // Whatever the flooring left over goes one step at a time to the largest fractional part.
  // Ties go to the heavier phase, and then to the *later* one — the closing game is the
  // phase a coach most regrets having cut short.
  const leftover = spare - handedOut;
  const order = [...shares].sort((a, b) => {
    const fracA = a.share - Math.floor(a.share);
    const fracB = b.share - Math.floor(b.share);
    if (fracA !== fracB) return fracB - fracA;
    if (a.template.durationWeight !== b.template.durationWeight) {
      return b.template.durationWeight - a.template.durationWeight;
    }
    return b.template.order - a.template.order;
  });
  for (let i = 0; i < leftover; i += 1) {
    const target = order[i % order.length]?.template;
    if (target) steps.set(target.id, (steps.get(target.id) ?? 1) + 1);
  }

  for (const { template } of quotas) {
    result.set(template.id, (steps.get(template.id) ?? 1) * step);
  }

  // `pool` need not be a whole number of steps (a 57-minute pool at a 5-minute step). Push
  // the leftover minutes onto the heaviest phase so the session total is exactly what the
  // coach asked for.
  const allocated = scaled.reduce((total, t) => total + (result.get(t.id) ?? 0), 0);
  const residual = pool - allocated;
  if (residual !== 0) {
    const heaviest = heaviestTemplate(scaled);
    if (heaviest) {
      result.set(heaviest.id, Math.max(1, (result.get(heaviest.id) ?? 0) + residual));
    }
  }

  return result;
}

/** The phase that absorbs rounding residue. Ties go to the earlier phase, for stability. */
function heaviestTemplate(
  templates: readonly MethodologyPhaseTemplate[],
): MethodologyPhaseTemplate | undefined {
  return templates.reduce<MethodologyPhaseTemplate | undefined>((best, candidate) => {
    if (!best) return candidate;
    if (candidate.durationWeight > best.durationWeight) return candidate;
    if (candidate.durationWeight === best.durationWeight && candidate.order < best.order) {
      return candidate;
    }
    return best;
  }, undefined);
}

/** Total minutes a scaling actually came to. Used by tests and by the phase-editor header. */
export function scaledTotal(durations: ReadonlyMap<PhaseTemplateId, number>): number {
  let total = 0;
  for (const value of durations.values()) total += value;
  return total;
}
