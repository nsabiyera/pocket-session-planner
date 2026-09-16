# Review — the app against Teaching Games for Understanding

- **Status:** review only. Nothing here is decided and nothing is built.
- **Date:** 2026-09-15
- **Reviewing:** the app as it stands on `several-squads` against Bunker & Thorpe's six-stage
  model (*A model for the teaching of games in secondary schools*, Bulletin of Physical
  Education 18(1), 1982) and the four pedagogical principles added later by Thorpe, Bunker &
  Almond (1986) — sampling, representation, exaggeration, tactical complexity.
- **Position taken:** the app is already a competent TGfU instrument, by inheritance rather
  than by intent, at three of the six stages. The other three are claims about what a
  *learner understands*, and [ADR 0009](adr/0009-checking-for-understanding.md) §1 has already
  ruled those out of scope. So most of what follows is a mapping, one finding worth building,
  and five things worth naming and refusing.

The app cites the FA, not Loughborough: the practice spectrum, the Five Pillars, the six core
capabilities and *How to design football practices* are all England Football publications, and
all of them are TGfU's descendants. Nothing below asks the app to change vocabulary. Where a
stage is well served it is served in the FA's words, which are the right words for this user.

## 1. The six stages, against the code

| Stage | Where it lives | Verdict |
| --- | --- | --- |
| **1 Game form** | `PracticeSpectrumSchema` (`domain/practice.ts:32`), `PhaseKind` `small_sided_game` / `conditioned_game` / `game`, Play-Practice-Play opening on a game and Whole-Part-Whole reaching one before it coaches anything, `describeSessionShape` (`practice.ts:162`) | **Strong, and reported** |
| **2 Game appreciation** | `PhaseConstraint` — a STEP letter plus the coach's own words; `MAX_CONSTRAINTS_PER_PHASE = 6` (`practice.ts:251`); `organisation` free text | **Absent as a fact about the players** |
| **3 Tactical awareness** | `GameModel` — four moments, an enforced macro → sub tree (`game-model.ts:135`), `momentsWithoutPrinciples`; `ObjectiveTheme` keyed to `Moment` (`objectives.ts:74`) | **Present, coach-side, default off** |
| **4 Appropriate decisions** | `CoreCapability` ×6 (`capabilities.ts:22`), `ActionMoment` before/during/after (`capabilities.ts:82`), `commonMisconception` (`objectives.ts:40`) | **The finding — §3** |
| **5 Skill execution** | `unopposed` spectrum, the `technical` phase kind, the `techniques` capability, Whole-Part-Whole's PART, the Command / Direct preset | **Fully served** |
| **6 Performance** | `metCriteria`, per success criterion (`review.ts:73`), `ObjectiveOutcome`, challenge `met` / `partly` / `missed`, `followUpSummary` | **Better than the model asks** |

Stage 6 deserves a note. Bunker & Thorpe ask for performance judged against criteria
independent of the learner; the app stores up to five success criteria on the objective and
records which ones were met *individually*, then carries the unmet ones forward
(`unmetCriteria`, `review.ts:108`). That is more than the 1982 paper specifies and more than
most session planners attempt.

## 2. The app's first rule removes the middle of the model

ADR 0009 §1: records of coach actions, **never a measurement of a player**. Stages 2, 3 and 4
are all assertions about what a learner appreciates, recognises or decides — and the standard
instrument for assessing them (the GPAI: Oslin, Mitchell & Griffin, 1998) is a player-scoring
observation tool of exactly the kind this app has already refused.

So "review the app against TGfU" mostly resolves to one sentence: **the app may record what
the coach did about understanding, and never what the players have.** That is already the
shape of `coachingPointState` (`coaching-point.ts:76` — planned → said → **checked**) and of
`questioning.ts`, whose whole preamble is about not reading a plan back as evidence.

Nothing in this review argues for changing that. It is the right rule twice over: the app
holds notes about children, and its own evidence standard could not support a claim about
understanding even if safeguarding allowed one. What follows is what remains available.

## 3. The finding — five of the six capabilities are decisions, one is execution, and the app never says so

This is the only TGfU-specific instrument the app can build without asking a coach for
anything at all.

TGfU's central empirical claim about coaching behaviour is that coaches watch the execution and
miss the decision that preceded it. The app already holds the axis that shows it. Of the FA's
six core capabilities, five — **scanning, timing, movement, positioning, deception** — are
what-to-do, and one — **techniques** — is how-to-do-it. `capabilityCoverage`
(`capabilities/coverage.ts:65`) already counts all six, and `describeCapabilityCoverage`
already emits:

> *"9 observations of Kai: 7 techniques, 2 positioning — nothing on scanning, timing or
> movement."*

