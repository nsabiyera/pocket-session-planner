# ADR 0005 — Match day as a `Session` kind, not a second aggregate

- **Status:** Accepted
- **Date:** 2026-09-06

## Context

The app closed the Plan → Do → Review loop for training and broke it on Saturdays. A coach
planned on Tuesday, ran it, reviewed it — and then the match happened and nothing was recorded.
That is the wrong place to lose the thread: the match is where the week's work either shows up
or does not, and carry-forward could already flag a coaching point chased three sessions running
but could not notice that the same point finally landed in a game.

Issue #2 asked for four things: plan, run and review a match; set challenges for players; set
unit or whole-team objectives; and pick a shape. It also named the decision that had to be
settled before any code, because everything else hangs off it — **is a fixture a new aggregate,
or a `Session` with a kind?**

The tension is real in both directions. A match genuinely has fields a training session does
not (opponent, venue, shape, units, who was on the pitch) and lacks ones it does (methodology,
practice spectrum, STEP constraints, group size). Forcing them into one object risks a type
where half the fields are meaningless for each case. But ADR 0001 is explicit that only *new
aggregates* pay the IndexedDB store tax, and a second aggregate would have to re-implement the
run state machine, the review pipeline, carry-forward and the transfer envelope, or share them
through an abstraction invented for two callers.

## Decision

**A match is a `Session` with `kind: 'match'` and a nullable `match` block.**

The deciding observation was that `PhaseKind` already contained `game` and `huddle`. Periods
are phases and half time is a huddle — no new vocabulary — which means the wall-clock timer
that survives a screen lock and a force-quit, the two-tap observations, the player challenges
and the whole of Review work on a match without knowing one is happening.

Both fields ride `nullable().default()` on a document indexed on neither, the same free
migration path `SessionPhase`'s practice-design fields took in ADR 0004. The proof that it was
free is that all 1217 pre-existing tests passed untouched: every session written before match
day is a `training` session, with no migration and no backfill.

The discriminator is enforced **in both directions** by `superRefine`. A match without its
match block, and a training session carrying an opponent, are both perfectly valid plain
objects and both corrupt; they are rejected at the schema rather than discovered in a season
report.

### What a match does not inherit

A match period is **not** a designed practice. `spectrum`, `area`, `groupSize` and the STEP
constraints stay null on every phase a match builds. A game is the thing practices are
representative *of*, and filling those fields in would put invented practice design into the
reports ADR 0004 built.

Match day also carries its own `MethodologySnapshot` — `hands_off`, named "Match day" — which
is deliberately **not** registered in `METHODOLOGY_PRESETS`. Those five are ways to design a
practice, and offering "Match day" in the training methodology picker would be nonsense.
Because `Session.methodology` is a frozen snapshot rather than a live reference, a match can
describe how a coach coaches on a Saturday without pretending to be one of them.

### Shapes are keyed by format

`practice/match.ts` already held England Football's table of which age band plays which format,
so the squad's age group answers the format without a tap. Shapes are then keyed by format
rather than offered as one flat list, because offering a u9 coach a 4-3-3 would be the app being
confidently wrong in public. Every shape is tested to field exactly the format's team; one that
quietly summed wrong would put a coach on the pitch a player short and look entirely plausible
in a list. 3v3 is keeperless, per the FA.

Units are derived from the shape's lines rather than stored, so `4-2-3-1` keeps the name a coach
says while still reporting a midfield of five, and a two-line shape gets no midfield rather than
a guessed one.

### Minutes are period presence, not a running clock

Equal playing time is a duty of care in youth football and it is the arithmetic a coach cannot do
from memory while managing rolling substitutions in the rain — so the app does it. But it does it
at the resolution the record actually has: **who was on for each period**, ticked once per period,
seeded from the previous period because most of a team stays on.

A per-player running clock was the alternative and was rejected. It would have produced precise
numbers nobody entered, and a report that looked more exact than the thing behind it. The report
states its own resolution out loud — *"to the nearest half"*.

## Consequences

- **Positive:** the entire Do and Review surface came for free. Match day added no store, no
  migration, no second timer and no parallel review pipeline.
- **Positive:** a term's 4 Corner balance and capability coverage now include games, because
  match observations share the observation store. Saturday counts as evidence.
- **Positive:** `InterventionPlan` expressed the one thing that most needed saying without any
  new modelling — periods carry `maxPerPhase: 0` with mechanic `none`, because you cannot stop
  a referee's game to coach, and half time carries a real budget aimed at `unit`.
- **Negative:** `Session` is now a wider type than it was, and a reader has to check `kind`
  before trusting `methodology` to mean a training methodology. Two bugs came from exactly
  this during implementation: `lastUsedMethodologyId` made `match-day` the sticky training
  default and broke `New session` outright, and `checkReferences` validated a session's
  challenges but knew nothing about the match lineup or presence, so a match could import onto
  a device crediting minutes to a player who did not exist there. Both are fixed and tested.
  Every future reader of a session has the same trap available to them.
- **Negative:** the minutes report is honest about its resolution but still coarse. A player who
  came on for the last five minutes of a half is credited with the whole half.
- **Follow-up:** the report **describes and does not prescribe** — no threshold, no warning
  colour, no advice, and a deliberately neutral grey bar. A short bar is a fact; the coach is
  the one who knows a player arrived late or asked to come off. If this is ever revisited, the
  bar to clear is the one every other derived line in this app clears: say what the record says,
  and say what it cannot support.
