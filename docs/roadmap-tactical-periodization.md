# Roadmap — preparing for a match with tactical periodization

- **Status:** Phases 0–4 done. Phase 5 (alternation) and Phase 6 (match preparation) are next.
  **Revised 2026-09-07** for a pro / semi-pro audience — see
  [ADR 0007](adr/0007-morphocycle-for-adult-squads.md), which supersedes ADR 0006.
- **Date:** 2026-09-07
- **Asked for:** *"As a coach, on a match day I would like to prepare for a game using tactical
  periodization methodology."*
- **Audience:** coaches at **professional and semi-professional** clubs. The app's existing
  grassroots audience keeps ADR 0006's behaviour, keyed on the squad.

## What tactical periodization is

A methodology developed by Vítor Frade at the University of Porto and popularised through José
Mourinho's staffs. Its claim is that the physical, technical, tactical and psychological
dimensions of football are **inseparable**, so they are never trained apart: there is no
isolated fitness work, and "physical" is a consequence of playing rather than a component to be
added.

Its ideas, and the distinction that matters most — **principles of play** are what you train, **methodological principles** are how:

| Idea | What it means |
| --- | --- |
| **Game model** | The team's intended way of playing. Not a formation — an identity. Everything trained refers back to it. |
| **The four moments** | Offensive organisation, defensive organisation, and the two transitions (attack→defence, defence→attack). The game is trained through these. |
| **Principles of play** | The game model decomposed by level. Naming varies: macro → meso → micro (→ sub), or principles → sub-principles → sub-sub-principles. The levels are structural; **no source publishes a canonical enumeration**. |
| **Methodological principles** | *Specificity* is the supra-principle. *Propensities*, *complex progression* and *horizontal alternation* exist to make it real, and together take shape as the morphocycle. |
| **The morphocycle** | The repeating week between matches, in which each day carries a different dominant sub-dynamic of football effort — tension, duration, velocity — alternated so the same quality is never hammered twice. |

> **Revised.** The two problems below were written assuming a grassroots audience. Under a pro /
> semi-pro premise the first one dissolves and the third applies only to academy squads; the
> second survives intact. The section is kept because the surviving problem still governs the
> design, and because the reasoning is what ADR 0007 argues against. **Read ADR 0007 for the
> decision that now holds.**

## The two problems that decide everything below

Neither is a detail. Both change what can honestly be built, and both are the reason this
roadmap is not simply "add a morphocycle screen".

### 1. The morphocycle assumes four training days. This app's coaches get one or two.

The pattern morphocycle is built for a professional week: MD+1 recovery, then MD-4, MD-3, MD-2,
MD-1 before the next match. Grassroots coaches — the entire audience of this app — train
**once or twice a week**. The literature acknowledges this and says the model can still be
useful "with creativity", which is an encouragement rather than a specification.

So the app cannot ship a morphocycle. What it can ship is the part that survives contact with
one session a week: **a game model, decomposed into principles, with each available session
assigned a moment and a principle level.** That is genuinely tactical periodization's spine.
The weekly load alternation is not, and pretending otherwise would be the app being confidently
wrong about the thing it is named after.

### 2. The sources disagree on the day-to-quality mapping, and the canonical one withholds it

Reading across the material, the classical presentation puts **tension** on MD-4 (small spaces,
few players, sub-principles), **duration** on MD-3 (large spaces, more players, macro
principles) and **velocity** on MD-2 (short, explosive, micro-principles). Barça Innovation
Hub's microcycle article instead puts peak velocity and maximum intensity on MD-3 with MD-2 as
speed-and-taper. The Tactical Periodisation site's own page on the pattern morphocycle
deliberately does not publish the operational breakdown at all, pointing readers to its academy.

This is the same situation ADR 0004 hit with relative playing area, where four sources gave four
incompatible bands and the app shipped the bare number instead of a confident one. **The app
must not ship a day→quality table as if it were canonical.** Either the coach states their own
mapping, or the app stays quiet about load and speaks only about principles.

### And a third thing, which is a safeguarding judgement

Tension, duration and velocity are **adult load-management concepts**. "Strength-dominant
Tuesday" is not a thing to apply to a nine-year-old, and this app's audience runs from U7. Frade
himself has it that the early stages should introduce the general principles of the four moments
— the tactical half, not the physical periodization.

