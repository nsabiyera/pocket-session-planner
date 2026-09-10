# Roadmap — checking for understanding, and feedback to players

- **Status:** **building, in the order [ADR 0009](adr/0009-checking-for-understanding.md) sets
  rather than the one below.** Phase 0 is written and accepted. Built so far: the `checked` state
  and its review line (ADR 0009 phase 1, "Phase 4" below), and the predicted misconception —
  pinned in Do mode and tappable as an observation tag (ADR 0009 phase 2, half of "Phase 5"
  below). The ADR supersedes this document wherever the two disagree — on the phase order, on
  where the check question lives, on the scoring rule, and on what a phase costs.
- **Date:** 2026-09-10
- **Reviewed:** [`review-checking-for-understanding.md`](review-checking-for-understanding.md)
  (2026-09-10) — argued for a different phase order, and found that three of the phases called
  free are not, because the fields they read are never written. Settled in
  [ADR 0009](adr/0009-checking-for-understanding.md).
- **Asked for:** *"As a coach, I want to check what the players understood before, during and after
  a session, and give each of them feedback on it."*
- **Audience:** every squad, at every age group. Unlike
  [ADR 0007](adr/0007-morphocycle-for-adult-squads.md), nothing here is gated on the squad being
  adult — a check for understanding is more valuable at U9 than at U21, not less.

## The gap, in one line

`CoachingPoint.delivered` records **that you said it**. Nothing in the model records **that they
got it**, and nothing the app records has ever reached a player.

The app measures coach behaviour to a standard very few tools reach — stoppages, measured
ball-rolling time, corner bias, action-moment bias, chosen-versus-planned style. It measures
player *performance*, through challenge tallies and observations. It has no representation at all
of player *understanding*, and no output pointed at the person the session was for.

## What checking for understanding is

Formative assessment, in the sense Black and Wiliam gave the term: activities that produce
information used to **modify the teaching while it is still happening**. Not a test, not a grade —
the loop the app already calls Plan → Do → Review, run at the scale of a single coaching point
instead of a whole session.

| Idea | What it means here |
| --- | --- |
| **Formative assessment** | Information gathered *during* the work and used to change it. The app already does this for the coach's own behaviour; it does not do it for the players' learning. |
| **The check question** | One question, planned in advance, asked before and after — *"when they press us high, where's the space?"* The value is the **shift** between the two answers, not either answer. |
| **The predicted misconception** | What you expect to go wrong, written before it does. Teachers plan against the misconception; it is what makes a `struggled` observation interpretable rather than merely negative. |
| **Performance ≠ learning** | Soderstrom and Bjork: performance during training is an unreliable index of whether learning happened, and some manipulations move the two in *opposite* directions. This is the constraint that decides what the app may claim. |
| **Retrieval practice** | Being asked to recall a thing does more for retention than being told it again. Roediger and Karpicke: 61% recall after a week for retrieval versus 40% for restudy. The coaching translation is **re-test, don't re-teach**. |
| **Feedback levels** | Hattie and Timperley: feedback about the **task** and the **process** works; feedback about the **person** is the weakest and can be negative. Their three questions — where am I going, how am I going, where to next — are literally the three lines of a player card. |
| **Questioning** | In game-centred coaching, questioning is the mechanism by which understanding is developed *and* revealed. The FA's Five Pillars already name it; the app already logs it and reads it as nothing. |

## The four problems that decide everything below

### 1. The app can see performance. It cannot see understanding.

Every fact in the database is a behaviour a coach observed, or a thing a coach did. Understanding
is not observable, and the literature that matters here says so explicitly: what is measurable
during training is performance, which is an unreliable index of learning.

**So the app must never label anything "understood".** What it can honestly hold is:

- *that a check was made* — a fact about the coach's action;
- *what the player said or showed* — a quote or a three-state answer, recorded, not scored;
- *what happened next* — a fact about the record of the following minutes.

This is the same discipline `engagement.ts` already applies to autonomy: record the fact, refuse
the feeling, and never let the word onto the screen. Every sentence in every report below is
scoped to the record, not to the child.

### 2. A check for understanding costs taps the app has already spent

