# Roadmap — preparing for a match with tactical periodization

- **Status:** Proposed. Nothing here is built.
- **Date:** 2026-09-07
- **Asked for:** *"As a coach, on a match day I would like to prepare for a game using tactical
  periodization methodology."*

## What tactical periodization is

A methodology developed by Vítor Frade at the University of Porto and popularised through José
Mourinho's staffs. Its claim is that the physical, technical, tactical and psychological
dimensions of football are **inseparable**, so they are never trained apart: there is no
isolated fitness work, and "physical" is a consequence of playing rather than a component to be
added.

Six ideas carry it:

| Idea | What it means |
| --- | --- |
| **Game model** | The team's intended way of playing. Not a formation — an identity. Everything trained refers back to it. |
| **The four moments** | Offensive organisation, defensive organisation, and the two transitions (attack→defence, defence→attack). The game is trained through these. |
| **Principles hierarchy** | The game model is decomposed: macro-principles → meso → micro → sub-principles. Complexity is reduced by fragmentation. |
| **Specificity** | Every practice must contain the way you intend to play. This is the governing principle. |
| **Propensities** | Practices are designed so the wanted behaviour happens *often*, not occasionally. |
| **The morphocycle** | The repeating week between matches, in which each day carries a different dominant sub-dynamic of football effort — tension, duration, velocity — alternated so the same quality is never hammered twice. |

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

### Phase 0 — Write the ADR first

The scope decision above (tactical half yes, physical periodization no) is the whole design, and
it is contentious enough that it should be argued in `docs/adr/0006-*` before any code. It also
has to state plainly that this is **not** FA methodology — the app implements the FA 4 Corner
Model and the FA practice spectrum, and a coach must not be able to mistake tactical
periodization for England Football guidance.

### Phase 1 — The game model

The missing spine, and the prerequisite for everything else. A new aggregate (this one genuinely
is new, so it pays ADR 0001's store tax): a squad's intended way of playing, held as a short
identity statement plus principles per moment.

Deliberately cheap to fill in: a coach who writes one line per moment has a usable game model,
and the app should ship starter models by age band rather than an empty form.

### Phase 2 — Split the transitions

`ObjectiveTheme`'s single `transition` becomes `transition_to_attack` and
`transition_to_defence`. Small change, wide blast radius: the objective library, the theme
labels, and every report that groups by theme. Needs a migration for stored sessions — the first
one in this app that cannot ride `nullable().default()`, because the old value is genuinely
ambiguous and must be mapped, not defaulted.

### Phase 3 — The principles hierarchy

Principles hang off the game model at macro / meso / micro / sub level, and a session's
objective and coaching points reference one. This is what lets the app answer *"which principle
did we actually work on this month?"* — and it is where the existing carry-forward warning gains
real teeth, because chasing the same point three weeks running is a sub-principle that has not
been acquired.

### Phase 4 — The match week

The thing the coach actually asked for. Anchored to a fixture, it lays out the sessions available
before it — however many there are — and assigns each a moment and a principle level, with the
last one before the match given to the opponent and set pieces.

Everything the sources disagree about stays the coach's to state. Where the app has no defensible
number it shows none, in the manner `describeRepresentativeness` already uses.

### Phase 5 — Did the week contain the game model?

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
