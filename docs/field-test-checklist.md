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

**All seven phases.** The `checked` state and its review line, the predicted misconception, the
regression offer, the player cards, the questioning and did-it-stick reports, the two
carry-forward nudges, the takeaway, and the player's own word on a challenge. Every line here is silent below its floor or absent when
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

### The player's own word (phase 7)

The only field in the app that records something a **player** said, and the only one that puts
a keyboard in a pitch-side flow. **The thing to judge is whether you would ever actually type
it standing on a pitch** — if not, it belongs only on the review, and this is the item that
would change that.

- [ ] Open a challenge's `⌄` ruling sheet in Do mode. `What did you say about it?` is below the
      verdict, not above it. Type a sentence and close the sheet.
- [ ] Reopen it. The sentence is still there.
- [ ] **Type with wet or gloved hands, mid-session, with a drill running.** Honestly: did you
      finish the sentence, or did you give up? Either answer is useful.
- [ ] Type it, then rule the challenge `Missed`. The quote survives the ruling — writing one
      must never disturb a verdict, and vice versa.
- [ ] Rule it first, then type. Same result.
- [ ] Blur the field without changing anything. Nothing is written — check the session did not
      get a pointless update.
- [ ] Open `💬 Tell them`. The quote is on that player's card under **You said**, in quotes and
      in italics, clearly not the app's own prose.
- [ ] Read it back to the player. Does it land as a check, or as being quoted at?
- [ ] On `/review`, the same field is on each challenge row. Type one there for a judged
      challenge — the one Do mode can no longer settle.
- [ ] Save the review, then open the session from history. **Challenges** is a new section, and
      the quote is on it. If it is not findable here it is write-only, which was the whole
      reason this section exists.
- [ ] Leave it blank everywhere. No empty quote marks, no placeholder, no gap on the card.

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

## Teaching Games for Understanding (ADR 0011)

### The options, as chips (phase 5)

- [ ] Build a session from a chip with options — *When to keep it and when to go* is the purest.
      Open the observation sheet: **The options** is the third group, under *This phase* and *The
      mistake you expected*.
- [ ] **Logging is still two taps.** Player, token, done — the options are there to be used, not
      to be required, and a log with no option tapped saves exactly as before.
- [ ] Tap an option. Open the session in history: the observation carries it verbatim as a tag.
- [ ] **Nothing happens.** No offer bar, no regression prompt, no toast beyond the usual. An
      option is not an error, and only the predicted misconception routes anywhere.
- [ ] Build from **Scanning before receiving**. There is **no** options group at all — not an
      empty heading. Same for a typed objective.
- [ ] **Portrait, 667px.** The sheet still shows the three rating tokens without scrolling past
      them to reach the tags. This is the group that could break the sheet.
- [ ] Read the chips as a coach who has not read this file. Does the first one look like the
      right answer? If it does, the order is doing the wrong job and phase 5 needs rethinking.

### The same game, twice (phase 4)

Whole-Part-Whole only. Plan a session with it and the two WHOLE games arrive paired.

- [ ] Open the **second** WHOLE in the phase editor. It reads *"Both games match on everything
      recorded, so the comparison holds."*
- [ ] Shrink its grid by 5 m and **watch the line change while you are still in the sheet** —
      before saving. That immediacy is the whole point of the editor surface.
- [ ] **Save anyway.** It saves. Nothing is blocked, nothing is reverted, no confirm dialog.
- [ ] Open the **first** WHOLE instead and change *its* grid. The same comparison appears —
      breaking the first game breaks the claim just as thoroughly as breaking the second.
- [ ] Add a condition to one game only. The line says *"has 1 condition the first did not"* or
      *"drops 1 condition the first had"*, and the grammar reads properly in both.
- [ ] Clear the spectrum on one of the two. The line stops mentioning practice type rather than
      reporting it as a change — **a gap is not a difference**.
- [ ] Run and review it. The same sentence appears once on `/review`, under the
      representativeness line.
- [ ] Plan a **Play-Practice-Play** session. No pairing line anywhere, in the editor or the
      review — four of the five presets pair nothing and should say nothing.
- [ ] **Save your own version of Whole-Part-Whole** from Settings, then plan with the clone. The
      pairing still works. This is the case the clone remap exists for, and a failure here shows
      up as an error naming a field you have never seen.
- [ ] Delete the first WHOLE from a planned session. The app refuses the write rather than
      leaving a pairing pointing at nothing — check the message is legible, not a Zod dump.
- [ ] Open a Whole-Part-Whole session planned **before this shipped**. No pairing, no error.

### Direction and targets (phase 3)

- [ ] Open a phase from a **Play-Practice-Play** plan. The `What are they playing towards?` row
      sits directly under the spectrum, and both PLAY phases already read **Two goals** without
      you tapping anything.
- [ ] **Four chips across at 375px**, on one row, no wrapping mid-label and no chip under 44px.
- [ ] Tap the pressed chip again. It clears back to `Not set.` — the same take-it-back gesture
      the spectrum and the challenge verdicts use.
- [ ] Open the **PRACTICE** phase of that same plan. It is **not set**, and that is correct: the
      methodology has no view on whether your overload runs to a goal or as a rondo.
- [ ] **Do mode shows none of this.** Check the phase card and the header — direction appears
      nowhere while the session runs, by design.
- [ ] Plan a session ending on a matched-up game at a known grid with a group size, run it, and
      review. The representativeness line reads *"…at N m² a player, **to two goals**"*.
- [ ] Set the last practice to **No target** instead and review again. The same line reads
      *"…with nothing to score in"*. These two sessions used to be the same record — that
      difference is the whole phase.
