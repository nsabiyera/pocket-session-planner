# Review — `watching-the-execution` against Teaching Games for Understanding

- **Status:** Review
- **Date:** 2026-09-16
- **Branch:** `watching-the-execution`
- **Compared with:** `main`
- **Reference model:** Bunker & Thorpe's six-stage Teaching Games for Understanding (TGfU)
  model, with the related principles of sampling, representation, exaggeration and tactical
  complexity.
- **Related decisions:** [ADR 0009](adr/0009-checking-for-understanding.md) and
  [ADR 0011](adr/0011-teaching-games-for-understanding.md)

## Summary

The branch substantially implements the TGfU roadmap recorded in ADR 0011. It has moved the
application from a methodology-compatible position to a more explicit game-centred planning and
review flow:

- objectives can begin with a tactical problem rather than a technique;
- practice phases can record what players are playing towards;
- Whole-Part-Whole phases are paired and compared;
- options are available as observation tags;
- isolated practice and game observations can be compared;
- capability coverage distinguishes execution from the rest of the action.

The branch is therefore a strong game-centred planning tool, but it does not yet fully evidence
the TGfU learning cycle. Its main limitation is that it records coach-designed conditions and
coach-observed tags, not the player's actual decision process. The transfer report also needs
tighter boundaries before it can be treated as reliable evidence of a behaviour returning to a
game.

**Overall assessment: 7.5/10 for TGfU alignment.**

## Alignment with the six stages

| TGfU stage | Implementation on this branch | Assessment |
|---|---|---|
| **1. Game form** | Game and conditioned-game phases, practice spectrum, targets, area, group size, and game-shaped methodologies | Strong |
| **2. Game appreciation** | STEP constraints, target types, coaching points, tactical problems and questions | Partial; records the coach's design, not player appreciation |
| **3. Tactical awareness** | Tactical problems, four moments, game-model principles and misconception prompts | Partial to strong; primarily coach-side |
| **4. Appropriate decisions** | Objective options, capability tags, action moments, player choice and questioning | Partial; options are available but player selection is not explicitly recorded |
| **5. Skill execution** | Technical and skill-practice phases, unopposed/interference/overloaded spectrum, progressions and regressions | Strong |
| **6. Performance** | Success criteria, objective outcome, challenge verdicts, observations and review reports | Strong for recording performance; incomplete for transfer evidence |

## What the branch does well

### Game-centred planning

The branch adds `tacticalProblem` to curated objectives and places the problem in Do mode. This
helps the coach start from a football problem rather than immediately selecting a technical
solution.

The five methodologies also give the coach several game-centred routes:

- Play-Practice-Play begins and ends with game activity;
- Constraints-Led uses changes to the practice as the main coaching mechanism;
- Guided Discovery asks players to explore a problem and choose an adjustment;
- Whole-Part-Whole returns to the same game after an isolated practice;
- Command / Direct retains a legitimate route for content where demonstration and rehearsal are
  appropriate.

This is preferable to introducing a single “TGfU methodology” preset. TGfU is a learning cycle,
not one fixed session choreography.

### Representation and exaggeration

`SessionPhase` now carries `targets` in addition to the practice spectrum, area, group size and
STEP constraints. This makes the representativeness report less dependent on `matched_up` alone.

The branch also preserves the coach's own organisation text rather than pretending that every
practice can be safely represented by a closed enumeration. This is an appropriate balance
between useful structure and false precision.

### Whole-Part-Whole comparison

`pairsWith` on methodology templates and `pairedWithPhaseId` on built sessions correctly preserve
the relationship between the first and second whole games. The comparison can identify changes
in:

- area;
- group size;
- practice spectrum;
- targets;
- constraints.

The comparison is deliberately non-blocking. A coach can change the practice for legitimate
reasons, while the application explains that the two records are no longer like-for-like.

### Epistemic and safeguarding discipline

The branch correctly follows ADR 0009. It does not claim that a player understood, learned, or
made the correct decision. Options are treated as records of what appeared, not as correct
answers. Player words remain quotes rather than being scored or interpreted.

The execution split in capability coverage is also defensible. It distinguishes observations
classified as `techniques` from observations classified under the other five capabilities without
using the unsupported and overly broad “technical versus tactical” distinction.

## Findings and risks

### 1. ~~High — transfer aggregates unrelated tags and phases~~

- **Status:** **fixed** 2026-09-16. `transferRecord` now takes a `subject` — `transferSubject(session)`,
  which is every phase's coaching points, the predicted misconception and the objective's
  options. A capability chip or a corner attribute is still logged everywhere else and is no
  longer counted here.

**Location:** `src/domain/session/transfer.ts:48-119`,
`src/modules/review/review-service.ts:582-590`

The transfer report treats every observation tag from every isolated phase and every game phase as
evidence of something returning to the game. It is not restricted to:

- the tactical problem;
- a selected option;
- the relevant coaching point;
- the paired final game;
- a game phase occurring after the isolated practice.

As a result, a capability tag, corner attribute, unrelated coaching point or generic observation
may be reported as something that “came back in the game”.

**TGfU impact:** this weakens Stage 6 performance and transfer evidence because the report may
describe a different action from the one the practice was intended to develop.

**Recommendation:** constrain transfer evidence to tags explicitly associated with the tactical
problem, selected options or designated coaching points. Keep unrelated observations available in
the normal review but exclude them from the transfer comparison.

### 2. ~~High — the report includes games before the isolated practice~~

- **Status:** **fixed** 2026-09-16. `phaseRoles` demotes any game running at or before the first
  isolated phase to `neither`, so Whole-Part-Whole's opening WHOLE and Play-Practice-Play's
  first PLAY are diagnoses rather than returns. The pairing needed no separate branch: the
  second WHOLE is after the PART by construction, so ordering already selects it.

