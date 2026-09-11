# ADR 0010 — Several squads, switched in Settings

- **Status:** Accepted
- **Date:** 2026-09-11
- **Relates to:** [ADR 0001](0001-indexeddb-not-drizzle-postgres.md),
  [ADR 0003](0003-no-dynamic-route-segments.md),
  [ADR 0007](0007-morphocycle-for-adult-squads.md)

## Context

A coach with more than one team had no way to say so.

`Squad` has been a first-class aggregate since the first commit, `app_meta.activeSquadId` has
always existed, and `setActiveSquad` was written and unit-tested. None of it was reachable: the
only path that ever created a squad was the first-run screen, which renders on `!state.squad` and
so can be seen exactly once. The domain comment said the quiet part out loud — *"the switcher only
appears once a second squad exists"* — describing a switcher nobody had built.

This is not a niche case. A grassroots volunteer with the U12s and the U14s, a club coach with a
first team and reserves, a coach running a girls' and a boys' side: the app's own audience.

What they did instead was the problem. With one roster available, two teams become one roster:
twenty-six players in one list, a corner-balance report averaged across two age groups, and a
carry-forward action from Tuesday's U14s pre-filling Thursday's U12s session. The FA 4 Corner
reports and carry-forward are the two features this app claims as its reason to exist, and both
are quietly wrong the moment a roster holds two teams.

Three facts made the fix smaller than it looks, and one made it larger.

**Smaller.** Every row under a squad already carries a `squadId`, and every read below the app
store is already scoped by one: `listBySquad`, `findDraft`, `findAwaitingReview`, `listOpen`,
`findBySquad`. Switching is one `app_meta` write. Nothing migrates and nothing is rewritten.

**Larger.** Two reads were *not* scoped, and they are the ones that matter. `sessions.findActive()`
answers device-wide by design — *"the coach has one session in flight, whoever it is with"* — and
the app store handed its answer straight to `state.activeSession`. With two squads and a draft
each, `/plan` would have edited the U14s' draft under a header naming the U12s. And
`squads.list()` had no notion of an archived squad, so last season's team would sit in the switcher
for ever.

## Decision

**Squads are managed in Settings: add, switch to, rename, archive, restore. One `app_meta`
pointer decides which squad every other screen is about.**

### Settings, not a header switcher

The panel is the first thing under the install row on Settings, above appearance.

Not on `/squad`: that screen is *about* the current squad — its roster, its game model, its
practice mix — and a control that changes which squad that is does not belong inside the thing it
changes. Not in the header either, which was the tempting option: a persistent switcher next to
the squad name on every screen is one mis-tap from planning against the wrong team, and the whole
of `bottom-nav` is sized for a gloved thumb. Settings is where a coach already goes to answer
*"how is this app set up for me"*, which is precisely what a second team is.

The cost is real and accepted: switching is four taps (Settings → the squad → Switch to → back),
not one. A coach switches teams a couple of times a week, and plans a session within one of them
many times more often. The frequent action keeps the cheap path.

**The panel is shown on a one-squad install**, with `Add another squad` as its only action. A
switcher that materialises the moment a second squad exists cannot tell anybody they could have
one — and this is the one feature a coach has to hear about *before* they need it, because the
alternative they will otherwise adopt is the twenty-six-player roster.

### Switching is refused while a session is running

`switchSquad` returns `Err({ kind: 'session_running' })` mid-run, naming the session. This is the
rule that makes several squads safe rather than merely possible, and it has two independent
justifications that happen to agree:

- **Evidence would land under the wrong team.** Every observation, intervention and challenge
  event logged in Do mode is filed against the running session's squad. Switching mid-run is the
  one move that could put a Tuesday's evidence under Thursday's team, and misfiling a note about a
  child's development is the single thing this app must not let a coach do by accident.
- **It would not work anyway.** `read()` resolves the current squad from the running session
  before it consults `activeSquadId`, because the app must never hide a session a coach is
  standing in front of. A switch would be silently overridden on the next refresh, and a control
  that appears to do nothing is worse than one that explains itself.

Finishing or abandoning the session clears it. A *draft* for another squad blocks nothing: drafts
are one **per squad**, which is what ADR 0003 always meant, and both survive a switch untouched.

### `state.activeSession` is scoped to the squad; a run outranks the pointer

`findActive` gained an optional `squadId`. It narrows the quiet candidates — drafts and planned
sessions — and deliberately does **not** narrow a run in progress. Two lines, one in each store
implementation, with a contract test asserting both halves against the fake and the real adapter.

The app store then reads it twice, which looks redundant and is not: once device-wide, to let a
running session decide which squad the app is about, and once scoped, to pick this squad's draft.
The second read is skipped entirely when a run is in flight.