Two taps to log an observation. Twenty seconds from squad home to a running session. No typing
pitch-side. Those are not aspirations, they are the reason the app gets used in the rain, and
every proposal here competes against them.

So the rule for this whole roadmap: **derive first, ask second, and never on the observation
sheet.** Three of the seven phases add no pitch-side taps whatsoever — they read data the app has
been writing all along and has never once looked at. Those go first, deliberately, because they
are free.

The observation sheet in particular is closed. A third axis — *did they understand it* — beside
`good / working / struggled` would break the two-tap floor for the app's highest-volume action,
and the value would not survive a coach who stops logging.

### 3. Nothing has ever left the device toward a player

The app is single-user by construction: no account, no server, no signal, and the crash-report
redaction shows exactly how seriously it takes the boundary — player names are stripped before
the coach even sees the report.

A player card is the **first artefact in the app intended for somebody other than the coach**.
That deserves its own rules rather than being smuggled in as a screen:

- it is **derived**, never a stored document, so it cannot drift from the evidence;
- it carries **nothing a player should not see** — no five-point rating of them, no corner-bias
  report about them, no comparison with a teammate;
- it leaves the device only when the coach deliberately makes it leave.

### 4. Feedback that is a grade stops being feedback

Hattie and Timperley's finding is that feedback aimed at the person is the weakest kind and can
do harm; task-level and process-level feedback is what moves learning. A comprehension score in
youth football is person-level feedback wearing a number, and it will be either gamed or ignored.

**So: no scores anywhere in this roadmap.** No understanding rating, no comprehension percentage,
no "learning" figure. The app's own precedent is already right — `practice/mix.ts` and
`coaching-style.ts` report counts and refuse to rank.

## What already exists to build on

More than expected, again. Most of the first three phases are joins over data already being
written:

- **`InterventionEvent` is already a questioning record.** It carries
  `method: 'question_and_answer'`, `playerIds`, `phaseElapsedMs` and `coachingPointId`. Every
  question a coach logs is already stored with who it went to. **Nothing reads it as questioning.**
- **Observations already carry `phaseElapsedMs` and `coachingPointId`.** So "you coached this point
  at 4:10, and here is what you logged about it afterwards" is a join over two existing stores,
  needing no new field and no new tap.
- **`CoachingPoint.delivered` / `deliveredAt`** is the delivery half of the check. The checked half
  is one boolean beside it.
- **`ObjectiveTemplate.successCriteria`** is the proven pattern for shipping content with an
  objective — the app's biggest typing-eliminator. `checkQuestion` rides exactly those rails.
- **`FocusPlayerReview.nextStep`** is already the one-sentence next step, already carried verbatim
  into the next session's focus-player action. It is the third line of the player card, written.
- **`ObservationKind` already separates `effort` from `strength`.** That is close enough to
  Hattie's task/process/person split to keep a card honest: praise the effort, name the task.
- **`engagement.ts` already declares its own design intent** — *"Designed for a player-facing view
  later. `playerChoice` is a fact about the phase, not a rating of the coach, so a read-only
  summary shared with a player or a parent can include it without anything here needing a
  rewrite."* Phase 1 is that view.
- **`carry-forward` plus `rationale.ts`** is a proposal engine with a *mandatory* explanation per
  trigger, enforced by `rationale.test.ts`. A new rule is a rule and a sentence, and the test fails
  if you skip the sentence. Both new rules in Phase 6 reuse existing `CarryForwardKind`s
  (`coaching_point`, `reminder`), so no kind is added and no stored proposal changes shape.
- **`minutes-report.tsx` is the tone.** Least-played first, the ones who never got on at the top,
  no target and no warning, *"you are the one who knows a player arrived late"*. The questioning
  spread in Phase 2 is the same report about a different scarce resource.
- **The `describeX` / `hasEnoughForX` + floor convention** exists in `coverage.ts`,
  `balance.ts`, `coaching-style.ts` and `engagement.ts`. Every line below follows it, and every
  floor is stated in its phase.

## The phases

Ordered by **what they cost**, not by when the coach meets them. The free ones ship first,
because they are the ones that can be wrong at no cost to the tap budget, and because two of them
are worth having on their own.