- [ ] Leave direction unset and review. The line reads exactly as it did before phase 3, with no
      trailing comma and no gap.
- [ ] A session with direction set but **no** spectrum and **no** grid shows **no**
      representativeness line at all, rather than half a sentence.
- [ ] Tap the `?` beside the chip row. It says the four are not ranked.
- [ ] Open a session planned **before this shipped** in history. No direction, no error.
- [ ] Export, re-import onto a second device, and check a seeded phase still reads **Two goals**.

### The game problem, pinned (phase 2)

- [ ] **Portrait, 667px, with both the `Problem` and `Expect` lines showing.** Do mode still
      reaches the two 96px actions with no scrolling. **This is the item most likely to fail in
      the whole checklist** — it was already the tightest thing on the screen with one pinned
      line, and there are now two. If it fails, the fix is written down: cut the `Problem` line,
      not the `Expect` one.
- [ ] Both lines are legible at arm's length in daylight. They are `--fs-xs` and quiet by
      design, but a reminder you have to squint at during a game is a reminder you ignore.
- [ ] Build a session from an objective **chip**. The `Problem` line is above `Expect`, and it
      is a question.
- [ ] Build one by **typing** your own objective. There is **no** `Problem` line at all — not an
      empty one, not a placeholder — and no `Expect` line either.
- [ ] A problem long enough to wrap clamps at two lines rather than pushing the header down.
- [ ] Review an objective, accept the `Revisit:` chip, start the next session. The `Problem`
      line **comes back with it**, same as `Expect`.
- [ ] Open a session planned **before this shipped**. No `Problem` line, no error, no blank row.
- [ ] A **match** day session has no `Problem` line: the objective there is the fixture, and
      there is no template behind it to snapshot one from.
- [ ] **The judgement call.** Read both lines during a real session. If the `Problem` line tells
      you nothing the objective text above it did not already, say so — it is one field and one
      revert, and phases 3 to 6 all hang off it.

### The execution, and the rest of the action (phase 1)

Derived from observations already being logged, so **there is historic data behind this one** —
unlike the ADR 0009 phases above, a session reviewed before today will show the line correctly.

- [ ] Review a session with **fewer than eight** classifiable observations. There is **no**
      execution line and no capability line either — not an empty one, not a placeholder.
- [ ] Review a session with eight or more. **Both** lines appear, capability tally first,
      execution split directly under it. Neither ever shows without the other.
- [ ] The split line does **not** repeat *"for this session"*. It reads as the second sentence
      of the line above it, not as a second report.
- [ ] Log mostly technique tags. The line says *"N of the M were about the execution; the other
      K were about the rest of the action."*
- [ ] Log **only** technique tags — *"All M were about the execution."* No suggestion attached,
      no nudge to watch something else. This is the wording to check hardest: a set-piece
      session should be all execution and the app must not imply otherwise.
- [ ] Log **no** technique tags — *"None of the M were about the execution."* Equally unjudged.
- [ ] The sentence never contains *tactical*, *decision*, *understanding* or *technical*. There
      is a test for this, but read it on the screen once anyway.
- [ ] Log several observations with tags this lens cannot place (`Teamwork`, `Leadership`). They
      do **not** inflate either side of the split — the denominator is what the lens could read,
      and the capability line above is where the unreadable ones are accounted for.
- [ ] Tap the `?` on the split line. It says the two-way grouping is this app's, not the FA's.
- [ ] **Portrait, 667px.** `/review` has two more banners than it did. It still reaches the
      `Save review` button without the report block pushing it off the screen.
- [ ] **The one that decides phase 2.** Read the line after a real session and ask whether it
      told you something you did not know. If it did not, the expensive phases are aimed at a
      problem you do not have, and stopping here is the honest answer.

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

## Several squads (ADR 0010)

Everything here needs two squads with real data in both, so seed the second one before you
start: a couple of players and one completed session is enough.

- [ ] `Settings -> Squads` on a one-squad install shows that squad marked `Current` and offers
      `Add another squad`. It is visible **before** there is a second team to switch to.
- [ ] Add a second squad. It becomes the current one, and `/squad` is empty — the roster you
      just left is not leaking into it.
- [ ] `Switch to` the first squad. Today's title, `/squad`'s roster, `/sessions` and the
      carry-forward chips all change together, with no reload.
- [ ] Leave a half-finished draft on each squad, then switch back and forth. **Each squad gets
      its own draft**, and `/plan` never shows you the other team's.
- [ ] Start a session, then try to switch squads. It refuses and names the running session.
      Finish or abandon it and the switch works.
- [ ] Log observations on one squad. Switch to the other and confirm `/squad/player` and the
      corner-balance report show nothing of them. **This is the one that matters** — the
      reports are the reason the squads are separate at all.
- [ ] Rename a squad mid-season. The name changes on Today and `/squad` and nothing else moves.
- [ ] Archive the squad you are not on. It leaves the list, the toast offers `Undo`, and the
      squad you are on is untouched.
- [ ] `Show archived squads` → `Restore`. The roster, the sessions and the observations are all
      still there, word for word.
- [ ] Try to archive your only squad. It refuses rather than dropping you to `Name your squad`.
- [ ] Export with an archived squad present, wipe the browser's site data, and import the file.
      **The archived squad comes back, archived.** The export is the only backup there is.
- [ ] Import your own export twice over a two-squad install. The second import is a clean
      no-op — no duplicate copy of the archived season.
- [ ] Trigger a crash with two squads loaded and confirm **both** squad names are redacted in
      the report, the archived one included.

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
