# ADR 0002 — A client-heavy App Router tree

- **Status:** Accepted
- **Date:** 2026-08-31
- **Divergence from:** `hodorhub` (Server Components by default, `'use client'` by exception)

## Context

The house default is React Server Components: fetch on the server, ship less JavaScript, mark
only interactive leaves `'use client'`. That default assumes a server.

This app is built with `output: 'export'`. There is no Node process at runtime — `next build`
emits static HTML, and GitHub Pages serves the files. A Server Component here renders **once,
at build time**, against a machine that has never seen the coach's data. Every byte of state
this app displays lives in the visitor's IndexedDB, which exists only in the browser.

## Decision

**Invert the house default for this project.** Server Components remain the correct pattern in
`hodorhub`; here they are structurally inapplicable to anything data-bearing.

- `src/app/layout.tsx` **stays a Server Component.** It exports `metadata` and `viewport`, which
  Next.js can only collect from a server component, and renders an `<AppProviders>` client
  boundary as its child.
- **Every route page that touches stored data is `'use client'`.** In practice that is all of
  them.
- Reads go through a single `useSyncExternalStore`-backed module store in `src/lib/store.ts`
  rather than per-component `useEffect` fetches, so a write in one component repaints every
  subscriber without a client state library.
- Rendering during the pre-hydration pass must not assume IndexedDB exists. Components render a
  loading state until the store reports it has opened.

## Consequences

- **Positive:** Every route is a real prerendered HTML file the service worker can precache and
  serve offline. No hydration mismatch between a server that saw data and a client that sees
  different data, because the server saw none. One data-access idiom across the whole app.
- **Negative:** A larger JavaScript bundle than a server-rendered app of the same size, and a
  brief empty state on cold start while IndexedDB opens. The second is mitigated by a
  synchronous `localStorage` mirror of `{ activeSessionId, squadId }`, so the home screen can
  paint `Resume — Main practice, 8:42 left` before the database has finished opening.
- **Guardrail:** the "keep it a server component" review reflex does not apply in this repo.
  This ADR is the answer to that review comment.
