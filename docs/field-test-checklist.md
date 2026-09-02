# Field test checklist

The automated suite proves the arithmetic. This proves the app.

Serve the production build over the LAN, install it to the home screen, and work through the
list on a real phone. Everything here is a claim the app makes that only a device can falsify.

```bash
npm run build
mkdir -p site/pocket-session-planner && cp -r out/* site/pocket-session-planner/
npx serve site -l 3000
# then open http://<your-lan-ip>:3000/pocket-session-planner/ on the phone
```

> `crypto.randomUUID` needs a secure context, so a plain-http LAN test falls back to the
> random-bytes id generator. That path is covered by tests, but it is worth knowing that this
> is the one configuration where it runs.

## Offline and install

- [ ] Cold open in airplane mode. **Every** route works: `/`, `/plan`, `/plan/phases`,
      `/plan/intervention`, `/run`, `/review`, `/sessions`, `/sessions/detail`, `/squad`,
      `/squad/player`, `/settings`.
- [ ] Installs to the home screen, with the right icon and no browser chrome.
- [ ] Long-press the home-screen icon: `Start a session`, `Resume` and `Squad` shortcuts work.
- [ ] Settings shows a storage estimate and offers to protect storage if it is not yet
      persisted.

## The create flow — the headline requirement

- [ ] **Time it.** Squad home → running session in **under 20 seconds**, no typing. If it is
      slower, the flow is not done.
- [ ] Intervention configuration costs **zero taps** on the default path — it appears as one
      read-only line under the methodology control.
- [ ] Changing methodology re-derives the phases and the intervention plan. Changing the
      intervention by hand first, *then* the methodology, keeps the hand-made choice.
- [ ] `Repeat` on the last-session card lands on the phase editor in two taps.

## Running a session

- [ ] Portrait, 667px: Do mode fits with **zero scrolling** except inside the coaching-points
      box. Check on the smallest phone you have.
- [ ] Lock the phone for five minutes. Unlock — the timer shows the **correct remaining time**,
      not a frozen or reset one.
- [ ] Force-quit the app mid-phase. Reopen — `/` offers `Resume` with the elapsed time intact,
      and it paints before the database has finished opening.
- [ ] Log observations against three focus players. **Two taps each.**
- [ ] A focus player with no observations in this phase is visibly dimmed.
- [ ] `Next phase` shows an 8-second Undo. Take it — the previous phase resumes **with its
      elapsed time intact**.
- [ ] Tap `✋ Intervene` more times than the phase budget allows. The counter turns `over`,
      nothing blocks, and nothing shows a dialog.
- [ ] For a stop-play mechanic the phase clock **pauses** and the live bar counts the stoppage;
      for `in_flow` it does not.
- [ ] Force-quit **mid-intervention**. Reopen — the clock is still stopped and the intervention
      is still open. Resume play and check the stoppage duration is honest.
- [ ] The wake lock survives a pocket-check: lock, unlock, and confirm the screen still stays
      awake afterwards.

## The FA 4 Corner Model

- [ ] Open the observation sheet: tags are grouped under the four corners, and every corner is
      reachable without scrolling past the fold.
- [ ] Log via a corner tag. Check the player profile files it under the right corner **without
      you having chosen one** — the tap count must not have gone up.
- [ ] Log an untagged note. It stays out of the corner bars and is reported separately as
      "no tag", rather than being filed under a guess.
- [ ] With fewer than eight tagged observations, the balance panel makes no accusation.
- [ ] Past eight, an empty corner shows an empty track and the word **none** — legible in
      sunlight, and not colour-only.
- [ ] Record a 4 Corner check. Four taps, and skipping a corner is allowed.
- [ ] Record a second one later. Only corners rated in both show a change.
- [ ] Review a session for a player with a lopsided history: the *"look at the X corner"*
      proposal appears **unticked**.
- [ ] Export, import on a second device, and confirm the 4 Corner checks came across.

## Reviewing, and closing the loop

- [ ] Finish the session. `/review` restates the objective verbatim and needs no typing.
- [ ] The intervention report matches what you actually did, and appears **before** the
      carry-forward chips.
- [ ] Accept the carry-forward chips. Start the next session and confirm the objective, focus
      players and coaching points are pre-seeded and marked *carried*.
- [ ] Run the same unresolved point through three sessions and confirm the planner warns:
      *"change the practice, not the point."*

## Conditions

- [ ] **Outdoors in daylight**: read the timer at arm's length. Read the phase name. Read a
      coaching point.
- [ ] **At night under floodlights**: dark mode is legible and not dazzling.
- [ ] **With gloves on**: hit `Next phase` ten times without a mis-tap. Then try `End` — it
      should be noticeably harder to reach, which is correct.
- [ ] **With a wet screen**: confirm no destructive action is a single mis-tap away without an
      undo.

## Data safety

- [ ] Export. Open the file — it should be readable JSON a person could understand.
- [ ] Import it into a second device. The dry run reports the counts before anything is
      written; the commit produces an identical squad.
- [ ] Re-import the same file. Nothing changes.
- [ ] Try importing while a session is running. It refuses.

## Deploy

- [ ] Push to `main`, confirm the Actions run publishes.
- [ ] Load `https://<account>.github.io/pocket-session-planner/` on a phone that has **never**
      seen the app. Install it. Repeat the offline and resume checks.
- [ ] Lighthouse: PWA installable, and Accessibility **≥ 95** on `/run` and `/plan`.
- [ ] axe: no violations on `/run`, `/plan` and `/review`.
