# Roadmap — Teaching Games for Understanding, as a spine the app can evidence

- **Status:** **Phases 0, 1 and 2 built** (2026-09-15). Phases 3–6 proposed. Phase 1 went first,
  ahead of Phase 0, because none of the seven amendments touch it: they all concern fields in
  phases 2–6, and Phase 1 adds no field.
- **Date:** 2026-09-15
- **Decided in:** [ADR 0011](adr/0011-teaching-games-for-understanding.md) (Accepted,
  2026-09-15, **amended 2026-09-15**), which this document sequences. The two disagreed in seven
  places, all about cost rather than direction; Phase 0 collected them and **all seven are now
  recorded in the ADR** as notes beside the decisions they change, with the accepted text kept.
  Where the ADR is not amended, the ADR wins.
- **Reviewed:** [`review-teaching-games-for-understanding.md`](review-teaching-games-for-understanding.md)
  (2026-09-15) — mapped the app against the six stages, found stages 1, 5 and 6 already served
  and stages 2–4 constrained by ADR 0009 §1.
- **Asked for:** *"Start the session from the game problem, not the technique, and be able to
  show whether the thing came back in the game."*
- **Audience:** every squad, at every age group. TGfU was written for eleven-year-olds in a
  school hall, so unlike [ADR 0007](adr/0007-morphocycle-for-adult-squads.md) nothing here is
  gated on the squad being adult.

## The gap, in one line

The app records **what a coach designed** and **what a coach saw**. It does not record **what
game problem the practice was for**, so it cannot tell a coach whether the thing they isolated
ever came back in a game.

Everything downstream of that is the same absence twice: Whole-Part-Whole's own coach prompt
says *"Phase 4 must be the SAME game as phase 2, or you cannot claim transfer"* and nothing
compares the two; and a `technical` phase can be planned with no record of the problem that
justified it, which is precisely the drill-first session TGfU was written against.

## What TGfU is

Bunker and Thorpe's six stages, with the learner in the middle of the diagram and the cycle
returning to the game:

| Stage | What it means here | Where the app stands |
| --- | --- | --- |
| **1 Game form** | A modified game, appropriate to the players | `PracticeSpectrum`, the game phase kinds, `describeSessionShape`. **Served** |
| **2 Game appreciation** | The players understand the rules, because the rules make the problem | Conditions are coach-facing design data. **Not a fact about the players, and cannot become one** |
| **3 Tactical awareness** | Recognising the problem and the principles of play | `GameModel`, four moments, an enforced tree. **Coach-side, and default off** |
| **4 Appropriate decisions** | *What to do*, then *how to do it* | Six core capabilities, `ActionMoment`, `commonMisconception`. **Phases 1, 2 and 5** |
| **5 Skill execution** | Technique, in the service of the game | `unopposed`, `technical`, the `techniques` capability, WPW's PART. **Served** |
| **6 Performance** | The outcome, against criteria set beforehand | `successCriteria` with per-criterion `metCriteria`. **Served better than the model asks** |

And the four pedagogical principles added in 1986:

| Principle | Where the app stands |
| --- | --- |
| **Representation** | `practice/match.ts` compares the practice with the real match on area and numbers. **Phase 3** adds the half it cannot see |
| **Exaggeration** | STEP constraints, and Constraints-Led's restrict / reward / relate. Present; the link to the problem is **Phase 2** |
| **Sampling** | Out of scope across game categories in a football app. The within-football analogue — moment coverage, `practiceMix` — already exists at term scale |
| **Tactical complexity** | The Challenge Point Framework, already in, as progressions and regressions counted and never scored. **Deliberately goes no further** |

## The five problems that decide everything below

### 1. The app can see what a coach recorded. It cannot see a decision.

ADR 0009 §1 is binding and ADR 0011 restates it correctly: records of coach actions, never a
measurement of a player. TGfU's stages 2, 3 and 4 are all assertions about what a learner
appreciates, recognises or decides, and the standard instrument for assessing them — the GPAI —
is a player-scoring observation tool of exactly the kind this app has refused.

So the ceiling for every phase below: **the app may record that an option appeared and what the
player said about it. It may never record that the option was right.** The vocabulary is fixed
here once, the way `engagement.ts` fixed *"players chose something"*.

### 2. Four of ADR 0011's fields already exist under other names

