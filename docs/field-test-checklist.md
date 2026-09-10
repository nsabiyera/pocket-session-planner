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

## Checking for understanding (ADR 0009)

**All six phases.** The `checked` state and its review line, the predicted misconception, the
regression offer, the player cards, the questioning and did-it-stick reports, and the two
carry-forward nudges plus the takeaway. Every line here is silent below its floor or absent when
unset, by design, so **a broken one looks exactly like a quiet one**: check the negative cases as
carefully as the positive ones.

### The mistake you expected (phase 2)

- [ ] Build a session from an objective **chip**. Do mode shows an `Expect` line under the
      objective, and it is the sentence from that objective rather than a generic one.
- [ ] **Portrait, 667px, with the `Expect` line showing.** Do mode still fits with zero
      scrolling outside the coaching-points box. This is the item most likely to fail — the
      line is clamped to two lines for exactly this reason, and two lines on a small phone is
      the case to check.
- [ ] Build a session by **typing** your own objective. There is **no** `Expect` line at all —
      not an empty one, not a placeholder.
- [ ] Open the observation sheet. **The mistake you expected** is the second group, directly
      under `This phase`, with one chip carrying the whole sentence.
- [ ] Log a `Struggled` with that chip tapped. Open the session in history — the observation
      carries the misconception verbatim in its tags.
- [ ] The same sheet on a typed-objective session offers no such group.
- [ ] Review an objective, accept the `Revisit:` chip, and start the next session. The `Expect`
      line **comes back with it** — this is the session where the prediction earned its keep.
- [ ] Open a session planned **before this shipped**. No `Expect` line, no chip, no error.

### And what to do about it (phase 3)

This is the only part of the feature that acts inside the session, so it is the part where
being wrong costs the coach something. **The failure to look for is a bar that nags.**

- [ ] In a practice phase with a regression written, log a `Struggled` with the misconception
      chip. The offer bar appears above the two big buttons, carrying **your own** regression
      text, not a suggestion of the app's.
- [ ] Tap it. The practice adjustment is recorded, the bar goes, and `Undo` is on the toast.
- [ ] Log the same thing again in the same phase. **No bar** — you have already responded.
- [ ] Log it, then make the practice easier from the **phase sheet** instead. The bar goes.
      Responding by another route still counts as responding.
- [ ] Log it, then make the practice **harder**. The bar stays.
- [ ] Move to the next phase. The bar goes, whether you acted on it or not.
- [ ] Log a `Working` with the misconception chip. **No bar** — a player wrestling with it is
      where the learning is, and making it easier would take the practice away.
- [ ] Log a `Struggled` with a different tag. **No bar.**
- [ ] Do the same in Whole-Part-Whole's second WHOLE game, which ships no regressions on
      purpose. **No bar**, and nothing explaining its absence.
- [ ] With the bar showing, portrait at 667px: Do mode still fits. It is two lines tall and it
      sits where the intervention bar sits, so both showing at once is the case to check.
- [ ] Ignore the bar for a whole phase. Decide honestly whether it read as a useful reminder or
      as the app telling you off. If it nagged, it needs a dismiss — there is deliberately
      none, and this is the item that would change that.

### The intervene sheet, and the two reports it unblocks (phase 5)

Three shipped bugs meant `styleChosen`, `playerIds` and `coachingPointId` were never written by
any screen, so **every one of these is a first**. There is no historic data behind them: a
session run before today will show the empty-record wording, and that is correct.

- [ ] **Long-press `✋ Intervene`.** The sheet now has what the manual always claimed: what you
      did, how you stopped it, who it landed on, who you spoke to, and a note.
- [ ] Change the method and log it. Finish, and on `/sessions` the `How you coach` panel no
      longer says *"every one of these took the style from your plan"* — it splits them.
- [ ] Log one with **only a note** changed. It still counts as inherited, not chosen. A note is
      not a style.
- [ ] One-tap `✋ Intervene` with no sheet at all: still one tap, still no form. **This is the
      thing not to break.** Time it if you have to.
- [ ] Name two players on a Q&A intervention. Log four questions naming somebody on each. The
      review says *"4 questions, to N players"* and, if anyone was left out, *"…were never
      asked anything."*
- [ ] Now log four questions naming nobody. It says the count and offers the control — and
      **says nothing at all about who was never asked**, because that would be a claim the
      record cannot support. This is the honesty case and the one worth reading twice.
- [ ] Mix them: some named, some not. It says how many you recorded and stops there.
- [ ] Log three questions only. **No line** — the floor is four.
- [ ] Tick a coaching point as said, then log an observation with **that point's own tag**. The
      review says something was logged against it afterwards.
