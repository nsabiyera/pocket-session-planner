# ADR 0011 — Teaching Games for Understanding as a game-centred planning spine

- **Status:** Accepted. **Amended 2026-09-15** — seven amendments, every one about cost rather
  than direction, argued in the roadmap's Phase 0 and recorded in the notes below
- **Date:** 2026-09-15
- **Roadmap:** [`docs/roadmap-teaching-games-for-understanding.md`](../roadmap-teaching-games-for-understanding.md)
  — sequences this decision, and proposes six amendments to it in its Phase 0
- **Review that preceded it:**
  [`docs/review-teaching-games-for-understanding.md`](../review-teaching-games-for-understanding.md)
- **Relates to:** [ADR 0004](0004-structured-practice-design.md) (structured practice design),
  [ADR 0007](0007-morphocycle-for-adult-squads.md) (tactical periodization),
  [ADR 0009](0009-checking-for-understanding.md) (checking for understanding)

## Amendments, 2026-09-15

The decision below is kept **as it was accepted**, and each amended section carries a note where
a reader meets it. Nothing here reverses the direction; all seven reduce what it costs to get
there, and four of them because a field turned out to exist already under another name.

| # | Section | What changed |
| --- | --- | --- |
| 1 | §1 | Five new objective fields become **one**. Three of the five already exist as `coachingPoints`, `successCriteria` and `commonMisconception` |
| 2 | §2 | Two of the six game-form sub-fields already exist as `PracticeSpectrum` and `PhaseConstraint`. What remains is direction and targets |
| 3 | §3 | The Whole-Part-Whole pairing moves from session state to **one nullable field on the phase template**, with the diff derived |
| 4 | §4 | The decision observation becomes **one tag**, not a four-field sheet |
| 5 | §7 | Below its floor the transfer line **shows nothing**, rather than saying "not enough evidence" |
| 6 | §8 *(new)* | The ADR states what a coach sees on day one, per ADR 0008's lesson |
| 7 | §9 *(new)* | A plan-time field arrives with the pitch-side surface that renders it, or with a reason none does |

## Context

The application already contains several practices that are compatible with Teaching Games for
Understanding (TGfU), the model associated with David Bunker and Rod Thorpe:

- Play-Practice-Play and Whole-Part-Whole begin or end with a game;
- Constraints-Led and Guided Discovery use modified practices, questions and player choices;
- the practice spectrum and STEP fields help a coach manipulate the task;
- game-model principles organise work around the four moments;
- observations, challenges and review records provide evidence from the session.

These features are useful, but TGfU is currently represented mostly by preset names, phase
descriptions and coach prompts. The domain does not yet make the core learning cycle explicit:

1. begin with a modified game;
2. help players appreciate the problem and its tactical possibilities;
3. develop tactical awareness;
4. support decision making;
5. develop skill execution as it serves the game;
6. return to the game and consider performance and transfer.

Without that spine, the same application can still produce a drill-first session. A technical
phase may be planned without recording the game problem it addresses, and Whole-Part-Whole says
that its two whole games must be the same without enforcing or comparing that fact. The app can
record that a player acted, or that players chose an adjustment, but not what tactical decision
was made or what information informed it.

The application must also avoid turning TGfU into a player score. Understanding, learning and
decision quality are not directly observable from the records this app can collect. The existing
discipline in ADR 0009 therefore remains binding: record coach actions, player words, observable
actions and practice changes; do not label a player as understanding or assign a comprehension
rating.

## Decision

**Adopt TGfU as a game-centred planning and review spine, implemented incrementally and
additively.** The app will make the tactical problem, representative game form, decision
opportunity and return-to-game comparison explicit, while retaining free text where a coach's
local practice cannot be safely enumerated.

### 1. A session starts from a game problem, not a technique

