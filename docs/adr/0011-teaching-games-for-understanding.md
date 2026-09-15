# ADR 0011 — Teaching Games for Understanding as a game-centred planning spine

- **Status:** Accepted
- **Date:** 2026-09-15
- **Roadmap:** [`docs/roadmap-teaching-games-for-understanding.md`](../roadmap-teaching-games-for-understanding.md)
  — sequences this decision, and proposes six amendments to it in its Phase 0
- **Review that preceded it:**
  [`docs/review-teaching-games-for-understanding.md`](../review-teaching-games-for-understanding.md)
- **Relates to:** [ADR 0004](0004-structured-practice-design.md) (structured practice design),
  [ADR 0007](0007-morphocycle-for-adult-squads.md) (tactical periodization),
  [ADR 0009](0009-checking-for-understanding.md) (checking for understanding)

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

The first and final whole games in Whole-Part-Whole should share a game-form identity or frozen
game-form snapshot. Editing the final game must produce a visible warning when it no longer
matches the initial game on the fields that define the comparison, including its area, numbers,
rules, scoring and direction.

The system must not block a coach from making a legitimate change. It should preserve the
original and final records and tell the coach that transfer can no longer be compared as a
like-for-like game.

### 4. Decision making is recorded as an observation, not a grade

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

Review may compare the initial and final game records and show coach-confirmed observations such
as:

- “The decision/action appeared more often”;
- “It appeared sometimes”;
- “It was not observed”;
- “There was not enough evidence to compare.”

These are session-level records, not measures of learning. No TGfU-derived score, target number
of decisions, ideal ratio of game time to practice time, or ranking of players will be introduced.

## Implementation sequence

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