### Phase 0 — Write ADR 0009 first

The scope decision above *is* the design, and it is contentious enough to be argued before any
code. It must state plainly:

- **What the app may claim.** Checks are records, not measurements. Nothing is ever labelled
  understood. The vocabulary is fixed here, once, the way `engagement.ts` fixed *"players chose
  something"*.
- **No score, ever.** Including no derived one, and including no five-point scale that a future
  screen could quietly average.
- **The player-facing boundary.** Derived, read-only, task-level, nothing a player should not see,
  and off-device only on a deliberate act.
- **What it does to the default install.** The lesson ADR 0008 had to learn late: six correct
  phases still put four undocumented screens in front of a coach who never asked for them. The
  player card is a new screen and the check question is a new control on the create flow, so
  this ADR states up front which of the seven phases change what a coach sees on day one — and
  whether any of it belongs behind a flag of its own.
- **What this is and is not.** The FA's own *How We Coach* sets individual and group learning
  objectives and asks for concise feedback and individual discussions at half time, so the
  direction is consistent with the models the app already implements — but the check question, the
  misconception field and the player card are **this app's constructions**, not FA guidance. Same
  honesty the README already applies to the four-corner attribute lists.

### Phase 1 — The player card

**The thing the request is actually about, and it needs no new data.** A read-only, derived,
one-player, one-session view the coach shows or reads out in the last minute:

- **your challenge, and how it went** — the ask verbatim, the tally or the verdict;
- **one thing you did well** — a `good` observation, quoted, with its tag;
- **one thing to work on** — a `working` or `struggled` observation, quoted;
- **your next step** — `FocusPlayerReview.nextStep`, one sentence, capped at one.

Hattie and Timperley's three questions in order, which is not a coincidence and should be noted in
the code. Four rules the card's *shape* enforces, so the coach cannot easily do it badly:

1. **Quote, never summarise.** The card shows what was logged. "Well done today" cannot be
   produced by it.
2. **One thing forward.** A player given three things has been given none. The cap is structural,
   not advisory.
3. **Task, not person.** The copy describes the action. `ObservationKind.effort` is used where it
   exists, because effort is what a player can act on next week.
4. **Silence over invention.** A player with nothing logged gets a card that says so — *"nothing
   logged for Kai today"* — which is the same omission `/review` already flags for focus players,
   made actionable instead of merely reproachful.

Pure derivation: no store change, no migration, no new tap. `src/domain/player-card.ts` plus one
component.

### Phase 2 — The questioning record

Free, from data already logged. Two lines on `/review`, and a term-level version beside
`coaching-style.ts`:

> *"12 questions this session, to 4 players. Seven players were never asked anything."*

The minutes report, for questions. Least-asked first, the never-asked at the top, no target and no
warning — a coach may have excellent reasons, and the app is in no position to know them.

**One honesty requirement, inherited.** `✋ Intervene` pre-fills `method` from the plan, so a
questioning count built naively is the coach's own plan read back to them as evidence. The report
must split on `styleChosen` exactly as `describeStyleEvidence` already does, and say which half is
which. A floor in the manner of `MIN_INTERVENTIONS_FOR_STYLE`, and silence below it.

### Phase 3 — Did it stick

The intervention → observation join. Still free, and the first phase that can be *confidently
wrong*, which is why it comes third rather than first.

> *"You coached 'head up before you receive' at 4:10. You logged it working at 5:30."*

and the case that earns the feature:

> *"You coached it three times. You logged nothing about it afterwards."*

**The wording is the whole phase.** An absent observation is an absence in the *record*, not
evidence the behaviour did not appear — a coach coaching a point is a coach not logging. So the
line says *"you logged nothing on it afterwards"* and never *"it didn't stick"*, and the feature
name in the UI must not promise more than that. Same class of decision as
`describeRepresentativeness` showing no number where it has no defensible one.

### Phase 4 — `checked` beside `delivered`