- [ ] Log the observation **before** ticking the chip. It does not count — a follow-up has to
      follow.
- [ ] Tick two points and log nothing. It says *"nothing logged about any of them
      afterwards"* — and never that they did not stick, or land, or work.
- [ ] Tick one point only. **No line** — the floor is two, because the value is the ratio.

### The loop closes (phase 6)

This needs **two sessions**, and the never-checked nudge needs **three** — so it is the only
section here you cannot test in one sitting. Use the seed data if you would rather not wait.

- [ ] Review a session, open `What did you leave them with?`, and type one sentence. Save.
- [ ] Plan the next session. The phase editor shows **Last week you told them** with that
      sentence, quoted, above `Before you go`.
- [ ] Leave the field empty on a review. The next session shows **no** section at all — not an
      empty quote, not a placeholder.
- [ ] Skip it one week and fill it the week before. It reads back the one you *did* write,
      rather than going silent. This is the case that would otherwise look broken.
- [ ] Tick a point as **checked** and log a `Good` against it. On the review, `Ask again: …`
      appears among the carry-forward chips, **unticked**, and its `?` explains that how it
      looked on the night is a poor guide to whether it stuck.
- [ ] Accept it. Next session's phase editor lists it under `Before you go` — **not** as a
      coaching point chip in Do mode. Re-saying is the thing it exists to avoid.
- [ ] Tick the same point as **said** and never checked, three sessions running.
      `Check this one: …` appears on the third review, unticked, saying *"Said in 3 sessions
      running, and never checked in any of them."*
- [ ] Check it once. The nudge is gone the following week — a point checked once has been
      checked.
- [ ] Put the same point in two phases of one session. It does **not** count as two sessions of
      streak.

### What to tell them (phase 4)

The first thing this app has ever rendered for somebody other than the coach, so the tests
that matter are the ones a **player** would fail it on. Do these with the phone at arm's
length, as if a huddle were in front of you.

- [ ] With a focus player or a challenge set, `💬 Tell them` appears after the focus chips.
      With neither, it is **absent** — no greyed-out chip, no empty sheet.
- [ ] Open it mid-huddle. Every line is legible **at arm's length**, and the quote is bigger
      than its label. If you have to bring the phone closer to read it, the card is the wrong
      size.
- [ ] Read one out loud to a player. Does it give them something to do, or does it read as a
      score? The second is a failure even if every field is correct.
- [ ] A player with a challenge shows the ask **as you typed it**, with its tally, and a
      verdict only once you have ruled on it — never the word `Open`.
- [ ] A player you logged nothing about says *"Nothing logged for Kai today."* and nothing
      else. It should not read as an apology or a rebuke.
- [ ] Log a `Good` with **no tag**. It does not appear on the card — *"you were good"* is what
      the card exists to prevent.
- [ ] Log a `Struggled` on the misconception chip. It becomes the **Next** line, in preference
      to anything else struggled.
- [ ] Log four tags on one observation. The card reads out **one**.
- [ ] Check nothing on the card is a rating, a count, a corner, a capability or another
      player's name. This is the one that matters most, and it is a reading test, not a code
      one.
- [ ] Twelve players in front of you, two or three cards. Is a sheet the right shape, or did
      you want to swipe one player at a time? This is the open question the roadmap left, and
      only a touchline answers it.

### Said it, and checked it (phase 1)

- [ ] Tap a coaching point three times with gloves on. It goes `○ → ✓ → ✓✓` and the text does
      **not shift sideways** when the second tick appears.
- [ ] A fourth tap returns it to `○`, and both ticks are gone. This is the mis-tap escape and it
      must not need a long press.
- [ ] With a screen reader on, the button announces the point text **and the state in words** —
      not just a tick.
- [ ] `✓✓` is legible against `✓` at arm's length in daylight. If you cannot tell them apart
      from a metre away, the glyph is wrong however good the arithmetic is.
- [ ] Force-quit mid-phase with one point at `✓✓`. Reopen and resume — it is still `✓✓`.
- [ ] Finish a session with 5 points said and 1 checked. Review says exactly
      *"5 coaching points delivered. 1 checked."*
- [ ] Finish one with points said and **none** checked. It says *"None marked checked."* — not
      "none checked", and nothing that reads as a telling-off.
- [ ] Finish one with **no** points ticked at all. The line is **absent**, not zeroed — the
      *"Didn't get to: …"* proposals cover that case instead.
- [ ] Open the `?` beside the line. It says the app is counting what you did and does **not**
      claim anybody understood anything.
- [ ] Open a session you ran **before this shipped**. It reads as unchecked, parses without
      error, and nothing in the app calls it a failure.

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