The most expensive mistake available is a second home for a field that already has one. This is
the table Phase 0 has to settle:

| ADR 0011 asks for | Already is | What breaks if both ship |
| --- | --- | --- |
| §2 "opposition behaviour" | `PracticeSpectrum` — unopposed / interference / overloaded / matched_up (`practice.ts:32`) | It forks the only **ordered** axis in the app. `describeSessionShape` and `practiceMix` are both built on that ordering |
| §2 "key rules or conditions" | `PhaseConstraint` — a STEP letter plus the coach's own words, capped at 6 (`practice.ts:244`) | `describeStepCoverage` goes blind to every condition written in the new field |
| §1 "the decision cue" | `coachingPoints` — *"Recognise the moment — do not force it"* | Two places to write the cue, and the chip in Do mode reads one of them |
| §1 "why the decision matters in the game" | `successCriteria`, snapshotted and reviewed per criterion (`review.ts:73`) | It restates the field that already carries the review loop |

`intervention.ts:58` has the house warning for this, written after it happened once: a list kept
in two places is *"exactly how two lists that happen to agree start disagreeing"*.

### 3. Do mode pays for the plan twice, and every phase here adds to the plan

Two halves, and the second one is the one this roadmap nearly missed.

**The observation sheet is closed.** Two taps to log an observation, no typing pitch-side.
ADR 0011 §4 asks for the situation, the option selected, the observable outcome and the player's
explanation — three text fields and a quote, during a game.

Three of the four already have homes: the situation is `actionMoment`, the outcome is
`ratingKind`, and the explanation is `PlayerChallenge.playerWord`'s twin. **Only "the option
selected" is new**, and it becomes a tap rather than a form by riding the route
`commonMisconception` already takes to the sheet (Phase 5).

**And plan-time richness is rendered pitch-side.** This is the coupling that makes a planning
feature a Do-mode feature whether it intends to be or not. Everything authored at plan time that
Do mode shows, today:

| Field | Where Do mode renders it |
| --- | --- |
| `phase.title` | `run/page.tsx:405`, and again on the phase card at `:1329` |
| `session.objective.text` | `:426` |
| `session.objective.commonMisconception` | `:437` — the pinned *Expect* line |
| `phase.coachingPoints` | `:470`–`:480` — the three-state chips |
| `phase.constraints` | `:1398` |
| `phase.progressions` / `phase.regressions` | `:1385` — the adjustment sheet, plus the regression offer at `:262` |

A twelve-field plan is twelve things to read while a game runs, and the two-tap floor for the
app's highest-volume action depends on there being few enough of them to find. **Plan-time
restraint is pitch-side restraint**, and that holds however comfortable the planning was.

**The same coupling fails the other way, twice, in shipped code.** Two plan-time fields are
authored, carried onto the phase and rendered by nothing:

- **`SessionPhase.coachPrompts`** — all five presets write them, 27 strings in total, carried by
  `build-from-methodology.ts:149` under a comment saying Do mode shows them. No screen does.
  Already recorded as [`known-issues.md`](known-issues.md) 4.
- **`SessionPhase.organisation`** — the free-text field ADR 0004 argued hardest for, typed by the
  coach on `/plan/phases:674`, and read back by **no screen at all**: not Do mode, not
  `/sessions/detail`. Found while writing this roadmap and recorded as
  [`known-issues.md`](known-issues.md) 5.

So the observed history of this app is not that plan-time fields overload Do mode — it is that
they quietly never arrive. **The rule this sets for every phase below: name the pitch-side
surface that renders the field, or state that none does and why.** A phase that does neither
ships a sixth write-only field.

### 4. A frozen game form inside a plan-time phase is a third data category

`SessionPhase` is plan-time and freely editable; `Session.run` is evidence. That separation is
one of the three decisions the README says everything else hangs off, and it is what makes
re-planning safe. ADR 0011 §3's frozen game-form snapshot, stored on a phase, would be plan data
that must not change — a third category, in the schema most often rewritten.

A session-level `pairedPhaseId` has a second problem: it means something for one built-in preset
out of five, nothing for a custom methodology, and goes dangling the moment a coach deletes or
reorders a phase. **The pairing is methodology knowledge and belongs on the template** (Phase 4),
which is the argument `defaultSpectrum`'s own docstring already makes about why a per-template
field beats a global `PhaseKind` map: only the methodology that wrote the phases knows which two
are the pair.