**So: take the tactical half, decline the physical half, and say why in the UI.** That resolves
problems 1 and 2 at the same time, because the game model and the principles hierarchy work at
any training frequency, and the load alternation is the part that both needs four days and does
not belong to children.

## What already exists to build on

More than expected. This is mostly composition:

- **`ObjectiveTheme` is already three of the four moments.** `in_possession`,
  `out_of_possession`, `transition`, `individual` — the two transitions are merged into one, and
  `individual` is not a moment. That is the single biggest head start here.
- **`practice/match.ts` already computes representativeness** against England Football's own
  match sizes. Specificity *is* a representativeness argument, so the app can already say
  something true about whether a practice resembled the game.
- **`practice.ts`** carries the practice spectrum, area, group size, STEP constraints and
  progressions/regressions — the raw material for designing for propensity.
- **`practice/mix.ts`** already reports the mix of practice types across a term, which is the
  shape a horizontal-alternation report would take.
- **Match day (ADR 0005)** means MD is a real object now. A week can be anchored to a fixture.
- **`carry-forward`** already threads a coaching point from one session to the next and warns
  when the same point has been chased three times — which is a principle not being acquired.
- **`methodology.ts` presets are the wrong home.** Those five describe the *shape of one
  session*. Tactical periodization is a season-long framework that would *generate* sessions, so
  it sits a layer above and must not be jammed into `MethodologyPreset`.

## The phases

### Phase 0 — Write the ADR first — **done**

The scope decision above (tactical half yes, physical periodization no) is the whole design, and
it is contentious enough that it should be argued in `docs/adr/0006-*` before any code. It also
has to state plainly that this is **not** FA methodology — the app implements the FA 4 Corner
Model and the FA practice spectrum, and a coach must not be able to mistake tactical
periodization for England Football guidance.

### Phase 1 — The game model — **done**

