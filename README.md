# Pocket Session Planner

An offline-first PWA for football coaches: plan a training session in under twenty seconds,
run it pitch-side from your phone, and review it in five taps — with the review seeding the
next session.

No account, no server, no signal required. Every byte lives on the device.

**Using it as a coach?** [`docs/user-manual.md`](docs/user-manual.md) is the manual: the
Plan → Do → Review loop screen by screen, player challenges, the two FA models, and what to do
when something looks wrong. The rest of this file is for whoever builds it.

## Why it exists

Existing session planners are desktop-shaped: they treat the plan as a document you write
beforehand and never look at again. This one is built for the coach standing on a pitch in
the rain holding a ball, and it closes the loop — **Plan → Do → Review → Plan**.

Three things it does that a notes app cannot:

- **It runs the session.** A phase timer built on wall-clock anchors that survives screen
  lock, a force-quit and a device clock change; two-tap player observations; one-tap
  intervention logging.
- **It measures how you coached.** *"You stopped play 9 times in a 20-minute practice. Ball
  rolling time: 61%."* That single line is the most useful feedback the app can give, and it
  falls straight out of the model.
- **It carries forward.** The review produces actions that pre-fill the next session's
  objective, focus players and coaching points — and flags when you have chased the same
  point for three sessions running.