### 5. ADR 0008's lesson is not in ADR 0011's decision

ADR 0008 exists because six correct phases put four undocumented screens in front of coaches who
had not asked for them, and its own reasoning was that this was cheap to fix *only because nobody
had used it yet*. ADR 0011 touches `/plan` step 2, the phase editor, the observation sheet,
`/review` and carry-forward — a wider surface than periodization's four screens — and progressive
disclosure appears only in its rejected alternatives.

**Every phase below states what a coach sees on day one**, and the default twenty-second path
takes no new tap in any of them.

## What already exists to build on

More than expected, again. Two of the six phases are joins over data already written:

- **`describeCapabilityCoverage` already emits the tally** — *"9 observations of Kai: 7
  techniques, 2 positioning — nothing on scanning, timing or movement"* (`coverage.ts:141`).
  Phase 1 is one clause on the end of it, and its `subject` parameter is already generic, so a
  player-level and a term-level use come free.
- **`describeMomentCoverage` already ends on *"— nothing before the ball arrives"***
  (`coverage.ts:228`). That is the decision-versus-execution point made directly, on an opt-in
  field, and it is the best TGfU artefact in the app today.
- **`commonMisconception` is the proven rail**: content on the objective template → snapshotted
  onto `Objective` → pinned in Do mode (`run/page.tsx:437`) → tappable as an observation tag →
  read back by `checking.ts` to offer the regression the coach already wrote. Phases 2 and 5 ride
  exactly those rails and add no new mechanism.
- **`defaultSpectrum` on the phase template** is the proven route for a per-phase field seeded at
  zero taps. Phase 3's `defaultTargets` and Phase 4's `pairsWith` are the same shape.
- **`fromTemplateId`** (`session.ts:157`) carries provenance from a phase back to the template
  that generated it. Phase 4's comparison resolves through it rather than through new state.
- **`refineGameModel`** is the precedent for a structural rule enforced in a schema refinement
  rather than a screen. Phase 4's `pairsWith` validation is that rule again, smaller.
- **`describeRepresentativeness`** already prints its own working and shows no number where it
  has no defensible one (`practice/match.ts:131`). Phase 3 adds one clause.
- **`PlayerChallenge.playerWord`** is the only player-authored field in the app and its rules are
  already written — a quote, never parsed, never scored, never aggregated. Phase 5 inherits them
  verbatim rather than restating them.
- **The `describeX` / `hasEnoughForX` + floor convention**, in `coverage.ts`, `balance.ts`,
  `coaching-style.ts`, `engagement.ts` and `practice/mix.ts`. Every line below follows it, and
  every floor is stated in its phase.

**One trap, found by reading.** `cloneMethodology` gives every phase template a fresh UUID on
purpose (`methodology-clone.ts:41`), so a `pairsWith` copied by `structuredClone` would point at
a template id that does not exist in the clone. Phase 4 needs an old → new id remap in that
function, and a refinement that catches it if anyone forgets.

## The phases

Ordered by **what they cost**, not by when the coach meets them — the same order ADR 0009's
phases ended up in. The free ones ship first, because they can be wrong at no cost to the tap
budget, and because the first one is worth having whatever happens to the rest.

### Phase 0 — Amend ADR 0011

> **Done.** All seven are in the ADR, and none was rejected. Two things about *how*, both of
> which follow this repo's habits rather than the obvious route:
>
> - **The accepted text is kept, and each amendment sits beside the decision it changes** as a
>   note, rather than the Decision section being rewritten. Editing it in place would have read
>   more cleanly and destroyed the record of what was actually accepted — the same instinct that
>   keeps ADR 0006 next to ADR 0007 and keeps fixed entries in `known-issues.md`. A reader who
>   stops at §2 still meets the amendment to §2.
> - **Amendments 6 and 7 became new sections rather than notes**, because both asked the ADR to
>   *state* something it did not say at all: §8 what a coach sees on day one, and §9 the render
>   rule. Nothing was amended about §5 or §6, which needed nothing.
>
> One correction to the list below: the ADR's **Implementation sequence** needed a note too, and
> it is not one of the seven. It began at the first new field, with no stage in front of it —
> the roadmap's ordering by cost supersedes it, and Phase 1 is the stage it was missing.

