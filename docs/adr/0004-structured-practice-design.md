# ADR 0004 — Structured practice design, with `organisation` kept as free text

- **Status:** Accepted
- **Date:** 2026-09-04

## Context

The FA's [coach planning and reflective model](https://learn.englandfootball.com/articles-and-resources/coaching/resources/2025/The-coach-planning-and-reflective-model)
(Muir, Morgan & Abraham, 2011) has four interconnected areas. This app covered three of them
well and one of them barely at all:

| FA area | Coverage before this ADR |
| --- | --- |
| Intended outcomes | **Strong** — objective, success criteria, review outcome, carry-forward |
| Coach behaviour | **Strong** — method/mechanic/audience, budgets, *measured* ball-rolling time |
| Practice design | **Thin** — `kind`, `title`, `plannedDurationMin`, and 500 characters of free text |
| Player engagement | **Absent** |

The argument for doing something about practice design was sitting in the placeholder on that
free-text box: `"4v2 rondo, 15x15, two neutrals"`. Space, players and task — the raw material
of every practice-design framework in the sport — were **already in the coach's head and
already being typed**, into a field nothing could read.

Two routes were available.

**Parse the prose.** `organisation` already contains the data. A regex over `/(\d+)\s*[x×]\s*(\d+)/`
and `/(\d+)\s*v\s*(\d+)/i` recovers dimensions and numbers from most of what coaches actually
write, at zero new taps and zero schema change.

**Structure the fields.** Add typed fields for the parts a report needs to compare, and leave
the rest as prose.

## Decision

**Structure the practice as three optional typed fields on `SessionPhase`, and keep
`organisation` as free text alongside them.**

```ts
spectrum:  PracticeSpectrumSchema.nullable().default(null),   // the FA practice spectrum
area:      PracticeAreaSchema.nullable().default(null),       // { lengthM, widthM }
groupSize: z.number().int().min(1).max(30).nullable().default(null),
```

Three supporting decisions, each of which was a real fork:

**1. Parsing the prose was rejected.** `"15x15"` parses; `"15 x 15 yards, or 20 if it's the
big group"` does not, and neither does a `15` that turns out to be the number of minutes. A
silently wrong 20 × 20 in a season report is worse than a blank one, and the coach has no way
to see that the app misread them. Structured capture is the only version where what the app
believes and what the coach said cannot diverge.

**2. `organisation` stays, and is not migrated into the new fields.** It is where the detail a
schema should not chase goes — *"two neutrals, keeper joins in when we score, losers do the
cones"*. The three fields take the part that must be comparable across sessions; the box takes
the part that must not be flattened. Its placeholder loses the dimensions it used to suggest,
because those now have a home.

**3. The derived line ships the bare number and no band.** `relativePlayingArea` returns m²
per player, and the UI renders *"15 × 15 m for 6 players — 38 m² each."* with no
`small | medium | large` attached. The FA's own
[How to design football practices](https://learn.englandfootball.com/articles-and-resources/coaching/resources/2024/How-to-design-football-practices)
names relative playing area but publishes **no figures** — it links out, and the banding there
is tabulated by age group. The literature does not agree with itself either: a bio-banding
study uses small = 36 m²/player and large = 109, while small-sided-game load research treats
120 m²/player as small-sided and 270 as large. Those are a factor of three apart on the same
word. Any adjective this app attached would be its own invention wearing the FA's clothes.

### Amended 2026-09-04 — STEP, and where the letter goes

The same split, applied to constraints: `constraints: Array<{ letter, text }>` on a phase, max
six. **The letter is structured; the condition is not**, because the space of football
conditions has no closed enumeration — *"only score once everyone has crossed halfway"* fits no
enum anyone would write twice — while the letter is a four-way tap the FA already teaches.

The letter is **tapped, never inferred**. Deriving it by keyword-matching the condition text
was considered and rejected on this ADR's own reasoning: it is the same prose-parsing that
decision 1 refuses, and a silently wrong letter in a season report is worse than no letter.
An off-plan change therefore carries `step: null` and is reported as unclassified, in the
idiom `CornerBalance` already uses.

`PracticeAdjustment.step` — not `InterventionEvent.step`. `InterventionPlan.mechanic`'s
`constraint_change` is a statement of *intent* ("this is how I mean to coach"); the adjustment
is the *event*. Putting the letter on the event keeps the two apart, and keeps a
Constraints-Led coach doing exactly what their methodology says from reading as over-coaching.

Two things this ADR explicitly does **not** do:

- **No IndexedDB migration and no `document-migrations` step.** No new store and no new index,
  and a nullable-with-default field leaves every existing session parsing unchanged — the same
  route `Observation.actionMoment` took. Only *new aggregates* pay the ADR 0001 tax.
- **No transfer wiring.** The fields live inside the sessions document, which already travels
  in `TransferDataSchema`.

## Consequences

- **Positive:** The practice spectrum costs **zero taps** — `MethodologyPhaseTemplate.defaultSpectrum`
  answers it from the methodology the coach already picked, per template rather than by a
  global `PhaseKind` map (Play-Practice-Play's PRACTICE is an overload; Whole-Part-Whole's PART
  is unopposed, and only the methodology knows). Space and numbers sit behind a disclosure, so
  the twenty-second planning path is unchanged. Review gains a sentence the app could not
  previously form: *"Matched-up → overloaded → matched-up. The practice moved back and forth."*
- **Positive:** `describeSessionShape` is possible only because the spectrum is an **ordered**
  enum with no `custom` escape hatch. That closed list is load-bearing, not tidiness.
- **Negative:** `null` now means three different things in the report — *this is not a
  practice*, *this coach did not say*, and *this session predates the field*. Every reader
  treats all three as "say nothing", which is right but does lose information a later phase may
  want back.
- **Negative:** Metres are assumed and stated, never converted. A grassroots coach in England
  is as likely to mean yards, and a silent conversion would put a number in a season report
  that nobody could reproduce with a tape measure.
- **Follow-up:** `groupSize` was checked for derivability first, as the roadmap required, and
  is not derivable. `SessionPhase.focusPlayerIds` is documented and `superRefine`-enforced as a
  *subset of the session's focus players* — the watch list, never the participants — and
  `Squad` carries no roster size. The stepper is therefore seeded from the roster count and
  stepped down, which is a default rather than a derivation. If an attendance model ever lands,
  revisit.