**Location:** `src/domain/session/transfer.ts:48-57`,
`src/modules/review/review-service.ts:582-590`

The current `GAME_KINDS` set includes all game-like phases, but the transfer calculation does not
distinguish a diagnostic game before the isolated practice from a return-to-game phase afterwards.

In a Whole-Part-Whole session, observations from the first whole game can therefore be counted as
post-practice evidence. The report may say that an action appeared “in a game” without establishing
that it appeared after the intervention.

**TGfU impact:** this confuses initial diagnosis with subsequent performance and weakens the
learning-cycle sequence.

**Recommendation:** use phase order or the Whole-Part-Whole pairing to identify a later game. For
general sessions, compare isolated phases only with later game phases. For paired sessions,
prefer the paired later whole game.

### 3. High — options are available but player decisions are not recorded

**Location:** `src/domain/objectives.ts`, `src/modules/run/run-service.ts:592-611`

The branch exposes options as observation tags, but a tag records that the coach observed or
selected a label. It does not establish that a player selected or enacted that option.

There is no explicit record containing:

- the situation;
- the option selected by the player;
- the observable outcome;
- the player's explanation.

**TGfU impact:** this supports tactical possibilities, but not a reliable record of Stage 4
decision-making.

**Recommendation:** add a lightweight decision observation that records an option as a player or
unit action, with an optional player explanation. It must remain observational and must not create
a correctness score, ranking or percentage.

### 4. Medium — incomplete paired data can still read as a match

**Location:** `src/domain/session/pairing.ts:87-124`, `:157`

The pair comparison ignores a dimension when it exists on only one phase. If one phase has an area,
target, spectrum or group size and the other has cleared it, the comparison can still say:

> Both games match on everything recorded, so the comparison holds.

Missing data is not evidence that the two games match.

**TGfU impact:** the application can imply a valid like-for-like comparison when the records are
actually incomplete.

**Recommendation:** distinguish “equal”, “different” and “not recorded on both”. If a defining
dimension is missing on either side, report that the comparison is incomplete rather than
affirming that it holds.

### 5. Medium — constraints may be confused with game identity

**Location:** `src/domain/session/pairing.ts:126-144`

All constraints are currently treated as part of the same-game comparison. A temporary coaching
condition or progression may trigger a mismatch even when the underlying game form remains the
same.

**TGfU impact:** a legitimate exaggeration or intervention may invalidate the comparison and
reduce trust in the warning.

**Recommendation:** distinguish baseline game-form rules from temporary practice adjustments, or
document clearly that all recorded constraints form part of the comparison identity.

### 6. ~~Medium — seeded coach prompts are not rendered in Do mode~~

- **Status:** **fixed** 2026-09-16. `leadCoachPrompt` pins the first prompt above the phase's
  coaching points; the phase sheet lists all six. Placed there rather than beside the `Expect`
  line, because the Do-mode header is already documented as being at its 667px ceiling.
- **Note:** this was already `known-issues.md` issue 4, found 2026-09-10 — six days before this
  review rediscovered it.

**Location:** `src/domain/session.ts`, `src/domain/session/build-from-methodology.ts`,
`src/app/run/page.tsx`

Methodology templates seed `coachPrompts`, including prompts central to Guided Discovery and
player reflection, but Do mode does not render them. Some prompts are duplicated as coaching
points, but this is not consistent.

**TGfU impact:** the application records a game-centred teaching intention without reliably
presenting it at the moment the coach needs it.

**Recommendation:** render a single concise coach prompt in Do mode where it can be seen without
adding another required action. Avoid displaying every prompt at once; select or rotate the most
relevant prompt for the current phase.

### 7. Low — target type does not capture full direction or roles

**Location:** `src/domain/practice.ts:101-130`, `src/domain/session/pairing.ts`

`targets` improves representation with `two_goals`, `one_goal`, `lines` and `none`, but it does
not capture direction of play, attacking/defending orientation or role relationships.

**TGfU impact:** two practices with the same target type can still preserve different information
and afford different decisions.

**Recommendation:** do not add a large mandatory form. If field testing shows the gap matters,
consider one optional direction/role field or retain the distinction in organisation prose.

## Recommended priorities

| Priority | Action | Rationale |
|---|---|---|
| ~~1~~ | ~~Restrict transfer to relevant tags and later game phases~~ — **done** | Prevents the most misleading TGfU claim |
| 2 | Add a lightweight decision observation | Makes player decision-making observable without scoring it |
| 3 | Treat missing paired dimensions as incomplete | Prevents false like-for-like claims |
| 4 | Clarify or separate baseline rules from temporary adjustments | Keeps Whole-Part-Whole warnings useful |
| ~~5~~ | ~~Render selected coach prompts in Do mode~~ — **done** | Makes Guided Discovery usable at the point of coaching |
| 6 | Field-test target/direction detail before adding more schema | Avoids unnecessary planning complexity |

## Conclusion

The branch is a meaningful and mostly coherent implementation of ADR 0011. It supports the
game-centred parts of TGfU particularly well: starting from a problem, manipulating a practice,
returning to the game, and reviewing performance against pre-set criteria.

The implementation should not be described as measuring player understanding or learning. Its
strongest defensible claim is narrower: it helps a coach design a game-centred practice and
compare where selected, relevant observations appeared.

Before the branch is considered complete against TGfU, the transfer join should be narrowed and
the decision record should be made explicit. Those changes would improve the integrity of the
learning cycle without adding a player score or compromising the app's pitch-side speed.