Seven amendments, each argued above. The ADR is Accepted, so this is the phase where they are
settled or rejected rather than quietly implemented differently:

1. **§2 loses "opposition behaviour" and "key rules or conditions"**, which are `spectrum` and
   `constraints`, and says so in the ADR so the next reader does not re-propose them. What
   remains of §2 is direction and targets — Phase 3.
2. **§1 drops from five fields to one.** The tactical problem is new; the cue is `coachingPoints`,
   the reason is `successCriteria`, and the wrong option is `commonMisconception` — which,
   across all fourteen library entries, is already a decision error phrased as *"they think X, so
   they do Y"*.
3. **§3 is re-specified** as a template-level `pairsWith` plus a derived diff over fields both
   phases already carry. No frozen game form on the session, and no `pairedPhaseId`.
4. **§4's four fields become one tap.** The option is a tag, on the rail the misconception already
   runs on. The explanation is `playerWord`'s rules, inherited.
5. **§7 adopts the house silence rule.** Below the floor, show nothing — not *"not enough
   evidence"*. Every other report in the app is silent below its threshold rather than explaining
   its own absence, and a line that appears most weeks saying nothing useful is a line a coach
   learns to scroll past.
6. **The ADR states what a coach sees on day one**, per problem 5, and whether any of it needs a
   flag. The answer this roadmap proposes is that none of it does, because no phase adds a tap to
   the default path — but that belongs in the decision, not in a roadmap.
7. **The ADR adopts the render rule**, per problem 3: a plan-time field arrives with the
   pitch-side surface that shows it, or with a stated reason that none does. Two fields have
   already failed this silently, and ADR 0011 adds four more plan-time fields across §1 and §2
   without naming a surface for any of them.

Phase 0 also fixes the vocabulary once: **problem**, **option**, **appeared**. Not *understood*,
not *correct*, not *transferred*.

### Phase 1 — Execution, against everything else

> **Built, and it was free as promised.** `executionSplit` and `describeExecutionSplit` in
> `capabilities/coverage.ts`, one banner on `/review` behind the existing gate, one rationale
> entry, ten tests. No schema, no migration, no tap, no service change — `ReviewDraftData`
> already carried `capabilityCoverage`. Three corrections this section could not have known:
>
> - **The promised sentence was wrong on its second half.** *"2 were about what he did before
>   the ball came"* is the `ActionMoment` axis, not the capability one — `movement` and
>   `deception` both happen on the ball, so that wording would have described a different
>   field. It ships as *"the other 2 were about the rest of the action"*, which is what the
>   five capabilities actually are.
> - **No `subject` parameter**, unlike both its siblings. The line always renders directly
>   under `describeCapabilityCoverage`, which has already said *"for this session"* and counted
>   them, so carrying the subject twice made one thought read as two reports.
> - **No `hasEnoughForExecutionSplit`, and that is deliberate** rather than an omission. Both
>   banners sit inside one `hasEnoughForCapabilityView` gate: the split is strictly coarser, so
>   a floor good enough for six buckets is ample for two, and a second threshold would be a
>   knob with nothing to tune.
>
> One thing the build made sharper than the plan: the denominator is `coverage.classified`,
> never `coverage.total`. Dividing by everything logged would report the app's own sparse
> attribute mapping back to the coach as *their* blind spot, and there is a test for it.

**Free. No schema, no migration, no tap.** The only TGfU instrument the app can ship without
asking a coach for anything, and it goes first because it tells you whether the rest is aimed at
a problem this coach has.

Five of the FA's six core capabilities — scanning, timing, movement, positioning, deception — are
what-to-do. One, `techniques`, is how-to-do-it. `capabilityCoverage` already counts all six, so
the addition is a derived predicate and one clause:

> *"7 of the 9 were about the execution; 2 were about what he did before the ball came."*

**Floor:** the existing `MIN_OBSERVATIONS_FOR_CAPABILITY_VIEW = 8`. **Home:** `/review`, beside
the capability line at `review/page.tsx:502`.

**Three rules on the wording.**

1. **Never "technical versus tactical".** `capabilities.ts` is explicit that capability *Movement*
   is football movement — shielding, the late run, evading a challenge — which a coach could
   fairly file either side. The defensible split is `techniques` against the other five, phrased
   as *the execution* against *everything around it*, and nothing stronger.
