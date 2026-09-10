'use client';

import { useEffect, useState } from 'react';

/**
 * **"What did they say about it?"** — the only field in this app that records a player's own
 * words (ADR 0009 phase 7).
 *
 * Shared by the Do-mode ruling sheet and the challenge rows on `/review`, because the quote
 * follows the ruling and a coach can rule in either place. One component so the two cannot
 * drift into asking the question two different ways.
 *
 * **Saved on blur, never on keystroke.** Do mode is write-through: every command persists
 * before the next render, which is right for a tap and wrong for typing — a per-character save
 * would rewrite a multi-KB session document thirty times for one sentence. So the input is
 * local while the coach types and commits when they leave it.
 *
 * **Entirely skippable.** It is the one place in this feature that puts a keyboard in front of
 * a coach, so nothing depends on it, nothing prompts for it twice, and an empty field is a
 * normal challenge rather than an incomplete one.
 */
export function PlayerWordField({
  id,
  said,
  onSave,
}: {
  /** Unique per row, so the label binds to the right input on `/review`. */
  id: string;
  said: string;
  onSave: (said: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(said);

  // Re-seed when the stored value changes underneath us — a different challenge in the same
  // sheet, or a re-read after the app came back from the background.
  useEffect(() => {
    setDraft(said);
  }, [said]);

  return (
    <div className="field">
      <label htmlFor={id}>What did they say about it?</label>
      <input
        id={id}
        type="text"
        value={draft}
        placeholder="Their words, not yours"
        maxLength={300}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          // Nothing to write if it has not changed. A blur is not an edit.
          if (trimmed === said.trim()) return;
          void onSave(trimmed);
        }}
      />
    </div>
  );
}
