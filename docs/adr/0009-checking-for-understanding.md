# ADR 0009 — Checking for understanding: records, not measurements

- **Status:** Accepted
- **Date:** 2026-09-10
- **Roadmap:** [`docs/roadmap-checking-for-understanding.md`](../roadmap-checking-for-understanding.md)
- **Review that shaped it:**
  [`docs/review-checking-for-understanding.md`](../review-checking-for-understanding.md)
- **Relates to:** [ADR 0008](0008-periodization-behind-a-flag.md) (the default-install lesson),
  [ADR 0001](0001-indexeddb-not-drizzle-postgres.md) (why most of this needs no migration)

## Context

The ask: *"As a coach, I want to check what the players understood before, during and after a
session, and give each of them feedback on it."*

`CoachingPoint.delivered` records **that you said it**. Nothing in the model records **that they
got it**, and nothing the app records has ever reached a player. The app measures coach behaviour
to a standard very few tools reach — stoppages, measured ball-rolling time, corner bias,
action-moment bias, chosen-versus-planned style — and measures player *performance* through
challenge tallies and observations. It has no representation of player *understanding* and no
output pointed at the person the session was for.

Everything below exists because that gap cannot be closed honestly by adding a rating. Four
constraints decide the whole feature, and this ADR fixes them once so no later phase has to argue
them again.

## Decision

### 1. Checks are records of coach actions. Nothing is ever labelled "understood"

What is measurable during training is **performance**, and performance is an unreliable index of
learning — Soderstrom and Bjork found manipulations that move the two in opposite directions.
Understanding is not observable, so the app does not claim to observe it.

Three things the app may hold:

| It may hold | It may not hold |
| --- | --- |
| **That a check was made** — a fact about what the coach did | That the player understood |
| **What the player said or showed** — recorded verbatim, never scored | That the behaviour will persist |
| **What happened next** — a fact about the record of the following minutes | That an absent observation means the point did not land |

The vocabulary is fixed here, the way `engagement.ts` fixed *"players chose something"*: the words
**understood**, **comprehension**, **grasped** and **learned** never reach the screen. Every
sentence is scoped to the record, not to the child. Where the record is silent the app says the
record is silent — *"you logged nothing on it afterwards"*, never *"it didn't stick"*.

### 2. No person-level score. A room-level count is not a score

Hattie and Timperley: feedback about the **task** and the **process** works; feedback about the
**person** is the weakest kind and can do harm. A comprehension score in youth football is
person-level feedback wearing a number, and it will be gamed or ignored.

**Forbidden, including derived and including any scale a later screen could average:**

- any rating, percentage or index of one player's understanding;
- any five-point scale attached to a check;
- any ranking or comparison of players on anything to do with a check.

**Permitted, and the point of the feature:**

- **counts of coach actions** — *"5 coaching points delivered. 1 checked."*;
- **counts of the room** — how many of the squad could name the thing, as a whole-squad state.

This is the one place this ADR departs from the roadmap, which said *"no score, ever"*. The
distinction it was missing is that a count of the room is not a grade of anybody: asking, counting
and then deciding whether to move on **is** formative assessment, and a blanket ban would forbid
the arithmetic that makes the feature act. The precedents are already in the codebase —
`practice/mix.ts` and `coaching-style.ts` report counts and refuse to rank — and they are the
model here.

### 3. Data without a response is just data

Black and Wiliam's definition is information used to **modify the teaching while it is still
happening**. So the response is part of the feature, not a later phase of it, and it lives in Do
mode rather than on `/review`.

The app already owns the response mechanism and it is reused rather than rebuilt:
`SessionPhase.progressions` / `regressions` are written at plan time, and
`logPracticeAdjustment` records a change with a STEP letter at one tap, labelled **"Made it
easier" / "Made it harder"**. **A check that comes back blank routes to the regression the coach
already wrote down.** No new store, no new vocabulary, and the existing `describeAdjustments` line
reports it.

Reflective reporting on `/review` still happens, and is still worth having — but a report is the
*second* thing this feature does, not the first.

**Built as an offer bar, not a toast.** A toast that expires while the coach is watching the
drill is a response they never got, which defeats the phase entirely. The bar sits where the
open-intervention bar sits, appears only when all three conditions hold, and clears the moment
the coach makes the practice easier **by any route** — including a change they never planned,
because that is still a response and the app is in no position to call it the wrong one.