2. **The per-capability tally stays the primary line.** This is an addition. A coach left with
   only the two-way split has lost the report that named the specific blind spot.
3. **No target ratio, ever.** A Command / Direct session on a set-piece routine *should* be all
   techniques. `practice/mix.ts` made this argument already and it applies here unchanged.

### Phase 2 — One field: the tactical problem

> **Built.** `tacticalProblem` on all fourteen library entries, `MAX_TACTICAL_PROBLEM = 120`,
> snapshotted onto `ObjectiveSchema`, carried by both chip paths in `planning-service.ts`,
> recovered by text on a revisited objective, and one pinned `Problem` line in Do mode above
> `Expect`. No migration, no new tap, ten tests. Three things the build settled:
>
> - **Every entry is a question**, and there is a test for it. That was not in the plan and it
>   should have been: ADR 0011 §5 offers this string to the coach as a prompt, so a problem
>   written as a statement would have to be rewritten before it could be asked. *"They press us
>   high. How do we get the ball past their first line without giving it away?"*
> - **The cap is 120 rather than the misconception's 160, and a screen decided it.** These are
>   now the only two blocks in the Do-mode header that grow with the prose, and that header has
>   to leave the two 96px actions on a 667px phone. The CSS comment names this line as the one
>   to cut if the field test fails, because it is the newer of the two and the objective text
>   directly above already states the problem in short form.
> - **`apply-carry-forward` got one lookup instead of two.** It was calling
>   `findObjectiveTemplateByText` inline for the misconception; a second inline call for the
>   problem would have done the same work twice, so the template is now resolved once into a
>   `revisited` local.
>
> A twelfth test earns its place: the problem and the misconception must not be equal for any
> entry. They are different halves — the situation, and what will go wrong in it — and an entry
> where they matched would mean one of the two was wasted.

`ObjectiveTemplate.tacticalProblem`, on all fourteen entries, snapshotted onto `ObjectiveSchema`
beside `commonMisconception` — additive, defaulted, **no migration**, by the route ADR 0009 §8
established for `commonMisconception` and `principleId` before it.

**What a coach sees on day one:** nothing new to fill in. The chip carries it.

**Renders where, per problem 3:** one pinned line in Do mode, beside the *Expect* line the
misconception already occupies (`run/page.tsx:437`) — the same place, the same shape, and the
only plan-time field this roadmap adds to the pitch-side screen. **It replaces nothing and sits
above nothing new**, which is the whole reason the count stays at one field rather than five: two
pinned lines is a header a coach reads, three is a header a coach stops reading.

**Null means the coach did not say.** A coach who types their own objective gets no problem, no
derived question and no transfer line — exactly the treatment `commonMisconception` gets, and for
the same reason: an invented problem is worse than none.

This is the field the next three phases hang off, which is why it comes before the expensive ones.

### Phase 3 — Direction and targets

`SessionPhase.targets`, nullable, four values: `two_goals`, `one_goal`, `lines`, `none`. Seeded by
`MethodologyPhaseTemplate.defaultTargets` exactly as `defaultSpectrum` is, so the default path
costs **no tap**; a coach editing a phase gets a four-across chip row on the screen where they
already set the spectrum and the grid.

It closes the one place in the app where a derived sentence claims more than the record supports.
Today a 4v4 possession box at 20 × 20 and a 4v4 to two goals at 20 × 20 are the same record, and
`describeRepresentativeness` compares both with a 9v9 match on identical terms. One clause fixes
it:

> *"You finished on a matched-up practice at 38 m² a player, to two goals. A U12 match is 9v9 on
> a recommended 73 × 46 m — about 187 m² a player."*

**Two things it is not.** Not opposition behaviour, which is `spectrum`. Not the conditions, which
are `constraints`. Both are stated in the field's docstring so the next reader does not add them
here.

**Renders where, per problem 3:** the phase editor and `/review`, and **deliberately nowhere in
Do mode.** A coach who is standing in the practice can see where the goals are. This is a field
for the representativeness sentence, and the docstring says so, so that nobody later "completes"
Do mode by adding it to the phase card.

### Phase 4 — The Whole-Part-Whole pair

The first phase with real cost, and the one ADR 0011 specified most expensively.