> **Amended: five fields become one.** The **tactical problem** is genuinely new and ships
> alone. Of the other four, the *decision cue* is `coachingPoints` (*"Recognise the moment — do
> not force it"*), *why it matters in the game* is `successCriteria` — which already carries the
> review loop through `metCriteria` — and the *available options* become Phase 5's observation
> chips rather than objective prose. *What players should perceive* is dropped: its nearest
> honest expression is the `before` action moment and the scanning capability, and both already
> exist.
>
> The cost this avoids is seventy curated strings across fourteen library entries, most of them
> restating a field the app already has, all of them snapshotted onto every session document —
> which Do mode rewrites on every tap. And the prediction half of the game problem is already
> written: across all fourteen entries `commonMisconception` is a decision error phrased as
> *"they think X, so they do Y"*.

Curated objectives remain the fast entry point. Each objective may additionally seed:

- a tactical problem;
- what players should perceive;
- the available options;
- the decision cue;
- why the decision matters in the game.

These are planning aids, not claims about what a player will perceive or learn. Custom objectives
continue to work with these fields absent. A technical or skill-practice phase may still be
chosen, but the planner should show the game problem it is intended to solve and encourage a
return to a representative game.

### 2. Game form becomes first-class data for game phases

> **Amended: two of the six sub-fields already exist, and a second home would break the reports
> built on the first.** *Opposition behaviour* is `PracticeSpectrum` — unopposed, unopposed with
> interference, overloaded, matched-up — which is the only **ordered** axis in the app and the
> one `describeSessionShape` and `practiceMix` are both built on; forking it would cost both.
> *Key rules or conditions* is `PhaseConstraint`, and splitting it blinds `describeStepCoverage`
> to every condition written in the new field.
>
> What remains is **direction and targets**, as one nullable four-value enum seeded per phase
> template exactly as `defaultSpectrum` is, so the default path costs no tap. *Numbers and
> roles* is `groupSize` plus `organisation`. *The tactical problem being exaggerated* is §1's
> field, referenced rather than copied onto the phase.

Game and conditioned-game phases should support a compact structured game form containing, where
known:

- numbers and roles;
- direction of play;
- targets, goals and scoring;
- key rules or conditions;
- opposition behaviour;
- the tactical problem being exaggerated.

The coach's organisation text remains available for local detail. Structured fields must not
attempt to encode every practice variation or infer meaning from prose. Missing values mean that
the coach did not record them, not that the practice had none.

### 3. Whole-Part-Whole phases are linked and comparable

> **Amended: the pairing is methodology knowledge, not session state.** A frozen game-form
> snapshot stored on a `SessionPhase` would introduce a third data category — plan data that
> must not change — into the schema this app rewrites most often, against the plan/run
> separation the README names as one of the three decisions everything else hangs off. And a
> session-level pair id means something for one built-in preset out of five, nothing for a
> custom methodology, and dangles the moment a coach deletes or reorders a phase.
>
> Instead: one nullable `pairsWith` on `MethodologyPhaseTemplate`, where `defaultSpectrum` and
> `defaultPlayerChoice` already live, with the comparison **derived** through `fromTemplateId`
> over `area`, `groupSize`, `spectrum`, `constraints` and `targets` — every one of which both
> phases already carry. Two implementation consequences, both small: `cloneMethodology`
> regenerates template ids on purpose, so it needs an old → new remap or a clone's pairing
> points at a template it does not have; and `refineTemplates` validates that the reference
> resolves, which is the `refineGameModel` tree rule again, one level simpler.
>
> The never-block-the-edit rule below is unchanged, and is the best thing in this section.

The first and final whole games in Whole-Part-Whole should share a game-form identity or frozen
game-form snapshot. Editing the final game must produce a visible warning when it no longer
matches the initial game on the fields that define the comparison, including its area, numbers,
rules, scoring and direction.

The system must not block a coach from making a legitimate change. It should preserve the
original and final records and tell the coach that transfer can no longer be compared as a
like-for-like game.

### 4. Decision making is recorded as an observation, not a grade

> **Amended: three of the four fields already have homes, and the fourth is a tap.** The
> *situation* is `actionMoment`, the *observable outcome* is `ratingKind`, and the *player's
> explanation* inherits `PlayerChallenge.playerWord`'s rules verbatim — a quote, never parsed,
> never scored, never aggregated, never read as sentiment.
>
> Only **the option selected** is new, and it ships as a **tag**, on the route
> `commonMisconception` already takes to the observation sheet: no new field on `Observation`,
> no new store, no form. Two taps is the floor for the app's highest-volume action, and a
> four-field sheet during a running game would break it — at which point the coach stops
> logging, and the feature has cost more than it produced.
>
> One consequence worth stating here rather than discovering later: a tapped option triggers
> nothing. `struggled` plus the *misconception* routes to the regression the coach wrote
> (`checking.ts`); `struggled` plus an *option* deliberately does not, because an option is not
> an error.

Do mode should eventually offer a lightweight decision observation for a player or unit:

- the situation;
- the option selected;
- the observable outcome;
- the player's explanation, optionally recorded verbatim.

This is separate from a challenge tally and from the objective outcome. It must not produce a
player-level decision score, ranking, percentage or correctness index. “Not enough evidence” is
always a valid review state.

### 5. Questions are generated from the tactical problem

Existing questioning records and player-word fields remain the storage and safeguarding boundary.
Where a tactical problem exists, the app may offer prompts such as:

- “What did you notice before the ball arrived?”
- “What options did you have?”
- “What told you to play forward?”
- “What would make that decision easier?”

The coach may ignore or replace these prompts. A question records that the coach asked and, when
provided, what the player said or showed; it never records that the player understood.

### 6. Skill practice must reconnect to the game

When a session includes an isolated technical or skill-practice phase, the plan should retain the
game problem that justified it and identify a later game or conditioned game where the coach can
look for the action again. The review should distinguish:

- the action appearing in the isolated practice;
- the action appearing in the representative game;
- insufficient evidence to compare.

This preserves the legitimate role of skill execution while preventing the app from treating
successful drill performance as automatic transfer.

### 7. Review describes transfer without prescribing a target

> **Amended: below its floor the line shows nothing, rather than saying "not enough
> evidence".** Every other report in this app is silent under its threshold instead of
> explaining its own absence — `practiceShape` says so in as many words. The Consequences
> section below predicts this line will *frequently* report that it cannot tell you anything,
> and a line that appears most weeks saying that is a line a coach learns to scroll past, which
> costs the reports that do fire.
>
> The four states stay exactly as listed. The fourth renders as **no line at all**, and the
> words *not enough evidence* are reserved for a screen where the coach asked a direct question
> and is owed an answer.

Review may compare the initial and final game records and show coach-confirmed observations such
as:

- “The decision/action appeared more often”;
- “It appeared sometimes”;
- “It was not observed”;
- “There was not enough evidence to compare.”

These are session-level records, not measures of learning. No TGfU-derived score, target number
of decisions, ideal ratio of game time to practice time, or ranking of players will be introduced.

### 8. What a coach sees on day one

Added by amendment, because ADR 0008 exists for precisely this: six correct phases put four
undocumented screens in front of coaches who had not asked for them, and that was cheap to fix
only because nobody had used it yet.

**No stage of this work adds a tap or a screen to the default path, so none of it needs a flag.**
The whole surface, stated up front:

- **§1's tactical problem** — carried by the objective chip. Nothing new to fill in, and one
  pinned line in Do mode beside the `Expect` line the misconception already occupies.
- **§2's targets** — seeded per phase template, so the default path costs nothing. A four-across
  chip row for a coach who opens the phase editor.
- **§3's pairing** — invisible unless a coach is running Whole-Part-Whole and has edited one of
  its two games.
- **§4's options** — chips in a row the observation sheet already has.
- **§7's transfer line, and the execution split** — `/review` only.

A coach who ignores all of it plans the same session in the same twenty seconds. If any later
stage stops being able to say that, it needs a flag, and this section needs rewriting before it
ships rather than after.

### 9. A plan-time field arrives with the surface that renders it

Added by amendment, and the cheapest rule in this document either to follow or to break.

Two plan-time fields are already authored, carried onto the phase, and rendered by nothing:
`SessionPhase.coachPrompts`, written by all five presets under a comment saying Do mode shows
them ([known issue 4](../known-issues.md)), and `SessionPhase.organisation` — 500 characters the
coach types themselves, on the field ADR 0004 argued hardest to keep, read back by no screen at
all ([known issue 5](../known-issues.md)). This ADR adds four more plan-time fields and, as
accepted, named a surface for none of them.

**So every field here arrives with the pitch-side or review surface that renders it, or with a
stated reason that none does.** A field arriving with neither is a sixth write-only column, and
the test suite will not catch it: the suite verifies the write and the shape, never the round
trip to a screen.

## Implementation sequence

> **Amended: superseded by the roadmap's ordering, and it was missing a stage at the front.**
> The sequence below begins at the first new field. The roadmap orders by **cost** instead, and
> puts a stage ahead of all five that costs nothing whatsoever — regrouping `capabilityCoverage`
> into the execution against the rest of the action, which needs no field, no tap and no
> migration, and which answers whether this coach even has the problem the rest of this work is
> aimed at. **That stage shipped on 2026-09-15.** Every stage below it remains proposed.

The decision is intentionally staged so that the default twenty-second planning path does not
become a form:

1. Add tactical-problem metadata to curated objectives and preserve it in session snapshots.
2. Add a compact game-form structure and link paired Whole-Part-Whole phases.
3. Show problem-specific questions and the game-problem context in phase planning and Do mode.
4. Add decision observations using the existing observation and player-word boundaries.
5. Add a transfer comparison to review and carry-forward only when the record is sufficient.

Each stage must remain backward compatible. Existing sessions with no TGfU metadata continue to
display honestly as sessions without that information. No migration may invent a tactical problem,
game form or player decision for historical sessions.

## Consequences

- **Positive:** TGfU becomes an enforceable relationship between game problem, practice design,
  questions, decisions and return-to-game evidence rather than a label attached to a preset.
- **Positive:** the app can help a coach preserve representative game conditions and identify when
  a Whole-Part-Whole comparison is no longer valid.
- **Positive:** technical work remains supported, but its purpose is made explicit and its transfer
  is not assumed.
- **Positive:** player agency and questioning are strengthened without introducing a player
  comprehension or decision-quality score.
- **Negative:** game-form data adds planning complexity. The default path must therefore seed only
  what the curated objective or methodology genuinely knows and keep the rest optional.
- **Negative:** custom practices will often remain partially structured. This is preferable to
  false precision or silently inferred tactical meaning.
- **Negative:** transfer reports will frequently say “not enough evidence”. This is an intended
  safeguard against confusing drill success, coach intention or a single observation with
  learning.
- **Negative:** paired-phase integrity requires more domain validation and careful handling of
  edited plans, imports and older sessions.

## Rejected alternatives

### A TGfU score or player understanding rating

Rejected because the app cannot observe understanding reliably and a score would turn an
instructional model into a person-level judgement. ADR 0009's prohibition remains in force.

### Replacing all existing methodologies with TGfU

Rejected because TGfU is a teaching and learning model, not a single session choreography.
Command / Direct remains appropriate for some content, while Constraints-Led, Guided Discovery,
Play-Practice-Play and Whole-Part-Whole provide different ways to operationalise game-centred
learning.

### Inferring representative quality from phase kind or free text

Rejected because a phase titled “game” may still be poorly representative, and keyword matching
organisation prose would produce silently wrong reports. The app should record what the coach
chose and compare only known fields.

### Making every planning field mandatory

Rejected because it would break the app's pitch-side speed and would encourage invented or
low-quality entries. Structured TGfU fields are progressively disclosed and optional unless a
specific comparison requires them.