Every part of that sentence is present except the one grouping a TGfU coach would ask for. The
addition is a derived predicate over `countByCapability` and one extra clause:

> *"7 of the 9 were about the execution; 2 were about what he did before the ball came."*

**Cost:** no schema field, no migration, no new store, no extra tap, and the sample-size floor
already exists (`MIN_OBSERVATIONS_FOR_CAPABILITY_VIEW = 8`, `coverage.ts:63`). It is the
cheapest honest line available since ball-rolling time.

**Three constraints on the wording, if it is built.**

1. **Never "technical versus tactical".** `capabilities.ts` is explicit that capability
   *Movement* is football movement — shielding, the late run, evading a challenge — which a
   coach could fairly file either side. The defensible split is `techniques` against the other
   five, phrased as *the execution* against *everything around it*, and nothing stronger.
2. **The per-capability tally stays the primary line.** The grouped sentence is an addition. A
   coach who sees only the two-way split has lost the report that named the specific blind
   spot.
3. **No target ratio, ever.** A Command / Direct session on a set-piece routine *should* be all
   techniques. The app has no standing to call that wrong — `practice/mix.ts` already made this
   argument for the practice mix, and it applies here verbatim.

The same move is **not** needed on the `ActionMoment` axis: `describeMomentCoverage`
(`coverage.ts:228`) already ends on *"— nothing before the ball arrives"*, which is the
decision-versus-execution point made directly, on an opt-in field, with a lower threshold
because the coach volunteered it. That line is the best TGfU artefact in the app today.

Worth recording alongside it: the fourteen `commonMisconception` entries in `objectives.ts:86`
are almost all *decision* errors — *"They think forward is always better, so the pass goes in
whether it is on or not"*, *"They think playing out means never going long"*. That is stage-4
content, written for stage-4 reasons, shipped before anybody mentioned Bunker and Thorpe.

## 4. Representation — the app measures the space and not the goals

`practice/match.ts` is the app's representation principle, sourced properly to representative
learning design and careful about what it does and does not know: the age-to-format mapping is
printed inside the sentence precisely because two FA publications disagree about it. It is good
work.

It has one blind spot, and it is the one that matters most for an invasion game. A phase holds
`spectrum`, `area`, `groupSize`, `constraints` and `organisation` — and **nothing about
direction or targets**. So a 4v4 possession box at 20 × 20 and a 4v4 to two goals at 20 × 20
are the same record, and `describeRepresentativeness` (`practice/match.ts:131`) compares both
with a 9v9 match on identical terms. `matched_up` is carrying the entire claim that a practice
resembled the game, and direction is most of what makes a game a game.

Two honest options:

- **Leave it.** `organisation` already holds *"two neutrals, keeper joins in when we score"*,
  and the sentence prints its working, so a coach can see what was assumed. ADR 0004's
  restraint — three typed fields and prose for the rest — points here.
- **One more nullable enum**, `targets: 'two_goals' | 'one_goal' | 'lines' | 'none'`, seeded
  per phase template exactly as `defaultSpectrum` was, plus one clause in the
  representativeness sentence. A four-way tap on a screen the coach is already filling in.

My call: the second, but the create flow's tap budget decides that, not the model. This is the
one place in the app where a derived sentence currently claims slightly more than the record
supports.

## 5. The tactical-awareness half of the app is switched off with the load half

The game model is the app's stage 3, and it sits behind `periodizationEnabled`
(`modules/app/app-store.ts:324`, `app/squad/game-model/page.tsx:76`) — off by default, per
ADR 0008.

ADR 0008 is right about what it was fixing: four undocumented screens and a `Squad level`
control had appeared in front of coaches who never asked for them, and the load half of
tactical periodization is adult-squad work that ADR 0007 correctly fenced off. But the flag
bundles the *principles of play* together with the *morphocycle*, and those two have different
audiences. A grassroots youth coach working in a TGfU frame wants a line per moment for how
this team plays; they want nothing whatever to do with tension, duration and velocity days.

**Recommendation: nothing now.** There is no installed base and ADR 0008's reasoning stands.
But if that flag is ever split, the game model is the half to bring forward, and the argument
for doing it is TGfU's rather than tactical periodization's — worth having written down before
the question comes round again.

## 6. Exaggeration — constraints and principles never meet

STEP constraints *are* the exaggeration mechanism, and the Constraints-Led preset's
restrict / reward / relate is exaggeration under another name. The game model holds the
tactical problems. Nothing joins them: `Objective.principleId` links a **session** to a
principle, while `PhaseConstraint` is `{ letter, text }`. So the app cannot say *"you changed
four constraints and not one of them was aimed at the principle you were training"*.

