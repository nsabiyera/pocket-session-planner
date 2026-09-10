# Review — the app against the checking-for-understanding roadmap

- **Status:** review only. Nothing here is decided and nothing is built. It is input to Phase 0 of
  [`roadmap-checking-for-understanding.md`](roadmap-checking-for-understanding.md), which is where
  the arguments below should be settled or rejected.
- **Date:** 2026-09-10
- **Reviewing:** [`roadmap-checking-for-understanding.md`](roadmap-checking-for-understanding.md)
  (proposed, 2026-09-10) against the app as it stands on `periodization-behind-a-flag`.
- **Position taken:** a check for understanding is two things — **gathering data** and **acting on
  it**. The roadmap is strong on the first and nearly silent on the second, and most of what
  follows is that one observation applied seven times.

## 1. It is a measurement roadmap quoting a formative-assessment paper

The roadmap opens on Black and Wiliam's definition — information used to **modify the teaching
while it is still happening** — and then puts almost every response on `/review`, after everyone
has gone home, or in next Tuesday's carry-forward.

| Phase | Where the coach meets it | Changes anything tonight? |
| --- | --- | --- |
| 1 The player card | Last minute of the session | No — it reports |
| 2 The questioning record | `/review`, and term-level | No |
| 3 Did it stick | `/review` | No |
| 4 `checked` beside `delivered` | **Do mode** | **Yes** |
| 5 The check question | Review, misconception pinned in Do | Half |
| 6 Carry-forward learns from it | Next session | No |
| 7 The player's own word | Do mode / next session start | Half |

Six of seven produce a *record*. One changes what a coach does at the moment it matters.

`describeStyleEvidence` and ball-rolling time are the app's best work precisely because they tell a
coach something invisible from inside the habit — but they are **reflective** instruments, and this
is not a reflective feature. A check for understanding that arrives twenty minutes later is a
memory test for the coach.

**The missing half is the response.** Data with no planned response is just data. What does a coach
do in the forty seconds after a blank answer? The roadmap's only answer is two unticked chips for
next week (Phase 6). The app already owns the response mechanism, and the roadmap never mentions
it:

- `SessionPhase.progressions` / `regressions` (`src/domain/session.ts:99`) — written at plan time;
- `logPracticeAdjustment`, one tap, labelled **"Made it easier" / "Made it harder"**
  (`src/domain/practice.ts:272`), stamped with a STEP letter and already reported by
  `describeAdjustments`.

**A failed check should route straight to the regression the coach already wrote down.** No new
store, no migration, no typing — and it is the difference between this feature and a dashboard.

## 2. Three of the "free" phases are not free

The roadmap's strongest claim is that Phases 1–3 are joins over data already being written. That
claim does not survive contact with the code.

### `InterventionEvent.playerIds` is never populated by anything

`intervention.ts:102` declares it, `state-machine.ts:488` copies it off the command,
`LogInterventionInput` (`run-service.ts:138`) accepts it — and **no UI ever passes it.** The
`✋ Intervene` sheet (`run/page.tsx:826`) has exactly one control: a note field.

So Phase 2's headline sentence cannot be computed. *"12 questions this session, to 4 players. Seven
players were never asked anything"* needs a player picker that does not exist. The minutes report
works because presence is recorded; questioning has no equivalent. **"Free, from data already
logged" is the roadmap's one factual error about its own foundations.**

### `styleChosen` can never be true

`state-machine.ts:468` sets it only when the command carries `method`, `mechanic` or `audience`.
The long-press sheet passes none of them. So `chosen` is permanently 0 and `describeStyleEvidence`
permanently emits *"Every one of these took the style from your plan — tap and hold ✋ Intervene to
record what you actually did instead"* (`coaching-style.ts:177`): instructions for a control that
was never built.

Phase 2 proposes splitting the questioning count on that same flag. It would split 0 / all,
forever. The honesty requirement Phase 2 inherits is a promise the app cannot currently keep — and
that is a bug in shipped code before it is a problem for this roadmap. See
[`known-issues.md`](known-issues.md).