The missing spine, and the prerequisite for everything else. A new aggregate (this one genuinely
is new, so it pays ADR 0001's store tax — `DB_VERSION` 4 → 5): a squad's intended way of playing,
held as a short identity statement plus principles per moment.

Deliberately cheap to fill in: the identity line is the only required field, and a coach with one
line and no principles has a real game model.

**No starter models shipped, contrary to the original plan here.** The reason is the one Phase 3
found twice over: the principles *are* the coach's model, so a shipped list would be somebody
else's. What ships instead is the tree rule — a principle hangs off the one above it, in the same
moment — which is the one part of the methodology the app can enforce rather than suggest.

### Phase 2 — Split the transitions — **done**

`ObjectiveTheme`'s single `transition` became `transition_to_attack` and
`transition_to_defence`.

**No migration was needed, and this roadmap was wrong to predict one.** The claim was that
stored sessions held an ambiguous `transition` which would have to be mapped rather than
defaulted. They do not. A session's `Objective` carries `text`, `successCriteria` and
`sourceActionId` and no theme; `objectiveUsageFrom` keys on the objective *text*; and
`OBJECTIVE_THEMES` was read by no screen at all. The theme was **dormant data** — recorded on
every template in code, consumed by nothing — so splitting it touched no document and no report.

It becomes load-bearing for the first time in Phase 3. The theme now reuses `Moment` from
`game-model.ts` rather than spelling the moments a second time, so an objective and a principle
share one vocabulary instead of two enums that happen to agree.

`individual` stayed outside the scheme. Four of the fourteen objectives are about a player
rather than a phase of the game, and filing *"first touch out of your feet"* under offensive
organisation to fit a four-moments model would be the app inventing a fact. `momentOf` returns
null for them, so a caller that needs a moment skips them rather than being handed a guess.

### Phase 3 — The principles of play — **done**

Principles hang off the game model by level, and a session's objective and coaching points
reference one.

**The coach authors the hierarchy; the app does not ship one.** No source publishes a canonical
enumeration of principles — the University of Denver series names the levels and defers examples
to the official school — and in any case the principles *are* the coach'''s game model, so a
shipped list would be someone else'''s. The app supplies the structure, the levels, and the
coherence check the sources do describe: a micro-principle detached from its macro is a leaf off
a tree.

This also settles the open question about the objective library. Principles sit **above** the
fourteen objectives rather than replacing them — the chips stay as fast starting points, and a
coach who wants their own principle-linked objectives adds them. This is what lets the app answer *"which principle
did we actually work on this month?"* — and it is where the existing carry-forward warning gains
real teeth, because chasing the same point three weeks running is a sub-principle that has not
been acquired.

### Phase 4 — The morphocycle — **done**

Derived from the fixture list rather than a fixed week, so it compresses to three days in a
midweek-game week and stretches in a break. Each session inside the cycle carries a day label
relative to the next match, an effort quality, a moment and a principle level.

The pattern is the coach's. The app ships the classical reading as a labelled, editable default
with the source disagreement stated beside it — never as the method's single correct form.

**Gated on the squad being adult** (ADR 0007). A youth squad gets the principles and no load
labelling, and a squad whose age group is blank defaults to the youth-safe behaviour.

The last session before the match goes to the opponent and set pieces, which is the one day every
source agrees on. Where the app has no defensible number it shows none, in the manner
`describeRepresentativeness` already uses.

### Phase 5 — Alternation, and did the week contain the game model?

The report that makes the whole thing honest, and the only part that can falsify a coach's own
plan. It reuses representativeness and the practice mix to say whether the sessions before a
match actually contained the principle they were supposed to train, and whether the moments were
alternated or the same one worked three times.

Nothing here scores the coach. It reports the record, in the voice the practice-mix and
minutes reports already use.

### Phase 6 — Match preparation

Pulls it together on the fixture: the game model's principles for the moments this opponent
threatens, what the week actually trained, the unit objectives that follow, and the player
challenges that follow from those. This is the screen the request describes, and it is last
because it is a view over everything above rather than a thing of its own.

## What this roadmap will not build

Worth stating so it is not quietly attempted later:

- **No tension/duration/velocity load prescription.** Adult load management, applied to children,
  from sources that disagree. Not defensible.
- **No opponent scouting database.** A coach's own note about the team they are playing, yes; a
  model of other teams, no.
- **No claim that this is FA methodology.** It is a coach's chosen framework, offered alongside
  the FA models the app already implements.
- **No isolated physical work.** That is not a limitation but the methodology's own position, and
  the app happens to agree with it already — there is no fitness screen and there should not be.

## Open questions

- Is a game model **per squad** or per season? A U12 squad's identity may outlive a season, and
  binding it to one would lose the comparison that makes it worth recording.
- Do principles **replace** the objective library or sit above it? The fourteen curated
  objectives are the app's biggest typing-eliminator, and losing them to a purist hierarchy would
  cost the twenty-second create flow.
- How does a coach with **one session a week** see this without it feeling like a framework
  designed to make them feel behind? The empty-morphocycle failure mode is real: an app that
  shows four empty day slots to a coach who has one Tuesday is telling them they are doing it
  wrong.
- Does the game model belong in the **export**? It must, but it is the first thing in the app that
  is arguably the *club's* rather than the coach's.

## Sources

- [Vítor Frade — Tactical Periodization](https://www.tacticalperiodisation.com/pt/vitor-frade/)
- [What is the Pattern Morphocycle? — Tactical Periodization](https://www.tacticalperiodisation.com/pt/2023/11/30/what-is-pattern-morphocycle/)
- [Microcycles in football: weekly structure from MD-5 to MD+1 — Barça Innovation Hub](https://barcainnovationhub.fcbarcelona.com/blog/microcycles-in-football-weekly-structure-from-md-5-to-md1/)
- [Training periodization models in football — Barça Innovation Hub](https://barcainnovationhub.fcbarcelona.com/blog/training-periodization-models-football/)
- [Tactical Periodization and the Pattern Morphocycle — Complementary Training](https://complementarytraining.com/tactical-periodization-and-the-pattern-morphocycle-integrating-theory-and-practice/)
- [Tactical periodisation as a football training methodology — Soccer Interaction](https://soccerinteraction.com/tactical-periodisation-as-a-football-training-methodology)
- [Performance training under tactical periodisation — Sportsmith](https://www.sportsmith.co/articles/performance-training-under-tactical-periodisation-understanding-the-morphocycle/)
- [Tactical Periodization in Grassroots Football — Mingle Sport](https://mingle.sport/blog/tactical-periodization-in-grassroots-football-a-blueprint-for-smarter/)
- [Training a Tactical Periodization Game Idea Principle — University of Denver](https://www.du.edu/sport-sense/news/training-tactical-periodization-game-idea-principle-example-ball-progression)
- [A tactical periodisation model for Gaelic football — Mangan et al., 2022](https://journals.sagepub.com/doi/10.1177/17479541211016269)