`MethodologyPhaseTemplate.pairsWith: PhaseTemplateId | null`, set on `wpw-whole-2` pointing at
`wpw-whole-1`. Three consequences, all small:

- **`cloneMethodology` needs an old → new id remap** (see the trap above), because it deliberately
  regenerates template ids.
- **`refineTemplates` validates it resolves** within the same methodology — the `refineGameModel`
  tree rule again, one level simpler.
- **The comparison needs no new session state.** The two phases are found through
  `fromTemplateId`, and diffed on what they already carry: `area`, `groupSize`, `spectrum`,
  `constraints`, and `targets` once Phase 3 lands.

> *"The second game is 5 m narrower and has a touch limit the first did not. Transfer is no
> longer a like-for-like comparison."*

**Never block the edit.** ADR 0011 §3 says this and is right: a coach shrinking the pitch because
it is raining has done nothing wrong. The app says what can no longer be compared and keeps both
records. The warning lives in the phase editor and, if the edit survives, as one line on
`/review`.

**What a coach sees on day one:** nothing, unless they are running Whole-Part-Whole and have
edited one of its two games.

**Renders where, per problem 3:** the phase editor, at the moment of the edit, and one line on
`/review`. **Nothing in Do mode** — a warning about last week's comparison, delivered while a
game is running, is the definition of a line a coach learns to dismiss.

### Phase 5 — The option, as a chip

`ObjectiveTemplate.options` — two to four per objective, the choices genuinely available in that
problem — rendered on the observation sheet by the same route `commonMisconception` takes, and
logged the same way: **as a tag**. No new field on `Observation`, no new store, no form.

> *"Kai, working, `went inside` — 12:40 in the practice."*

**Four rules, and the first is the ceiling from problem 1.**

1. **An option tapped records that an option appeared.** Never that it was right. There is no
   correct-option field, no correctness index, and no percentage anywhere downstream.
2. **The list is unordered and the app must not imply otherwise.** A coach reads the first chip as
   the right answer, so the options ship in the order they occur in the game, and the UI must not
   sort, highlight or count them against each other.
3. **A tapped option triggers nothing.** `struggled` plus the *misconception* routes to the
   regression the coach wrote (`checking.ts`); `struggled` plus an *option* deliberately does not.
   An option is not an error.
4. **The player's explanation is `playerWord`'s rules, inherited verbatim** — a quote, never
   parsed, never scored, never aggregated, never read as sentiment.

**Renders where, per problem 3:** the observation sheet, as chips in the row the phase's coaching
points already occupy — so the plan-time field and its pitch-side surface are the same control,
which is the cheapest possible answer to the render rule. **The chip count is the cap.** Two to
four options plus the phase's existing tags has to stay inside a sheet that must be readable at a
glance, so if a coach's objective wants six options, the objective is two objectives.

### Phase 6 — Did it come back in the game

The last phase, and the only one that can be confidently wrong, which is why it is last.

For a session with an isolated `technical` or `skill_practice` phase and a later game phase, the
observations already carry `phaseId` and the tags from Phases 2 and 5. So the app can say where a
tagged action appeared:

> *"'Head up before you receive' — logged twice in the practice, once in the final game."*

Three states, and a fourth that shows nothing:

- logged in the practice **and** in a game phase;
- logged in the practice **only**;
- logged in a game phase **only** — which is the interesting one, and the one a drill-first
  session never produces.

**Below the floor, the line does not appear.** Not *"not enough evidence"* — silence, per Phase 0
amendment 5.

**It reports where a tag appeared and stops.** Not that the skill transferred, not that the player
learned it, not that the practice worked. A coach coaching a point is a coach not logging, and an
absent observation is an absence in the record — the wording rule ADR 0009 phase 3 already
settled, applied to a second join.

## What this roadmap will not build

Stated so it is not quietly attempted later:

- **No decision score, correctness index, option ranking or percentage.** Phase 0 forbids it and
  no later phase reopens it. ADR 0009 §1 and ADR 0011's own rejected alternatives both say so.
- **No second home for conditions or opposition behaviour.** Problem 2 is the whole reason this
  roadmap exists in front of the ADR rather than after it.
- **No frozen game form on a `SessionPhase`.** Problem 4.
- **No blocked edit, anywhere.** The app describes what it can no longer compare.
- **No inference of a tactical problem from `organisation` prose.** ADR 0011 rejects it, ADR 0004
  rejected it first, and `PhaseConstraint`'s docstring rejects it a third time.