### `Observation.coachingPointId` is never populated either

The observation sheet logs the coaching point's **text** as a tag (`run-service.ts:520`), not its
id, and the log call (`run/page.tsx:589`) passes no `coachingPointId`. Phase 3's join has nothing
to join on. It is recoverable — `normaliseCoachingPointText` already exists and a text match would
work — but that is a change to the **write** path, not a read of existing data.

### And `Observation.text` is empty for every player observation

There is no free-text field on the observation sheet at all. Which decides Phase 1.

## 3. Phase 1 cannot keep its first rule

> **Quote, never summarise.** The card shows what was logged. "Well done today" cannot be produced
> by it.

Structurally right, and unbuildable as specified. What is logged against a player is a token and a
tag, and the tag is *the coach's own pre-written coaching point*. So "one thing you did well"
renders as:

> Good · Head up before you receive

That is the coach's language about the coach's point. It is not evidence about the child, and the
rule was written to prevent exactly this. A player hearing it back learns only that the coach was
watching the thing the coach planned to watch.

Two ways out, and the second is the one to take:

1. **Add the text field.** But Phase 7 is already right that typing pitch-side is the last thing to
   add, and the tap budget is why the app gets used in the rain.
2. **Make the tag carry the player's action rather than the coach's point.** The sheet already
   groups tags by corner and by capability; the missing group is the one that says what happened —
   *did it / tried it / went wrong the way we expected*. Tapping it is the same two taps.

Which makes Phase 5's `commonMisconception` **the most valuable field in the roadmap**, and it is
currently in the second-to-last phase feeding a report. A predicted misconception is only worth
writing down if you can tap it when it appears. It is what turns `struggled` from a shrug into a
diagnosis, and it is the one field that makes the card quotable.

## 4. The app already contains check questions, mistyped

Unmentioned in the roadmap, and it changes Phase 5.

Three presets already ship questions **as coaching points**:

| File | Question shipped as a coaching point |
| --- | --- |
| `presets/constraints-led.ts:70` | *"What did you see?"*, *"What would make that easier?"* |
| `presets/guided-discovery.ts:78` | *"What was stopping you?"*, *"What would you change?"* |
| `presets/whole-part-whole.ts:121` | *"What was different the second time?"* |

And Whole-Part-Whole already ships the **moment** to ask it: a `player_review` phase, thirty
seconds, `intent: "What changed between the first game and the second?"`,
`coachPrompts: ["Let them tell you what changed."]`, planned as `question_and_answer`
(`presets/whole-part-whole.ts:109`). `PhaseKind.player_review` exists in the enum and this one
preset is its only user.

So the app already has the huddle, the question and the intent. What it does with the answer is put
a **✓ next to a thing the coach said**. That is the roadmap's own gap — `delivered` records that
you said it — showing up in a place the roadmap did not look, and it is worse there than anywhere
else, because ticking *delivered* on *"What was stopping you?"* means nothing at all.

**Fix the type before adding a field.** A question is not a coaching point; the tick on one means
something categorically different. Phase 5 proposes `checkQuestion` on all fourteen
`ObjectiveTemplate`s and never reconciles with the five questions already shipped one layer down,
in the *methodology* rather than the objective.

That also answers the roadmap's first open question — *does the check question belong to the
objective or the session?* **Neither. It belongs to the phase**, which is where the app already put
five of them, and where the misconception has to be pinned anyway.

## 5. Phase 4 is the best idea in the document, and it is fourth

*"5 coaching points delivered. 1 checked."* is the ball-rolling time of teaching: one line, one
boolean, and it would change behaviour on its own. It is also a record of a **coach action**, so it
sits entirely inside what the roadmap's §1 permits the app to claim. It should be Phase 1.