### Archived, never deleted — and still in the export

Archiving a squad sets `archivedAt` and writes nothing else. Its players, sessions, observations,
reviews, assessments, scans and carried actions stay exactly where they are, and restoring brings
the lot back. Same bargain as `archivePlayer`, and the same reason: a season of notes about
children's development is not the app's to throw away, and the coach who archives the U12s in July
still wants to read the term back in September.

`squads.list()` therefore hides archived squads and the **export includes them**. That second half
is load-bearing rather than tidy: the JSON file is the only backup there is, and last season's team
is the most likely thing a coach would be devastated to find missing from it. Import diffing reads
them too, or a merge would write a second copy of last season alongside the first. The crash
reporter is also handed archived squad names, because a name it does not know is a name it will
publish.

Two refusals, both of which a coach can act on:

- **The last squad.** Archiving it would drop the app to the `Name your squad` first run with a
  full database behind it, which reads as *"my season is gone"*. Add the new team first.
- **A squad mid-session**, for the reasons above.

### There is no delete

Rename covers a name typed wrong; archive covers a team finished with. A hard delete would be the
only control in the app capable of destroying a season in one tap, and `deletePlayerIfUnreferenced`
— the nearest precedent — exists only because an unreferenced player is *provably* not history. A
squad is never unreferenced in any way worth relying on. A coach who genuinely wants a squad gone
exports first and edits the JSON, and that friction is the point.

## Alternatives considered

**Scope everything to a squad chosen per screen.** A squad selector on `/plan`, on `/squad`, on
`/review`. Rejected: it is ADR 0003's argument again. Singleton routes with no dynamic segments
are what let the service worker precache eleven URLs and what keeps Do mode addressable at `/run`.
A squad in the query string would multiply every route and put a decision in front of a coach on
every screen instead of once a week.

**One `Squad` holding several teams as a field.** Cheapest possible change: a `team` tag on each
player. Rejected outright — it is the twenty-six-player roster with extra steps. The corner
balance report, the practice mix and carry-forward all aggregate over a squad, and a tag does not
separate them.

**Let the switch happen mid-run and re-file nothing.** Considered, because the guard is the
fiddliest part of this ADR. Rejected: see above. It is both unsafe and inoperative.

**A header switcher on every screen.** The best UX for a coach with two teams and the worst for
the coach the README describes. Deferred rather than dismissed — see the follow-up.

**Per-squad appearance, or a per-squad periodization flag.** Rejected as a category error. ADR
0008 already settled that whether a coach works from a game model is a fact about the *coach*, and
a club using the methodology uses it for the first team and the academy alike. `Squad.level`
stays the counter-example, and correctly: those eleven-year-olds are eleven whatever the coach
thinks (ADR 0007).

## Consequences

- **Positive:** the two features the app stakes its claim on — the FA 4 Corner reports and
  carry-forward — are correct for a coach with two teams, where before they silently averaged
  across them.
- **Positive:** `Squad`, `activeSquadId` and every `listBySquad` were built for this and finally
  do something. The diff is one repository option, one optional parameter, one service module and
  one Settings panel.
- **Positive:** archiving gives a coach somewhere to put last season without deleting it, which is
  the first honest answer the app has had to *"the season ended"*.
- **Negative:** switching costs four taps, and a coach who switches every Tuesday and Thursday
  will feel every one of them. This is the accepted trade, and the follow-up below is the fix.
- **Negative:** nothing on `/plan`, `/run` or `/review` names the squad. The current squad appears
  on Today and on `/squad` and nowhere else, so a coach who switched and then forgot has two
  screens' worth of warning and no more. A squad name on the plan composer is the cheapest
  mitigation and is not in this change.
- **Negative:** a coach can now accumulate squads, and nothing warns them that two squads called
  `U12` are indistinguishable in the switcher. `ageGroup` and `season` are shown when set, and
  neither is asked for when adding.
- **Negative:** the Settings screen was already the longest in the app (ADR 0008's own closing
  complaint) and is now longer by a panel that is inert for most installs.
- **Follow-up:** the header switcher. Once a coach has actually run two teams for a term, the
  question of whether four taps is too many stops being a guess. The pointer, the guard and the
  scoping are all in place; only the affordance is missing.
- **Follow-up:** `createSquad` asks for persistent storage on the first squad only. A coach whose
  browser refused in September gets no second ask when they add a team in January, which is
  exactly when the heuristics would be most likely to say yes.
- **Follow-up:** archiving a squad leaves its open carry-forward actions open. They are correctly
  invisible — `listOpen` is scoped — but a restore in September will surface a stale nudge from
  March. Deciding whether that is a bug or a feature needs a real archived season to look at.