- **No TGfU methodology preset.** The six stages are a learning cycle, not a session shape;
  encoding them as one methodology would teach the model wrong. Play-Practice-Play and
  Whole-Part-Whole already deliver the operational half.
- **No claim that this is FA guidance.** The vocabulary is the FA's — spectrum, STEP, six
  capabilities — and the model is Loughborough's. The same honesty the README already applies to
  the four-corner attribute lists applies here.

## Open questions

- **Does the tactical problem belong to the objective or the phase?** On the objective it costs
  nothing and covers the fourteen chips; on the phase it would let a coach put two problems in one
  session, which is usually a mistake and occasionally exactly right.
- **Is `lines` one value or three?** End zones, a target player and a line to dribble over are
  different problems, and four values were chosen to fit a chip row rather than because the game
  has four answers.
- **Should the Phase 4 diff include `constraints`?** Whole-Part-Whole's own prompt says *same
  rules*, which argues yes. But a coach who *removes* a progression they never used has not
  changed the game, and a warning that fires on that is a warning that gets ignored.
- **Do the options survive being unordered in practice?** Rule 2 is a design intention, and a
  touchline will decide whether a coach reads the first chip as the right answer anyway. If they
  do, Phase 5 is the wrong shape.
- **Where does Phase 1's line live at term scale?** `describeCapabilityCoverage` takes a
  `subject`, so the player profile and a term view are both free — but *"most of what you have
  ever logged about Kai is the execution"* is a much heavier sentence than the per-session one, and
  it may need its own floor.
- **Does any of this reach the player card?** *"You had three options and you took the near one"*
  is the most TGfU thing the app could ever say to a player. It is also one step from a verdict,
  which is what the card's four rules exist to prevent.

## Sources

- Bunker, D. & Thorpe, R. (1982). *A model for the teaching of games in secondary schools*.
  Bulletin of Physical Education, 18(1), 5–8. The original six-stage model.
- Thorpe, R., Bunker, D. & Almond, L. (1986). *Rethinking Games Teaching*. Loughborough
  University. Where sampling, representation, exaggeration and tactical complexity are set out.
- Oslin, J., Mitchell, S. & Griffin, L. (1998). *The Game Performance Assessment Instrument
  (GPAI): Development and preliminary validation*. Journal of Teaching in Physical Education,
  17(2). Cited here as the thing this app will **not** build.
- Renshaw, I., Araújo, D., Button, C., Chow, J. Y., Davids, K. & Moy, B. (2016). *Why the
  Constraints-Led Approach is not Teaching Games for Understanding: this is not semantics*.
  Physical Education and Sport Pedagogy, 21(5). Worth reading before any preset claims to be
  either, given the app ships Constraints-Led already.
- [Questioning for learning in game-based approaches to teaching and coaching — Harvey & Light](https://www.researchgate.net/publication/282206187_Questioning_for_learning_in_game-based_approaches_to_teaching_and_coaching)
- [How to design football practices — England Football Learning, 2024](https://learn.englandfootball.com/articles-and-resources/coaching/resources/2024/How-to-design-football-practices)
- [What are The FA's six core capabilities? — England Football Learning, 2023](https://learn.englandfootball.com/articles-and-resources/coaching/resources/2023/What-are-The-FAs-six-core-capabilities)
- [Make coaching personal with the STEP framework — England Football Learning, 2022](https://learn.englandfootball.com/articles-and-resources/coaching/resources/2022/make-coaching-personal-with-the-step-framework)

## What is left, and some of it is not code

- **`docs/user-manual.md` has no section for any of this**, which is the exact hole ADR 0008 was
  written to close. Phase 2 onwards each need a paragraph in the coach's language, and the manual
  is the place the word *problem* has to be introduced before the app uses it.
- **`docs/field-test-checklist.md` needs a line per phase.** Every report here is silent below a
  floor by design, so a broken one looks exactly like a quiet one.
- **Phase 1 goes to a touchline before Phase 2 is written.** It is free, it is the premise of
  everything after it, and if a coach reads *"7 of the 9 were about the execution"* and shrugs,
  then the expensive phases are aimed at a problem this coach does not have — and the honest
  response is to stop at Phase 1.