- **It tracks the whole player.** Observations are filed against the
  [FA 4 Corner Model](https://learn.englandfootball.com/articles-and-resources/coaching/resources/2022/the-fa-4-corner-model),
  so the app can say *"34 observations of Kai: 29 technical, 5 physical — nothing psych or
  social."*

## The FA 4 Corner Model

> "Each of these 'corners' is equally important, and no one corner works in isolation."

The model exists to stop a coach developing a *quarter* of a player. The app implements it in
two halves, deliberately different in cost:

**The balance report is free.** Every observation carries a corner, inferred from the tag the
coach tapped rather than asked for as a third decision — logging stays at two taps. The
observation sheet groups its tags under the four corners, which means the empty corner is
visible *at the moment of logging*, not only in the report afterwards. `cornerBalance()` then
turns a term of observations into one sentence, and `/review` shows the same coverage for a
single session next to the intervention report.

It stays quiet below eight classified observations. Three technical notes on a Tuesday is not
a development bias, and an app that cries "you never look at the social corner" after one
session is an app the coach learns to ignore.

**The assessment is deliberate.** Four taps on the player profile records where a player is
across all four corners, so the same question in three months has something to compare
against. Nothing is required — a coach with a view on two corners records two, and
`cornerDeltas` only reports movement on corners rated in *both* assessments rather than
inventing a change out of an omission.

Carry-forward gains one rule from this: a focus player with a genuinely lopsided history
produces an unticked *"Look at the psych corner with Kai"* proposal. Unticked on purpose — it
is a nudge, not homework.

Note on the attribute lists in `src/domain/four-corners.ts`: the FA publishes the four corners
and the principle, but **not** a canonical enumeration of attributes. Ours is a curated
grassroots list chosen to be tappable on a phone in the rain. It should not be quoted as an
official FA taxonomy.

## Getting started

```bash
npm ci
npm run dev      # http://localhost:3000
```

The service worker is disabled in development. To exercise offline mode you need a
production build (see [Verifying the offline claim](#verifying-the-offline-claim)).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server, no service worker |
| `npm run build` | Static export to `out/`, service worker to `public/sw.js` |
| `npm run lint` | ESLint 9 flat config |
| `npm run format` / `format:check` | Prettier 3 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `test:watch` | Vitest |
| `npm run test:coverage` | Vitest with the 90/90/90/85 gate |

CI runs them in the order `format:check → lint → typecheck → test:coverage → build`.

## Architecture

```
src/
  domain/     pure types (zod) + pure logic. No I/O, no React. Highest coverage.
  data/       repository ports + the IndexedDB adapter + the in-memory fake.
  modules/    services composing domain + data. One folder per bounded context.
  lib/        clock, id, Result, the React store binding.
  app/        App Router routes + _components. The only place React lives.
```

Dependencies point strictly inward: `app → modules → data (ports) → domain`. Nothing above
`data` touches IndexedDB, which is what lets every service test run headless in milliseconds
against `FakeDataStore`.

### Three decisions everything else hangs off

1. **The timer is wall-clock anchors, never a decrementing counter.** State is
   `{ startedAt, runningSince, accumulatedMs }`; elapsed time is *derived*. `setInterval`
   only forces repaints — deleting it would change the refresh rate and not one displayed
   number. Screen lock, tab discard, throttling, refresh and app kill all survive for free.
2. **Sessions snapshot their methodology.** A frozen `MethodologySnapshot` means editing or
   deleting a methodology — or shipping an improved preset — can never rewrite history.
3. **Plan data and run data are strictly separated.** `SessionPhase` is plan-time only; what
   happened lives in `Session.run.phaseRuns[]` and the `observations` store. Re-planning can
   never corrupt evidence.

The decisions worth arguing with are recorded as ADRs. The first three are divergences from the
house conventions in `hodorhub`; the rest are modelling calls this app had to make on its own.

- [ADR 0001](docs/adr/0001-indexeddb-not-drizzle-postgres.md) — IndexedDB behind a repository port
- [ADR 0002](docs/adr/0002-client-heavy-app-router.md) — a client-heavy App Router tree
- [ADR 0003](docs/adr/0003-no-dynamic-route-segments.md) — singleton routes, not dynamic segments
- [ADR 0004](docs/adr/0004-structured-practice-design.md) — practice design as data, with
  `organisation` kept as free text
- [ADR 0005](docs/adr/0005-match-day-as-a-session-kind.md) — match day as a `Session` kind, not a
  second aggregate
- [ADR 0006](docs/adr/0006-tactical-periodization-without-the-morphocycle.md) — tactical
  periodization's tactical core, without the morphocycle *(superseded by 0007)*
- [ADR 0007](docs/adr/0007-morphocycle-for-adult-squads.md) — the morphocycle, for adult squads,
  with the coach's own pattern
- [ADR 0008](docs/adr/0008-periodization-behind-a-flag.md) — the whole periodization set
  behind a default-off flag in Settings
- [ADR 0009](docs/adr/0009-checking-for-understanding.md) — checking for understanding as
  records of coach actions, never a measurement of a player

## Testing

The whole data and domain layer runs headless. `FakeClock` and `FakeIdGenerator` make every
time- and id-dependent function deterministic, and `src/test/builders.ts` supplies `aSession()`
/ `aPlayer()` builders.

The highest-value files, in order:

1. `domain/session/timer.test.ts` — the single most important file in the project. Walks a
   `FakeClock` through pause, resume, screen lock, force-quit, overrun, a clock-pausing
   intervention and a backwards clock change, re-deriving at every step.
2. `domain/session/phase-scaling.test.ts` — the rounding edge cases.
3. `domain/session/state-machine.test.ts` — every command against every status.
4. `domain/intervention.test.ts` — precedence, budget arithmetic including `maxPerPhase: 0`.
5. `data/ports/data-store-contract.ts` — **one contract, two implementations**, run against
   the in-memory fake *and* the real IndexedDB adapter under `fake-indexeddb`.
6. `modules/review/derive-carry-forward.test.ts` — one test per rule in the trigger table.
7. `modules/transfer/transfer-service.test.ts` — a round trip: `import(export(db))` equals `db`.

No IndexedDB above the data layer, ever. Every service test uses `FakeDataStore`.

## Verifying the offline claim

The one thing a dev server cannot tell you:

```bash
npm run build
npx serve out -l 3000     # note: see the base-path caveat below
```

Then in Chrome DevTools: **Application → Service Workers** shows `sw.js` activated;
**Application → Cache Storage** lists all eleven routes plus chunks, icons and CSS; tick
**Network → Offline**, hard reload, and navigate every route. Anything that 404s is missing
from the precache manifest.

**Base-path caveat.** Production builds are served from `/pocket-session-planner/`, so
serving `out/` at the root will 404 on every asset. To reproduce the deployed layout locally,
put the build inside a directory of that name and serve the parent:

```bash
mkdir -p site/pocket-session-planner && cp -r out/* site/pocket-session-planner/
npx serve site -l 3000
# then open http://localhost:3000/pocket-session-planner/
```

Or build without a base path: `NEXT_PUBLIC_BASE_PATH= npm run build`.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` builds and publishes to GitHub Pages.

Set **Settings → Pages → Source** to **GitHub Actions**, not a branch.

A base-path mistake shows up on the deployed site and nowhere earlier, so the checklist is:

- `public/.nojekyll` exists — without it GitHub Pages ignores `_next/` and every script 404s.
- `manifest.ts` prefixes `start_url`, `scope` and every icon `src`.
- The service worker registers at `${basePath}/sw.js` with scope `${basePath}/`.
- Anything referenced from `public/` by a raw string gets `asset()` applied by hand —
  `basePath` does not rewrite those.

## Field testing

The only test that really counts is on a phone. See
[`docs/field-test-checklist.md`](docs/field-test-checklist.md).
