# ADR 0007 — The morphocycle, for adult squads, with the coach's own pattern

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** [ADR 0006](0006-tactical-periodization-without-the-morphocycle.md)
- **Roadmap:** [`docs/roadmap-tactical-periodization.md`](../roadmap-tactical-periodization.md)

## Context

ADR 0006 declined to implement the morphocycle. It gave three reasons, and it was written on the
stated assumption that this app's audience is grassroots youth football. **That assumption has
changed: this feature is for coaches at professional and semi-professional clubs.**

Two of the three reasons do not survive the change, and it is worth being precise about which.

| ADR 0006's reason | Under the new premise |
| --- | --- |
| The morphocycle assumes four training days; grassroots gets one or two | **Gone.** A professional week has four or five. A semi-professional week typically has two or three evenings, which is fewer than the classical pattern but genuinely more than one. |
| The sources disagree on the day-to-quality mapping, and the canonical source withholds it | **Survives, unchanged.** This is a fact about the literature, not about the audience. |
| Tension, duration and velocity are adult load concepts, and the app starts at U7 | **Gone for a first team.** A pro or semi-pro first team is adults. It emphatically does **not** go away for the academy squads the same club runs. |

This is a reversal driven by a changed premise rather than by new evidence, which is why ADR 0006
is superseded rather than rewritten. Its reasoning was right for the audience it named.

One further thing the research turned up, which changes a design ADR 0006 had defended on the
wrong grounds. **The morphocycle expands and compresses with the fixture list** — a standard week
is seven days, and a two-game week compresses to a three-day cycle. So "the sessions you actually
have before this fixture" is not a grassroots concession at all. It is how the morphocycle
behaves at every level, and it is now better justified than when ADR 0006 argued for it.

## Decision

**Implement the morphocycle, keyed to the squad, with the pattern owned by the coach.**

### The pattern is configurable, and the default is cited rather than asserted

The one surviving objection from ADR 0006 still binds: there is no canonical day-to-quality
table to ship. The resolution is not omission but **ownership**. In tactical periodization the
morphocycle pattern is derived from the club's own game model, so a configurable pattern is not a
hedge — it is the methodology's own position.

The app ships the classical presentation as a **labelled, editable default**: tension on MD-4
(small spaces, few players, sub-principles), duration on MD-3 (large spaces, more players, macro
principles), velocity on MD-2 (short, explosive, micro-principles). It is presented as *one
published reading*, with the disagreement named, and the coach can change every row. What the app
must never do is present it as the method's single correct form.

Above that sits the less contested distinction, which is what the app leads with: **acquisitive
days** carrying the week's real demand, and **recovery days** immediately after the match and
immediately before the next.

### The cycle is derived from the fixture list, not from a fixed week

A morphocycle is the span between two matches. The app computes it from the fixtures and the
sessions scheduled inside it, so it compresses to three days in a midweek-game week and stretches
in an international break, without the coach re-planning anything. Day labels are relative to the
*next* match (MD-4, MD-3) because that is how the method names them and, at this level, the coach
already speaks that way.

### Load labelling is gated on the squad being adult

**This is the safeguarding line, and it does not move.** A professional club runs an academy full
of children, and the same app installed on the same phone may hold a U10 squad. Effort-quality
labelling is therefore a property of the **squad**, resolved from `Squad.ageGroup` via the
existing `ageBandOf`:

- An **adult** squad (no youth age band, or a band the coach marks as a senior team) gets the
  full morphocycle: day labels, effort qualities, alternation checking.
- A **youth** squad gets ADR 0006's decision unchanged — principles, moments, specificity, and no
  load periodization. Frade's own position is that early stages take the general principles of
  the four moments, so this is not a limitation imposed on youth but the method applied to it.

Making this a global setting would be the wrong shape: it would let one squad's configuration put
strength-dominant Tuesdays in front of a coach planning for eleven-year-olds.

### The app still prescribes no load numbers

Effort qualities are **labels the coach assigns to a session**, and the app reports what was
assigned. There is no RPE capture, no intensity percentage, no session-load arithmetic and no
readiness score. That is not caution left over from ADR 0006; it is tactical periodization's own
position that the physical is a consequence of playing rather than a component to be dosed, and
the app has no business inventing numbers a coach did not enter.

### Horizontal alternation becomes checkable, and that is the real prize

Once sessions carry an effort quality and a principle level, the app can do the thing a coach
cannot do from memory across a congested month: **notice that the same quality was worked twice
running, or that a moment has not been trained in five weeks.** `practice/mix.ts` already has
this shape for the practice spectrum. It is the strongest argument for the whole feature, and it
was unavailable under ADR 0006.

## Consequences

- **Positive:** the feature becomes the methodology rather than an extract of it. The objection
  ADR 0006 conceded — that a morphocycle is the method's organising unit and not an accessory —
  no longer applies to an adult squad.
- **Positive:** alternation reporting is now possible, which is the one thing here that can
  genuinely falsify a coach's own plan rather than merely record it.
- **Positive:** deriving the cycle from fixtures means a two-game week works without a second
  code path, and the compress/stretch behaviour is the method's, not an approximation of it.
- **Negative:** the app now behaves differently for two audiences, and the difference is keyed on
  `Squad.ageGroup`, which is **free text**. `ageBandOf` already refuses to parse a squad *name*
  as an age group, so a senior squad called "First Team" resolves to no band — which must default
  to the youth-safe behaviour and let the coach opt in, never the other way round. Defaulting a
  blank field to "adult" would put load labelling in front of a youth coach who simply never
  filled it in.
- **Negative:** the twenty-second create flow and the gloved-thumb sizing were designed for a
  volunteer on a wet touchline. A professional coach plans at a desk with an analyst, and some of
  this feature genuinely wants a bigger screen than the app is built for. The pitch-side half
  still matters — a pro coach still runs the session on grass — but the planning half is the
  first thing in this app whose natural home is not a phone.
- **Negative:** shipping a default pattern at all is a risk ADR 0006 avoided by shipping none. A
  coach may take the default as canonical however it is labelled. The mitigation is that it is
  editable and that the disagreement is stated next to it; the mitigation is not that the label
  is emphatic.
- **Follow-up:** whether a squad needs an explicit `level` (youth / senior) rather than being
  inferred from a free-text age group. It probably does, and it is one field — but it is also the
  gate on the safeguarding decision above, so it should be added deliberately with the youth-safe
  default rather than arrived at.