On the mis-tap risk the roadmap raises as an open question: **third state on the same chip, not a
long-press.** Make it monotone — `○ → ✓ said → ✓✓ checked → ○` — so a mis-tap over-counts by one
and one more tap corrects it. A long-press is the wrong answer here for a reason the codebase
already demonstrates: the app's existing long-press is documented, reported on, and not wired up.

## 6. Where the roadmap should be pushed back on: "no score, ever" is one word too broad

It is right about Hattie, and right that a comprehension rating of a ten-year-old is person-level
feedback wearing a number. Ban that.

But it then also bans the count that decides what to do next. *"How many of the twelve could name
it"* is not a grade of anybody — it is a fact about the room, and it is the whole purpose of a hinge
question: ask, count, and the count says whether to move on or go again. Phase 5's
`understandingCheck: { before, after }` is already a room-level judgement, just coarsened to four
words and taken once for the whole squad.

**ADR 0009 should draw the line as person-level score (forbidden) versus room-level count (the
point)**, rather than "no score, ever". Otherwise the ADR forbids the arithmetic that makes the
feature act.

Related, and sharper: Phase 5 records the before/after on `SessionReviewSchema` — filled in from
memory, in the car park, once. A hinge question's value is that it is answered **at the hinge**. If
Phase 5 lives anywhere it lives in Do mode, beside the pinned misconception, at one tap.

## 7. Two open questions the code has already answered

- **"Twelve cards in two minutes, on a phone, in the rain."** Not a problem this app has. Do mode
  only offers observation chips for **focus players** (`run/page.tsx:449`) — a non-focus player
  cannot be observed at all. So a card can only exist for the two or three focus players plus
  anyone holding a challenge. Phase 1 is much smaller than the roadmap fears, and the
  swipe-versus-list question mostly dissolves.
- **"Who reads the card out?"** The player does. Having them say it back **is** the check — it is
  the only version of the card that is not the coach talking again — and it is the one the app could
  record honestly, because *"they read it back"* is a fact about what happened. A fourteen-year-old
  may hate it; that is a differentiation question, not a design one.

## 8. Suggested re-ordering

| # | Phase | Why here |
| --- | --- | --- |
| 0 | ADR 0009 | Unchanged, plus the person-level / room-level distinction from §6 |
| 1 | `checked` beside `delivered` *(was 4)* | One boolean, one migration, the line worth having |
| 2 | The predicted misconception, in Do mode *(half of was-5)* | Plan-time field, pinned under the phase name, tappable as an observation tag |
| 3 | A failed check routes to the written regression *(new)* | The response half. Uses `progressions` / `regressions` and `logPracticeAdjustment` as built |
| 4 | The player card *(was 1)* | After 2, so it has something real to quote |
| 5 | Fix the write path, then the reports *(was 2 and 3)* | Player picker on the intervene sheet, `styleChosen` made reachable, `coachingPointId` populated — then these two become the joins the roadmap thinks they already are |
| 6 | Carry-forward and the takeaway *(was 6 and 7)* | Unchanged. Re-test-don't-re-teach is the right closing rule |

## 9. Where the roadmap is simply right

The discipline is better than most published assessment tooling, and none of it should be softened:

- *Never label anything understood.* The Bjork constraint, stated as a constraint on **claims**
  rather than as a caveat.
- Four states, so `not_asked` is distinguishable from `blank` — the `engagement.ts` zero-case rule
  applied correctly.
- *"You logged nothing on it afterwards"* rather than *"it didn't stick"*. That sentence is the
  whole difference between a tool a coach trusts and one they learn to ignore, and the codebase
  earned the right to write it in `engagement.ts`, `challenge/point.ts` and
  `describeRepresentativeness`.
- Silence below a floor, everywhere, with the floor named in the phase.

And the closing note is the most important line in the document: **Phase 1 goes to a real touchline
before Phase 2 gets written.** Hold to that.

One thing to add to that field test. Do not only test whether a coach will read a card out. Test
whether, having asked a question and heard a blank answer, they reach for the thing that makes it
easier. If they do not, the response half never lands, and everything upstream of it is
instrumentation.