> **Built, and it went first.** See [ADR 0009](adr/0009-checking-for-understanding.md) §7 for why,
> and §8 for the correction below: **there is no migration.** `DB_VERSION` is bumped only for
> stores and indexes; an additive field with a default rides `RecordMeta.schemaVersion` and is
> applied lazily on read, which is the route `principleId` and `styleChosen` both took. The chip
> also has three states rather than two, because `planned` has to stay reachable for a mis-tap.

The first phase that costs a tap and a migration (`DB_VERSION` 5 → 6, the sessions store).

`CoachingPoint` gains `checked: boolean` and `checkedAt`, beside the existing `delivered` pair. A
point is *checked* when the coach asked someone to say it back or show it back. The chip in Do mode
becomes two states rather than one: **said it → checked it**.

Review gains one line, and it is as sharp as ball-rolling time:

> *"5 coaching points delivered. 1 checked."*

Old sessions read as unchecked, which is the honest value for them — nobody can now say whether
those points were checked. Precisely the reasoning `styleChosen` records for its own default.

### Phase 5 — The check question, before and after

> **The misconception half is built, and it went second.** `commonMisconception` is on all
> fourteen `ObjectiveTemplate`s, snapshotted onto `ObjectiveSchema`, pinned in Do mode and
> offered as an observation tag — which is the part this section did not anticipate, and the part
> that makes a `struggled` observation interpretable. See
> [ADR 0009](adr/0009-checking-for-understanding.md) §5, which was amended to keep the
> misconception on the objective (content) while the check question goes to the phase (method).
>
> Two corrections to what remains below. `understandingCheck` on `SessionReviewSchema` records
> the before/after **from memory in the car park** — ADR 0009 §2 argues it belongs in Do mode, at
> the hinge, at one tap. And the `checkQuestion` half still has to reconcile with the five
> questions already shipped as `defaultCoachingPoints` in three presets.

The only phase that records anything about the players' understanding, and therefore the one most
tightly governed by ADR 0009.

- `checkQuestion` and `commonMisconception` on `ObjectiveTemplate` — all fourteen entries, so the
  default path stays typing-free, exactly as `successCriteria` and `coachingPoints` do today.
- Snapshotted into `ObjectiveSchema` on build, nullable and defaulted, so every stored session
  parses unchanged and a coach who writes their own objective is never blocked for want of a
  question.
- `understandingCheck: { before, after }` on `SessionReviewSchema`, each
  `not_asked | blank | partly | named_it`.
- The misconception shows at plan time **and** pinned in Do mode under the phase name — same
  reasoning as the intervention plan line: the point of writing it down is being reminded of it at
  the moment it matters.

**Report the shift, never a score.** *"Blank at the start; most of them named it at the end."*
Four states rather than three because `not_asked` must be distinguishable from `blank` — the
`engagement.ts` zero-case rule, restated: an untouched control is a fact about the record, never a
verdict on the players.

### Phase 6 — Carry-forward learns from it

Two rules in `derive-carry-forward.ts`, two sentences in `rationale.ts`, both proposals **unticked**
like the four-corner and challenge-point nudges:

1. **Checked, and it landed → re-test, don't re-teach.** *"Ask them again on Tuesday."* This is
   retrieval practice, and it is the rule that makes the whole roadmap worth building: without it,
   a checked point is a fact in a database.
2. **Delivered three sessions running, never once checked.** The exact complement of the existing
   *"chased the same point three sessions running"* warning. That one says *you keep saying it*;
   this one says *you never found out whether they heard you*.

Last of the building phases because it consumes what 4 and 5 produce.

### Phase 7 — The player's own word, and the takeaway

The honest missing half, and the only place the app gains player-authored data.

- **One optional field on a challenge: *"what did they say about it?"*** Stored as a **quote**, never
  parsed, never scored, never aggregated. It turns a verdict into a conversation and gives the app
  the single piece of player data it can legitimately claim to hold.
- **The takeaway.** One sentence the coach leaves the players with, stored, and read back at the
  *start* of the next session: *"Last week you told them: …"* — symmetric to the existing *"Last
  time you said…"*, but pointed at the players instead of the coach. This is what turns a planning
  loop into a learning loop.

Last because it is the only phase that adds a keyboard to a pitch-side flow, and it must therefore
be entirely skippable.

## What this roadmap will not build

Stated so it is not quietly attempted later:

- **No comprehension score.** Not a rating, not a percentage, not a derived average. Phase 0 forbids
  it and no later phase gets to reopen it.
- **No inference of understanding from performance.** The app may report that a behaviour appeared;
  it may not conclude that a player understood. That is the Bjork constraint and it is not
  negotiable.
- **No quiz.** A question in a huddle is coaching. A multiple-choice question rendered on a phone in
  the rain is an app that has lost the plot.
- **No player accounts, no player logins, no two-way app.** The card is something the coach shows.
  Adding a second user would cost the entire architecture (ADR 0001, ADR 0002) for a feature nobody
  asked for.
- **No sentiment or wellbeing tracking** from the Phase 7 quote. It is a quote. Anything read *out*
  of it beyond the words would be exactly the fabricated evidence `engagement.ts` refuses.
- **No relatedness proxy.** Restating `engagement.ts` rule 2, because a player card is precisely
  where the temptation to build one will next appear.
- **No claim that this is FA methodology** beyond what *How We Coach* actually says.

## Open questions

- **Does the check question belong to the objective or the session?** Shipping it on the template
  keeps the create flow free, but a coach who types their own objective gets no question — and that
  is the coach most likely to be working on something they have not thought through.
- **Is the card per session or per term?** A player handed a card every week that repeats the same
  next step is being told, weekly, that they have not moved. A term card is a different object with
  different arithmetic.
- **Who reads the card out?** Having a player read their own back is a stronger check than being
  told — and it is a check the app could record. It is also a thing a fourteen-year-old may hate.
- **Twelve cards in two minutes, on a phone, in the rain.** A per-player card the coach swipes
  through may be the wrong shape entirely; one huddle screen listing a line per player may be
  right. This is a field-test question, not a design-review one.
- **Third state on the delivered chip, or a long-press?** The tap budget says third state; the risk
  is a mis-tap recording a check that never happened, which would poison the one line in Phase 4
  worth having.
- **Does any of this go in the export?** The card is derived, so no. But a coach who wants to hand a
  parent something at the end of a term wants a term card, and that is the first thing the app would
  ever produce *for* a third party.

## Sources

- [Inside the Black Box: Raising Standards Through Classroom Assessment — Black & Wiliam, 1998](https://kappanonline.org/inside-the-black-box-raising-standards-through-classroom-assessment/)
- [The Power of Feedback — Hattie & Timperley, *Review of Educational Research*, 2007](https://journals.sagepub.com/doi/abs/10.3102/003465430298487)
- [Learning Versus Performance: An Integrative Review — Soderstrom & Bjork, 2015](https://journals.sagepub.com/doi/abs/10.1177/1745691615569000)
- [Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention — Roediger & Karpicke, 2006](https://journals.sagepub.com/doi/10.1111/j.1467-9280.2006.01693.x)
- [Questioning for learning in game-based approaches to teaching and coaching — Harvey & Light](https://www.researchgate.net/publication/282206187_Questioning_for_learning_in_game-based_approaches_to_teaching_and_coaching)
- [Sports Coaches' Knowledge and Beliefs About the Provision, Reception, and Evaluation of Verbal Feedback](https://pmc.ncbi.nlm.nih.gov/articles/PMC7522355/)
- [How We Coach — The Boot Room, England Football](https://www.thefa.com/bootroom/resources/england-dna/how-we-coach)
- [The FA 4 Corner Model](https://learn.englandfootball.com/articles-and-resources/coaching/resources/2022/the-fa-4-corner-model)

## What is left, and some of it is not code

- **`docs/field-test-checklist.md` needs a section per phase.** Every report here is silent below a
  floor by design, which means a broken one looks exactly like a quiet one — the failure mode the
  existing checklist was written for.
- **`docs/user-manual.md` needs the player card written up in the coach's language**, and the
  before/during/after framing is a better spine for that section than a list of screens.
- **The one thing no phase can supply.** Whether a coach in the last two minutes of a wet Tuesday
  will actually read a card out to twelve players. If they will not, Phase 1 is the wrong shape and
  everything downstream of it is decoration — so Phase 1 goes to a real touchline before Phase 2
  gets written.
