# Known issues

Bugs and dead code found by reading, not by a failing test. Each entry names the symptom a coach
would see, why the suite is green anyway, and the smallest honest fix.

Turned up by [`review-checking-for-understanding.md`](review-checking-for-understanding.md), which
depends on two of them.

---

## 1. The `✋ Intervene` long-press cannot change the style, so `styleChosen` is always false

- **Severity:** high. It silently disables the app's own honesty mechanism.
- **Found:** 2026-09-10

`InterventionEvent.styleChosen` is the flag that separates *what the coach did* from *what the
coach planned*, and `coaching-style.ts` is built on it: without it, "you are a Command coach" is
the app reading the coach's own plan back to them and calling it evidence.

It is set in one place, and only when the command carries an axis:

```ts
// src/domain/session/state-machine.ts:468
const styleChosen =
  command.method !== undefined ||
  command.mechanic !== undefined ||
  command.audience !== undefined;
```

The comment above it says *"The long-press sheet passes at least one axis; the one-tap button
passes none."* The long-press sheet passes none either. `InterveneButton`
(`src/app/run/page.tsx:802`) opens a sheet with exactly one control — a note field — and calls
`onLog({ note })`. There is no method, mechanic or audience picker anywhere in Do mode.

`src/domain/intervention.ts:110` documents the same missing control:

> Only the long-press override sheet sets this true.

**Consequences**

- `CoachingStyle.chosen` is 0 for every real user, forever.
- The style mix is *always* the plan read back, and the app has no way to tell a coach otherwise.
- Issue 2 below is the visible half of this one.

**Why the suite is green.** `coaching-style.test.ts:38` constructs events with `styleChosen` passed
in directly, so the domain arithmetic is well covered and the fact that nothing ever sets it true is
invisible from there. Nothing tests the wiring from the sheet down to the command.

**Fix.** Put the three axes on the long-press sheet — they are the axes `plan/intervention/page.tsx`
already renders at plan time, and `LogInterventionInput` (`run-service.ts:138`) already accepts
them. The one-tap path must stay untouched: it is right that the common case costs no form.

---

## 2. `describeStyleEvidence` tells the coach to use a control that does not exist

- **Severity:** medium. Visible, and it is advice that cannot be followed.
- **Found:** 2026-09-10

Because of issue 1, this branch is the only one a real user can reach:

```ts
// src/domain/coaching-style.ts:177
return `Every one of these took the style from your plan — tap and hold ✋ Intervene to record what you actually did instead.`;
```

Every coach with twelve or more logged interventions is told, every time, to tap and hold a button
whose long-press only offers a note field.

`docs/user-manual.md` describes the same missing control, so it is currently wrong too:

> Long-press it (right-click on a desktop) for the detail sheet, where you can change the method,
> aim it at one player, or add a note.

You can add a note. You cannot do the other two.

**Fix.** It goes away on its own once issue 1 is fixed, and that is the right fix — the manual
already documents the intended behaviour, so building it makes three things true at once. If the
sheet is not going to gain the axes, the sentence has to stop naming a gesture, the manual has to
be corrected, and the whole chosen/inherited split should come out rather than being reported as
permanently zero.

---

## 3. Two fields are declared, plumbed, and never written

- **Severity:** low as it stands — nothing reads them, so nothing is currently wrong on screen.
  High as soon as something does, which is the situation
  [`review-checking-for-understanding.md`](review-checking-for-understanding.md) §2 describes.
- **Found:** 2026-09-10

**`InterventionEvent.playerIds`** (`intervention.ts:102`). Declared, copied by the state machine
(`state-machine.ts:488`), accepted by `LogInterventionInput` (`run-service.ts:138`) — and no caller
anywhere passes it. Every logged intervention has an empty `playerIds`. So *who the coach spoke to*
is not recorded, and cannot be derived.

**`Observation.coachingPointId`** (`observation.ts:76`). Declared, used by `logObservation` to
inherit a corner (`run-service.ts:217`) — and the observation sheet never passes it. It logs the
coaching point's **text** as a tag instead (`run-service.ts:520`). So every observation has
`coachingPointId: null`, and the link from an observation back to the point it was about exists only
as a string match.

The same is true of `coachingPointId` on the `logIntervention` command: it is in the command type
(`state-machine.ts:79`) but not in `LogInterventionInput`, so it is unreachable from the service
layer too.

**Fix.** Either write them or delete them. Writing them is cheap for the observation
(`coachingPointId` is known when a "This phase" tag is tapped) and costs a control for the
intervention (a player picker on the long-press sheet, which issue 1 is opening anyway). Leaving
them declared is the option to avoid: they read as available data, and the
checking-for-understanding roadmap has already planned two phases on the assumption that they are.

---

## 4. Two more declared-and-never-written, found while building ADR 0009

- **Severity:** low, and one of them is only a documentation problem.
- **Found:** 2026-09-10

**`ObservationKind.effort`** (`observation.ts:34`), commented *"attitude, not ability"*. Nothing
produces it: `logObservation` derives `kind` from `OBSERVATION_RATING_KIND`, which maps
`struggled` and `working` to `development` and `good` to `strength`. There is no path to
`effort` or to `note` with a rating.

This one has a consumer now. `player-card.ts` prefers an `effort` observation for both card
lines, because Hattie's split is the whole reason the card is safe to show a player — and that
preference can never fire on data this app wrote. It is implemented for an imported file and
named as a blind spot in the module, rather than quietly dropped.

**`SessionPhase.coachPrompts`** (`session.ts:139`). Carried onto the phase by
`build-from-methodology.ts:149` under the comment *"Carried through so Do mode can show the
coach their own reminder of what this is for"* — and no screen renders it. Every preset writes
them, several are genuinely useful (*"Let them tell you what changed."*), and no coach has ever
seen one.

**Fix.** For `effort`, either give the observation sheet a fourth token or accept that the
distinction is aspirational and say so where it is declared. For `coachPrompts`, it is one line
in Do mode next to the `Expect` line that ADR 0009 phase 2 added — the same shape, in the same
place, and the field is already populated.
