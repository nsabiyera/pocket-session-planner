import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_AREAS,
  FEEDBACK_AREA_LABELS,
  FEEDBACK_KIND_LABELS,
  MAX_NOTE_LENGTH,
  feedbackBody,
  feedbackTitle,
  feedbackUrl,
  type FeedbackContext,
  type FeedbackReport,
} from './feedback';

const context: FeedbackContext = {
  appVersion: '0.1.0',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15',
  screen: '390×844',
  standalone: true,
};

function report(over: Partial<FeedbackReport> = {}): FeedbackReport {
  return {
    kind: 'bug',
    note: 'The timer froze after I locked the phone.',
    area: 'do',
    context,
    ...over,
  };
}

describe('the issue title', () => {
  it('is the coach’s own first line', () => {
    expect(feedbackTitle(report())).toBe('The timer froze after I locked the phone.');
  });

  it('takes only the first line when they wrote several', () => {
    const title = feedbackTitle(report({ note: 'Timer froze\n\nI was on phase two at the time.' }));
    expect(title).toBe('Timer froze');
  });

  it('truncates a long first line rather than shipping a title nobody can scan', () => {
    const title = feedbackTitle(report({ note: 'x'.repeat(200) }));
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back to a kind-specific title when the note is only whitespace', () => {
    expect(feedbackTitle(report({ note: '   \n  ' }))).toBe('Bug report from the app');
    expect(feedbackTitle(report({ kind: 'idea', note: '' }))).toBe('Idea from the app');
  });
});

describe('the issue body', () => {
  it('leads with what the coach wrote', () => {
    expect(feedbackBody(report())).toMatch(/^The timer froze after I locked the phone\./);
  });

  it('puts the facts below a rule, so the human half is obvious', () => {
    const body = feedbackBody(report());
    const [prose, facts] = body.split('---');
    expect(prose).toContain('The timer froze');
    expect(facts).toContain('**App version:** 0.1.0');
    expect(facts).toContain('**Where:** Do — running it pitch-side');
    expect(facts).toContain('**Screen:** 390×844');
  });

  it('says whether the app was installed, because resume bugs differ by surface', () => {
    expect(feedbackBody(report())).toContain('**Installed:** to the home screen');
    expect(feedbackBody(report({ context: { ...context, standalone: false } }))).toContain(
      '**Installed:** no — a browser tab',
    );
  });

  it('omits the whole context block when the coach unticked it', () => {
    const body = feedbackBody(report({ context: null, area: null }));
    expect(body).not.toContain('---');
    expect(body).not.toContain('Mozilla');
    expect(body).toContain('The timer froze');
  });

  it('still records the area when the device details were declined', () => {
    const body = feedbackBody(report({ context: null }));
    expect(body).toContain('**Where:** Do — running it pitch-side');
    expect(body).not.toContain('Mozilla');
  });

  it('marks itself as sent from the app, so triage knows the shape of the reporter', () => {
    expect(feedbackBody(report())).toContain('Sent from the feedback box');
  });
});

describe('what a report can possibly contain', () => {
  /**
   * The load-bearing test of this module. Everything published is either the coach's own
   * sentence or one of four named context fields — there is no path from a squad, a player or
   * an observation into a public issue, and this fails the moment someone adds one.
   */
  it('publishes exactly this and nothing more', () => {
    // Written out in full rather than asserted piecemeal: a new field reaching the issue body
    // has to be added here by hand, which is the moment to ask whether a coach would want it
    // published. Anything sourced from the squad fails at that moment rather than in the field.
    expect(feedbackBody(report({ note: 'The timer froze.' }))).toBe(
      [
        'The timer froze.',
        '',
        '---',
        '',
        '- **Where:** Do — running it pitch-side',
        '- **App version:** 0.1.0',
        '- **Installed:** to the home screen',
        '- **Screen:** 390×844',
        `- **Browser:** ${context.userAgent}`,
        '',
        '_Sent from the feedback box in Pocket Session Planner._',
      ].join('\n'),
    );
  });
});

describe('the new-issue URL', () => {
  it('points at the repository’s own new-issue form', () => {
    expect(feedbackUrl(report())).toMatch(
      /^https:\/\/github\.com\/nsabiyera\/pocket-session-planner\/issues\/new\?/,
    );
  });

  it('labels a bug and an idea with the two labels every repository already has', () => {
    expect(feedbackUrl(report())).toContain('labels=bug');
    expect(feedbackUrl(report({ kind: 'idea' }))).toContain('labels=enhancement');
  });

  it('round-trips the title and body through the query string', () => {
    const url = new URL(feedbackUrl(report()));
    expect(url.searchParams.get('title')).toBe(feedbackTitle(report()));
    expect(url.searchParams.get('body')).toBe(feedbackBody(report()));
  });

  it('keeps the URL inside what a browser will follow, trimming the note not the context', () => {
    const raw = feedbackUrl(report({ note: 'y'.repeat(MAX_NOTE_LENGTH * 3) }));
    expect(raw.length).toBeLessThanOrEqual(6000);
    // The context survives: it is what makes the report reproducible.
    const body = new URL(raw).searchParams.get('body') ?? '';
    expect(body).toContain('**App version:** 0.1.0');
  });

  it('trims a note whose characters are expensive to encode, keeping the context', () => {
    // A note can sit inside the typing limit and still outrun the URL: one CJK character
    // costs nine characters once percent-encoded, so 1200 of them is roughly 10,000. A coach
    // does not write in ASCII because a query string would prefer it.
    const url = feedbackUrl(report({ note: '球'.repeat(MAX_NOTE_LENGTH) }));
    expect(url.length).toBeLessThanOrEqual(6000);

    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).toContain('**App version:** 0.1.0');
    expect(body).toContain('[…]');
  });

  it('caps an over-long note at the documented maximum', () => {
    const url = new URL(feedbackUrl(report({ note: 'z'.repeat(MAX_NOTE_LENGTH * 2) })));
    const body = url.searchParams.get('body') ?? '';
    // The note is the first section; the rule and the context follow it.
    const note = body.split('\n\n')[0] ?? '';
    expect(note.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
  });

  it('survives characters that would otherwise break a query string', () => {
    const note = 'Crashed on "Next phase" & the 100% bar — see #3 <here>';
    const url = new URL(feedbackUrl(report({ note })));
    expect(url.searchParams.get('body')).toContain(note);
  });
});

describe('the vocabulary', () => {
  it('labels every area and every kind', () => {
    for (const area of FEEDBACK_AREAS) {
      expect(FEEDBACK_AREA_LABELS[area]).toBeTruthy();
    }
    expect(Object.keys(FEEDBACK_KIND_LABELS)).toEqual(['bug', 'idea']);
  });

  it('names areas after the coach’s loop, never after a route', () => {
    for (const area of FEEDBACK_AREAS) {
      expect(FEEDBACK_AREA_LABELS[area]).not.toContain('/');
    }
  });
});