**It has no dismiss.** A nudge the coach dismisses is a nudge that did nothing, and this one is
holding up their own sentence rather than the app's opinion. The cost is that a coach who
decides against it carries the bar to the end of the phase. That is a field-test question, not
a design one, and the checklist asks it directly.

**The content already encodes the exception.** Whole-Part-Whole's two WHOLE games and the
Constraints-Led free game ship with no regressions on purpose — adjusting them destroys the
comparison those methodologies exist to make — and `presets.test.ts` pins that. So the offer is
silent in exactly the phases where making it easier would be wrong, without this feature needing
to know why.

### 4. The player-facing boundary

A player card is the first artefact in the app intended for somebody other than the coach. It is:

- **derived, never stored**, so it cannot drift from the evidence;
- **task-level**, describing the action and not the child;
- free of anything a player should not see — no rating of them, no corner-bias report about them,
  no comparison with a teammate;
- **off-device only on a deliberate act**, and not in the export.

No player accounts, no player logins, no two-way app. The card is something the coach shows.

### 5. A question is not a coaching point

The app already ships five check questions — as `defaultCoachingPoints`, in three presets:

| Preset | Shipped as a coaching point |
| --- | --- |
| `presets/constraints-led.ts` | *"What did you see?"*, *"What would make that easier?"* |
| `presets/guided-discovery.ts` | *"What was stopping you?"*, *"What would you change?"* |
| `presets/whole-part-whole.ts` | *"What was different the second time?"* |

Whole-Part-Whole also already ships the moment to ask one: a `player_review` phase, thirty
seconds, `coachPrompts: ["Let them tell you what changed."]`, planned as `question_and_answer`.

Ticking *delivered* on *"What was stopping you?"* means nothing at all, and that is the same gap
this whole ADR is about, one layer down. So the check question belongs to the **phase** — which is
where the app already put five of them — and not to `ObjectiveTemplate`, which is what the roadmap
proposed. This closes the roadmap's first open question.

> **Amended while building phase 2.** As first written, this section swept the *misconception*
> along with the question. It should not have, and the distinction is worth keeping straight:
>
> - **A question is method.** Guided Discovery asks them, Command does not. It varies with *how*
>   you are coaching, which is a property of the phase — and five already ship there.
> - **A misconception is content.** Only the thing being trained can predict how it will be got
>   wrong. A methodology preset does not know the objective, so a `defaultMisconception` on a
>   phase template could only ever be a guess dressed as a prediction.
>
> So `commonMisconception` lives on `ObjectiveTemplate` and is snapshotted onto `Objective`,
> which is what the roadmap proposed for it — and it was right about that one. The check
> question still goes to the phase when it is built.

### 6. What it does to the default install

The lesson ADR 0008 had to learn late: six correct phases still put four undocumented screens in
front of a coach who never asked for them. So this ADR states it up front.

**On by default, with no flag — because the early phases add no screens.**

| Ships on by default | Why it is safe |
| --- | --- |
| A third state on the coaching-point chip | A control the coach already taps, in the same place |
| The misconception line under the phase name | One line, where the intervention plan line already sits |
| The regression prompt after a failed check | An existing sheet, reached the way it already is |
| New `/review` lines | Silent below their floors, like every other derived line |
| New carry-forward proposals | Unticked, like the 4 Corner and challenge-point nudges |

**Gated separately when it lands: the player card.** It is a new screen, it is the first
player-facing artefact, and it is the one item here whose shape is a field-test question rather
than a design one. Its gate is decided in its own phase, when there is something real to gate.

No `AppMeta` flag for the set as a whole. A flag would put the thing the coach actually asked for
behind a Settings toggle they have to find first, and — unlike periodization — this feature has
no audience narrower than "every squad, at every age group".

### 7. Phase order

Reordered from the roadmap on the review's argument, which is that the roadmap front-loads the
phases that only *report*:

| # | Phase | Costs |
| --- | --- | --- |
| 1 | `checked` beside `delivered` | One field pair, one chip state, one review line |
| 2 | The predicted misconception, in Do mode | One plan-time field, one pinned line, one tag |
| 3 | A failed check routes to the written regression | No new store, no new field — one derived offer over the existing adjustment path |
| 4 | The player card | Derivation plus one component, gated |
| 5 | Fix the write path, then the questioning and did-it-stick reports | See below |
| 6 | Carry-forward learns from it, and the takeaway | Two rules, two rationales |

**Phase 5 is where the roadmap was wrong about its own foundations.** It called the questioning
record and the intervention → observation join "free, from data already logged". They are not:
`InterventionEvent.playerIds` and `Observation.coachingPointId` are declared, plumbed and **never
written by any UI**, and `styleChosen` can never be true because the long-press sheet it depends
on was never built. Those are shipped bugs, tracked in
[`docs/known-issues.md`](../known-issues.md), and they are prerequisites rather than parts of this
feature.

### 8. Most of this needs no migration

The roadmap says Phase 1 costs `DB_VERSION` 5 → 6 on the sessions store. It does not.
`DB_VERSION` is bumped **only when stores or indexes change** (`data/idb/schema.ts`); document
*shape* changes ride `RecordMeta.schemaVersion` and are applied lazily on read. An additive field
with a zod `.default()` needs neither: it is the route `principleId`, `styleChosen` and ADR 0005's
`kind` / `match` all took, and an old session parses with the default.

**Old sessions therefore read as unchecked**, which is the honest value for them — nobody can now
say whether those points were checked. Same reasoning `styleChosen` records for its own default.

## Alternatives considered

**A third axis on the observation sheet — *did they understand it* — beside `good / working /
struggled`.** Rejected. It would break the two-tap floor on the app's highest-volume action, and
the value would not survive a coach who stops logging. The observation sheet is closed to new
required decisions.

**A comprehension rating, kept private to the coach.** Rejected on §2. A number that exists is a
number that gets averaged, exported and eventually shown to somebody; the honest version of "how
did Kai do" is the quote and the tally the app already holds.

**Infer understanding from performance** — treat a `good` observation after a coaching point as
evidence the point landed. Rejected on §1. It is the Bjork constraint, and it is the single most
tempting mistake available here.

**A quiz.** A question in a huddle is coaching. A multiple-choice question rendered on a phone in
the rain is an app that has lost the plot.

**`checkQuestion` on `ObjectiveTemplate`, all fourteen entries.** Rejected on §5 — it would add a
fifteenth home for a question while five already sit in the presets, mistyped. The objective is
also the wrong grain: one session has one objective and five phases, and the check belongs where
the practice is.

**Behind a flag, like ADR 0008.** Rejected on §6. The periodization set was gated because it was
built for a narrower audience than the app's and added four screens; this is the app's own stated
ask and adds none until the card.

## Consequences

- **Positive:** the vocabulary is settled once. No later phase has to relitigate whether a line
  may say "understood", and a reviewer can check any new sentence against §1 alone.
- **Positive:** Phase 1 is much cheaper than the roadmap costed it — no migration, no store
  change, and the highest-value line in the feature ships first.
- **Positive:** the response half exists. Without §3 this would have been seven phases of
  instrumentation with the coach's actual next move left to them.
- **Negative:** §2's distinction is a fine one, and it is the sentence in this ADR most likely to
  be misread by a future phase. A room-level count is one tap away from a per-player one, and
  nothing but review stops that drift.
- **Negative:** §5 means five shipped presets carry questions in the wrong field. Fixing the type
  is a change to content coaches may already be using, and it is not free.
- **Negative:** on-by-default means every coach meets the `checked` chip state whether they wanted
  a check-for-understanding feature or not. The mitigation is that it is one extra state on an
  existing control and it does nothing if never tapped — but it is still a change to the most
  used screen in the app.
- **Follow-up:** `docs/user-manual.md` needs the before / during / after framing rather than a
  list of screens, and `docs/field-test-checklist.md` needs a section per phase — every line here
  is silent below a floor by design, so a broken one looks exactly like a quiet one.
- **Follow-up:** the one thing no phase can supply is whether a coach on a wet Tuesday will
  actually ask, hear a blank answer, and then reach for the thing that makes it easier. Phase 3
  goes to a real touchline before Phase 4 is written.