**Name it and refuse it.** A second classification on that field fights its whole design
(`practice.ts:236` — the letter is tapped, the text is the coach's own, and deriving the letter
from the prose was already rejected once), and the payoff sentence is weak next to
`describeStepCoverage`, which already names the lever a coach pulls habitually.

## 7. Sampling and tactical complexity

**Sampling** across game categories — invasion, net/wall, striking/fielding, target — is out of
scope for a single-sport app, and no reasonable reading makes it a gap. The within-football
analogue is moment coverage, and it exists twice: `momentsWithoutPrinciples` on the game model,
and `practiceMix` across a term.

**Tactical complexity** is the Challenge Point Framework, which the app already implements in
the two words a coach uses (`practice.ts:257` — progressions and regressions, counted, never
scored) alongside the age band and relative playing area. What is absent is any ordering of
tactical demand across a term, and **the app should keep it absent.** Any sequence it shipped
would be somebody's opinion wearing the FA's clothes — the exact reasoning `practice.ts:110`
gave for publishing relative playing area as a bare number with no `small | medium | large`
band, and `practice/mix.ts` gave for refusing a target mix.

## 8. Questioning — the app counts questions; TGfU cares which kind

`questioning.ts` counts Q&A interventions, splits what the coach chose in the moment from what
the plan pre-filled, and reports the spread only as far as attribution supports it. It is
careful, and it is a count.

TGfU's pedagogy runs on question *type*, and the app has already read the right paper — Harvey
& Light, *Questioning for learning in game-based approaches*, is in the
[roadmap bibliography](roadmap-checking-for-understanding.md) — and stopped at counting.

**A `QuestionType` axis does not belong in Do mode.** The long-press sheet's three axes are
already the app's most expensive control, and a coach classifying their own question mid-rondo
will reach for the flattering label. If it goes anywhere it goes plan-side, where the presets
already carry the questions as coaching points — *"What did you see?"*, *"What would you
change?"* (`presets/constraints-led.ts`, `presets/guided-discovery.ts`). Even there the payoff
is a report about a plan, and the app has a standing rule against reading those as evidence.

## 9. A TGfU methodology preset? No

The tempting recommendation is a sixth entry in `METHODOLOGY_PRESETS`, and it should be refused
on the model's own terms: **the six stages are a learning cycle, not a session shape.**
Encoding them as one methodology would teach the model wrong. The app's analogue to the cycle
is the thing it was built around — Plan → Do → Review → Plan — and it already exists.

Play-Practice-Play and Whole-Part-Whole between them already produce a game-first session with
technique introduced at the point of need, which is the operational half of what a TGfU preset
would deliver. The genuinely missing phase is **stage 2** — play, then ask what the rules make
hard — and a coach can build that today out of the `huddle` kind, `playerChoice` and a
`question_and_answer` plan, with no new preset and no new code.

One thing not to lose if a preset is ever revisited: the app already ships Constraints-Led,
whose proponents explicitly reject TGfU's decomposition of a decision into *what to do* and
*how to do it*. The app's position — five methodologies, five tools, no ranking — survives
that disagreement fine. A preset claiming to be TGfU would have to sit beside a preset built on
the argument against it, and would need to say so.

## 10. Ranked, with costs

| # | Finding | Cost | Call |
| --- | --- | --- | --- |
| 1 | Group capability coverage into execution vs the rest (§3) | One derivation, one clause. No schema, no taps | **Build** |
| 2 | `targets` on `SessionPhase`, plus one clause in `describeRepresentativeness` (§4) | One nullable enum, preset defaults, one four-way tap | **Build if the create flow can afford the tap** |
| 3 | Split the periodization flag so the game model can come forward (§5) | A settings change and a doc | **Not now; keep the argument written down** |
| 4 | Join `PhaseConstraint` to a principle (§6) | A second classification on a deliberately half-structured field | **Name it, refuse it** |
| 5 | Question type (§8) | A fourth axis, in the worst place to ask for one | **No, or plan-side only** |
| 6 | Tactical-complexity sequencing (§7) | An invented ordering | **Refuse** |
| 7 | A TGfU preset (§9) | A preset that mis-teaches a cycle as a session | **No** |

**Nothing in this review is a defect.** Stages 1, 5 and 6 are served as well as the model asks
or better; stages 2, 3 and 4 are constrained by a rule — ADR 0009 §1 — that is more defensible
than the stages it excludes. The app's relationship to Bunker and Thorpe turns out to be the
same as its relationship to the Challenge Point Framework and to representative learning
design: it implements the part it can honestly evidence, in the coach's own words, and declines
the rest out loud.
