# ADR 0003 — Singleton routes, not dynamic segments, for user data

- **Status:** Accepted
- **Date:** 2026-08-31
- **Divergence from:** `hodorhub` (`/projects/[projectId]`-style dynamic segments)

## Context

`output: 'export'` prerenders a fixed set of paths. A dynamic segment such as
`/sessions/[sessionId]` requires `generateStaticParams()`, and at build time we cannot know the
UUID of a session a coach will create next March. There is no server to render the miss.

The usual workaround is a service-worker navigation fallback that serves a shell for any
unmatched path. It fails in exactly the case that matters: **the very first load, before the
service worker has installed**, where the host returns a hard 404. On GitHub Pages that is a
real 404 page, not a rewrite we control.

## Decision

**Model the hot path as singleton routes, and put ids in search params only on cold screens.**

The insight is that the constraint matches the domain. A coach never has two sessions in
flight. There is exactly one draft, one active run, and one session awaiting review:

| Route | Meaning |
| --- | --- |
| `/plan` | *the* draft |
| `/plan/phases`, `/plan/intervention` | detours off *the* draft |
| `/run` | *the* in-progress session |
| `/review` | *the* completed session awaiting review |

Which session each refers to is read from the store (`sessions.findActive()`, plus the
`activeSessionId` mirror in `app_meta` and `localStorage`), not from the URL.

Search params carry ids only on the two cold history-browsing screens, where a miss is
recoverable and no timer is running: `/sessions/detail/?s=<id>` and `/squad/player/?p=<id>`.
Search params are read client-side and never affect which HTML file the host must produce.

## Consequences

- **Positive:** Every route is a real static file, fully precached at install, and works on a
  cold first load with no service worker. Deep-linking into a run is impossible — which is
  correct, since "resume" is a state question, not a URL question. Navigation between Plan, Do
  and Review is a plain link with no id-threading.
- **Negative:** No shareable link to a specific past session, and no browser-history stack of
  distinct sessions. Both are acceptable for a single-user on-device app; neither is on the
  pitch-side path.
- **Follow-up:** if multi-session planning ever lands (planning next week's three sessions in
  one sitting), revisit — either with a hash route, or by accepting the service-worker fallback,
  since by then the app is installed and the worker is guaranteed present.
