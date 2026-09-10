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
      `/plan/challenges`, `/plan/intervention`, `/run`, `/review`, `/sessions`,
      `/sessions/detail`, `/squad`, `/squad/player`, `/settings`.
- [ ] Reach `/plan/challenges` **by tapping through from the phase editor**, not by typing the
      URL. It shipped once without reaching the precache manifest, and only a cold offline tap
      would have caught it — the app fell back to home and looked like a mis-tap.
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

## Match day

Everything here is new and none of it has been on a pitch. The presence tick is the single
point of failure for the whole minutes report — if it is awkward mid-game the record simply
will not get kept, and every number downstream of it is then absent rather than wrong.

- [ ] `Match day instead` is on the home screen without hunting for it.
- [ ] With an age group set on the squad, the **format is already right** and the shapes offered
      are only that format's. Clear the age group and check it falls back without breaking.
- [ ] Pick a shape, then check the unit inputs offered match the units it fields — a `2-1`
      must not ask you for a midfield.
- [ ] **Time it.** Home → running match. Only the opponent should need typing.
- [ ] Quarters as well as halves. The middle break reads `Half time`, the others `Break`.
- [ ] In a period, confirm there is **no intervention budget** — the app must not offer to stop
      a referee's game. At half time, confirm there is one.
- [ ] **`Who is on?` with one thumb, standing up, while the game is running.** This is the one
      that matters. It should open with the previous period already ticked, so a period with no
      changes is a single confirm.
- [ ] Tick a period, then reopen it and change one player. The count must not double.
- [ ] Force-quit mid-match. Reopen — the presence you ticked is still there.
- [ ] Review: minutes **least played first**, with anyone who did not get on at the top. Check
      the numbers against what you actually remember doing.
- [ ] A half the referee stretched should report the minutes it really ran, not the planned ones.
- [ ] Rule each unit met / partly / missed, then tap the same verdict again to clear it.
- [ ] Add the score, then clear it. Confirm nothing in the carry-forward chips changes either way.
- [ ] History: the match reads as a fixture — opponent and a `Match` pill — and is
      distinguishable at a glance from the Tuesday before it.
- [ ] Export, import on a second device, and confirm the minutes report recomputes **the same
      numbers**. This is the only copy those ticks exist in.

## Reviewing, and closing the loop

- [ ] Finish the session. `/review` restates the objective verbatim and needs no typing.
- [ ] The intervention report matches what you actually did, and appears **before** the
      carry-forward chips.
- [ ] Accept the carry-forward chips. Start the next session and confirm the objective, focus
      players and coaching points are pre-seeded and marked *carried*.
- [ ] Run the same unresolved point through three sessions and confirm the planner warns:
      *"change the practice, not the point."*

## The tactical periodization flag (ADR 0008)

The switched-off state is the default, so it is the one every other section is already
exercising. These items check the half nobody will remember to look at.

- [ ] On a fresh install, `/squad` leads with the roster: no `Game model`, no `The week`, no
      `Squad level`. `/plan` step 1 offers no principle picker.
- [ ] `Settings -> Planning` turns it on. Without a reload, `/squad` and `/plan` both show the
      periodization controls — one store, one repaint.
- [ ] Author a game model, then turn the flag off. Turn it back on: the model is still there,
      word for word. **This is the promise the Settings copy makes.**
- [ ] With the flag off, open `/plan/week`, `/plan/prepare` and `/squad/game-model` by URL.
      Each says it is turned off and offers Settings — no blank screen, no crash page.
- [ ] Install to the home screen with the flag on, add a shortcut or bookmark to `The week`,
      then turn the flag off. Reopen the shortcut **offline**: the precached route still loads
      and still explains itself.
- [ ] Export with the flag on, turn it off, and import the file back. The flag stays off — it
      is device meta and must not travel.
- [ ] Turn the flag off on a senior squad and confirm `Squad.level` is untouched: turn it back
      on and the squad is still `Senior`.

## Crashes

- [ ] Force a crash on a screen (temporarily throw in a component). Confirm you get the
      recovery page and **not a blank white screen**, and that `Reload and carry on` resumes a
      running session with its elapsed time intact.
- [ ] Crash during a session, force-quit, reopen. The report is still in Settings.
- [ ] With a squad loaded, trigger an error whose message contains a player name — confirm the
      stored report shows `[name]` and not the name. **This is the one that matters.**
- [ ] Send a crash report and read the issue GitHub opens. Check the stack is legible and that
      nothing about the squad survived.
- [ ] Trigger the same crash repeatedly. It should stay one report with a count, not fill the list.
- [ ] Discard a report, and discard all.

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
