# ADR 0008 — The tactical periodization set, behind a default-off flag

- **Status:** Accepted
- **Date:** 2026-09-10
- **Relates to:** [ADR 0006](0006-tactical-periodization-without-the-morphocycle.md),
  [ADR 0007](0007-morphocycle-for-adult-squads.md)
- **Roadmap:** [`docs/roadmap-tactical-periodization.md`](../roadmap-tactical-periodization.md)

## Context

All six phases of the tactical periodization roadmap are built, tested and deployed. Reviewing
what shipped, against the app the README and the user manual describe, turns up a problem that is
not in any one phase.

**The feature changed the shape of the app for coaches who did not ask for it.**

Concretely, on a default install with no game model and no fixtures:

- `/squad` — the roster screen a coach opens most weeks — leads with `Game model` and `The week`
  before the players, plus a `Squad level` control whose only function is to gate effort
  labelling on a screen the coach has never opened.
- `/plan` step 1 offers a principle picker that can only ever say *"no game model yet"*.
- `/plan/fixtures` offers `The week` and `Match brief`, and its empty state explains itself in
  terms of both.

Two facts make this worse than ordinary feature clutter.

**The user manual never documented any of it.** `docs/user-manual.md` covers Plan → Do → Review,
challenges, match day, the two FA models and the export. There is no game model section, no week
section and no match brief section. So the shipped app has four screens a coach cannot look up.

**ADR 0007 changed the audience for the feature, not for the app.** The morphocycle work was
written for professional and semi-professional clubs. The app's stated audience is still "the
coach standing on a pitch in the rain holding a ball", and the README still leads with a
twenty-second create flow. ADR 0007 keyed the *safeguarding* half of that difference to
`Squad.level`, correctly. It never keyed the *existence* of the feature to anything.

The roadmap's own closing note says it plainly: **none of this has been used by a coach.** There
is no installed base whose screens would disappear — which is precisely why this is cheap to fix
now and expensive to fix later.

## Decision

**Put the whole tactical periodization set behind one flag, off by default.**

The flag hides `Game model`, `The week`, the `Match brief`, the principle picker on `/plan`, and
the `Squad level` control. What remains is the Plan → Do → Review app the manual describes.

### It is device meta, not squad data

`AppMeta.tacticalPeriodization`, patched from Settings, read through one accessor
(`periodizationEnabled`). Three consequences, each deliberate:

- **Not a `Squad` field.** `Squad.level` is a fact about a squad — those eleven-year-olds are
  eleven whatever the coach thinks (ADR 0007). Whether a coach works from a game model at all is
  a fact about the *coach*, and a club that uses the methodology uses it for the first team and
  the academy alike.
- **Not in the export.** The export merges another coach's squad alongside yours. A flag riding
  in that file could switch a feature on in your app because somebody else uses it, which is a
  surprise nobody would be able to explain.
- **Not `localStorage`.** Theme and contrast live there because they are applied to the document
  before React runs. This is read by four screens through the same store every other screen
  reads, and putting it in `AppMeta` means one subscription repaints all of them.

### The switch is not destructive, and says so

Turning it off writes nothing but the flag. A game model stays in `game_models`, a session's
`objective.principleId` stays on the session, `Squad.level` keeps its value. Turning it back on
finds all of it exactly as it was. The Settings copy states this, and a test asserts it — a
switch a coach is afraid of is a switch they never touch, and this one has to be tried to be
worth having.

### The routes stay reachable

`/squad/game-model`, `/plan/week` and `/plan/prepare` render a short "this is turned off" screen
with a link to Settings, rather than 404ing or redirecting. Every route is precached by the
service worker and there is no server to redirect anything, so a bookmark or a home-screen
shortcut *will* land there. A blank screen would read as the app being broken.

### The fixture list is not behind the flag

`/plan/fixtures` stays. A run of dated matches is useful to any coach who plans match days, it is
the only way to commit more than one fixture at a time, and match day is ADR 0005 — older than
this feature and not part of it. Only the two links out to the periodization screens are gated,
and the copy that referenced them is now conditional.

## Alternatives considered

**Key it on `Squad.level === 'senior'`.** Free — the field already exists. Rejected: it conflates
two unrelated questions. A youth coach may legitimately work from a game model (ADR 0006's whole
argument was that the tactical half survives at any age), and a senior coach may not use the
methodology at all. Inferring a methodology from an age band is exactly the kind of invented fact
this codebase refuses everywhere else.

**Show the screens, but empty-state them harder.** They already do this well: each says what it
needs and offers the link to get it. It is not enough. The cost is not confusion, it is four
extra things in front of a volunteer who wanted the roster — and no amount of good empty-state
copy removes a row from `/squad`.

**Delete the feature.** Honest, and wrong. The work is built, tested, documented in two ADRs, and
correct for the audience ADR 0007 named. A flag keeps it for that audience at the cost of one
boolean.

**A per-feature flag each.** Four switches for four screens. Rejected: they are one methodology
and they depend on each other — the week is meaningless without the model, the brief is a view
over the week. Four flags would let a coach build combinations that make no sense.

## Consequences

- **Positive:** the default install is the app the README and the manual describe, and `/squad`
  leads with players again.
- **Positive:** the periodization work survives intact for the audience it was built for, at one
  tap in Settings.
- **Positive:** ADR 0007's negative about the planning half wanting a bigger screen is now
  contained rather than merely acknowledged — a coach who will never plan at a desk never sees
  the screens that want one.
- **Negative:** discoverability drops to approximately zero. A pro coach who would use this has
  no way to learn it exists except by reading Settings. That is the intended trade, but it is a
  real cost, and it is the reason the Settings copy names all four screens rather than saying
  "advanced planning".
- **Negative:** a fifth thing on the Settings screen, which is already the longest in the app.
- **Negative:** four screens now have two states to field-test rather than one, and the
  switched-off state is the one nobody will remember to check.
- **Follow-up:** the manual still has no section for any of this. With the flag off by default
  that is no longer *incorrect*, but a feature reachable only from Settings needs its paragraph
  in Settings' own terms more than a discoverable one would.
- **Follow-up:** if the flag is ever switched on for a coach who already authored a game model
  before this ADR, nothing prompts them. There is no such install today (the roadmap's closing
  note), which is why no migration was written; if the deployed app has ever been used for real,
  that assumption needs re-checking before it is relied on again.
