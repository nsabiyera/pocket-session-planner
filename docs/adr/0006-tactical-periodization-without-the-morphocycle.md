# ADR 0006 — Tactical periodization's tactical core, without the morphocycle

- **Status:** **Superseded by [ADR 0007](0007-morphocycle-for-adult-squads.md)** (2026-09-07). Its
  reasoning held for the audience it assumed — grassroots youth — and two of its three arguments
  do not survive a pro or semi-pro first team. Kept because the surviving argument still governs,
  and because why we thought this is worth having.
- **Date:** 2026-09-07
- **Roadmap:** [`docs/roadmap-tactical-periodization.md`](../roadmap-tactical-periodization.md)

## Context

A coach asked to prepare for a match using tactical periodization. The methodology — Vítor
Frade, University of Porto — holds that football's physical, technical, tactical and
psychological dimensions are inseparable, and organises training around a **game model**
decomposed into **principles**, trained through the **four moments** of the game, inside a
repeating weekly **morphocycle** whose days each carry a different dominant sub-dynamic of
effort: tension, duration, velocity.

Implementing it whole is not possible here, and the reasons are not implementation detail.

**The morphocycle assumes four training days between matches.** MD+1 recovery, then MD-4, MD-3,
MD-2, MD-1. This app's entire audience is grassroots youth football, where a team trains **once
or twice a week**. The literature acknowledges the amateur case and says the model remains useful
"with creativity", which is an encouragement rather than a specification.

**The sources disagree about the day-to-quality mapping, and the canonical source withholds it.**
The classical presentation puts tension on MD-4 (small spaces, sub-principles), duration on MD-3
(large spaces, macro principles) and velocity on MD-2 (short, explosive, micro-principles).
Barça Innovation Hub's microcycle article instead puts maximum intensity and peak velocity on
MD-3, with MD-2 as speed-and-taper. The Tactical Periodisation site's own page on the pattern
morphocycle declines to publish the operational breakdown at all and points readers to its
academy. This is ADR 0004's relative-playing-area situation exactly: four sources, four
incompatible answers, and no defensible number to ship.

**And tension, duration and velocity are adult load-management concepts.** This app's age bands
start at U7. "Strength-dominant Tuesday" is not something to apply to a nine-year-old, and Frade's
own position is that early stages introduce the general principles of the four moments rather
than the physical periodization. The app has no fitness screen and should not acquire one.

## Decision

**Implement tactical periodization's tactical core. Do not implement the morphocycle's physical
periodization, and say so where a coach can see it.**

In:

- The **game model** — a squad's intended way of playing, decomposed into principles.
- The **four moments** — offensive organisation, defensive organisation, and both transitions.
- The **principles hierarchy** — macro → meso → micro → sub, with a session's objective and
  coaching points referencing one.
- **Specificity** and **propensities** — reported against practices, not asserted.

Out:

- Any **tension / duration / velocity** classification of a session.
- Any **load prescription**, taper, or intensity percentage.
- Any **MD-n day naming** that implies a four-day week the coach does not have.

Five decisions follow from that.

### It is a framework above the session, not a sixth methodology preset

`MethodologyPreset` describes the *shape of one session* — Play-Practice-Play's three phases,
Whole-Part-Whole's arc. Tactical periodization is a season-long framework that would *generate*
those sessions and choose between them. Jamming it into the preset list would make the
methodology picker offer two incommensurable kinds of thing, and would break the presets' own
invariant that phase weights sum to one.

### The game model is a new aggregate, and pays ADR 0001's store tax

Unlike match day (ADR 0005), this genuinely is a new noun. A game model outlives every session
that references it, is edited on its own schedule, and is arguably the club's rather than the
coach's. There is no existing document it could ride without distorting one.

### The four moments extend `ObjectiveTheme` rather than paralleling it

`ObjectiveTheme` is already `in_possession | out_of_possession | transition | individual` —
three of the four moments, with the two transitions merged and `individual` sitting outside the
scheme. A second, parallel taxonomy would mean every report choosing which one it grouped by.

The cost was predicted to be the app's **first migration that cannot ride
`nullable().default()`**, on the reasoning that stored sessions hold an ambiguous `transition`
which must be mapped rather than defaulted.

**That prediction was wrong, and the split cost no migration at all.** No document holds an
`ObjectiveTheme`: a session's `Objective` carries text, success criteria and a source action and
no theme, `objectiveUsageFrom` keys on the text, and the labels were read by no screen. The theme
was dormant data in code. Left recorded here rather than quietly corrected, because a wrong
prediction about a migration is exactly the kind of thing worth being able to find again.

### The week is "the sessions you have before this fixture"

Anchored to a match, the app lists the training sessions actually scheduled before it — one,
two, or five — and assigns each a moment and a principle level. It never renders empty MD-n
slots. A coach with one Tuesday must not open this screen and see four blanks, because that is
an app telling a volunteer they are doing it wrong.

### Where the sources disagree, the coach states it or the app is silent

The same rule the practice-mix report follows when it cites the 2023 review calling the
contextual-interference benefit a myth in sport: say what can be supported, name what cannot.

## Consequences

- **Positive:** the core works at **any training frequency**. A game model and a principles
  hierarchy are as usable with one session a week as with five, which is the only way this
  feature could serve the app's actual audience.
- **Positive:** most of it is composition. `practice/match.ts` already computes
  representativeness against England Football's match sizes, and specificity *is* a
  representativeness argument; `practice/mix.ts` is already the shape an alternation report
  takes; match day (ADR 0005) already made MD a real object to anchor a week to.
- **Positive:** carry-forward gains its sharpest reading yet. It already warns when the same
  coaching point has been chased three sessions running; against a principles hierarchy, that
  warning becomes *"this sub-principle is not being acquired"*, which is the methodology's own
  diagnosis.
- **Negative, and the strongest objection to this ADR:** what ships is **not tactical
  periodization entire.** A practitioner would reasonably say that a morphocycle is not an
  optional accessory to the method but its organising unit, and that the tactical core without
  the weekly alternation is a game model with extra steps. That objection stands. The app's
  answer is not to dispute it but to **name the omission in the UI** — a coach who knows the
  methodology must be able to see immediately that this is the principles half and that no load
  periodization is being done, rather than believing they are running a morphocycle.
- **Negative:** two methodology concepts now coexist — session-shape presets and a season
  framework — and a coach could reasonably expect picking one to affect the other. It should,
  eventually; it will not at first.
- **Negative:** this is **not FA methodology**, and the app implements the FA 4 Corner Model and
  the FA practice spectrum elsewhere. Every surface touching this must make clear it is the
  coach's chosen framework, not England Football guidance. Getting that wrong would put words in
  the FA's mouth in an app grassroots coaches may reasonably read as reflecting their badges.
- **Follow-up:** whether principles **replace** the fourteen-objective library or sit above it is
  unresolved. The library is the app's biggest typing-eliminator and the reason the create flow
  fits in twenty seconds; a purist hierarchy that discarded it would trade the app's headline
  requirement for doctrinal tidiness. Phase 3 has to answer this before it writes anything.
