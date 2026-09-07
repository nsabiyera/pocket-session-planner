import { describe, expect, it } from 'vitest';
import {
  MAX_STORED_CRASHES,
  crashBody,
  crashIssueUrl,
  crashTitle,
  fingerprintOf,
  recordCrash,
  scrubCrashText,
  type CrashReport,
} from './crash';

const report = (over: Partial<CrashReport> = {}): CrashReport => ({
  id: 'c1',
  occurredAt: '2026-09-07T10:00:00.000Z',
  source: 'render',
  message: 'Cannot read properties of undefined (reading "phaseId")',
  stack: 'Error: boom\n    at RunPage (run/page.tsx:162:18)\n    at renderWithHooks',
  route: '/run',
  appVersion: '0.1.0',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
  seen: 1,
  ...over,
});

describe('scrubbing squad names out of a crash', () => {
  /**
   * The load-bearing test of the whole feature. A Zod failure embeds the value it rejected, and
   * the values in this app are notes about children — so a stack trace is the most likely thing
   * in the app to carry a child's name into a public issue tracker.
   */
  it('redacts a full name, and each part of it', () => {
    const text = 'Invalid player: Kai Roberts failed validation; Kai has no shirt number';
    const scrubbed = scrubCrashText(text, ['Kai Roberts']);

    expect(scrubbed).not.toContain('Kai');
    expect(scrubbed).not.toContain('Roberts');
    expect(scrubbed).toContain('[name]');
  });

  it('redacts regardless of case', () => {
    expect(scrubCrashText('player KAI and kai and Kai', ['Kai'])).not.toMatch(/kai/i);
  });

  it('redacts the squad name too', () => {
    // A squad name identifies a real team of real children just as surely as a player name.
    expect(scrubCrashText('squad U12 Reds not found', ['U12 Reds'])).not.toContain('Reds');
  });

  it('redacts the longest name first, so a shorter one cannot fragment it', () => {
    // Redacting "Kai" first would leave "[name] Roberts" — the surname surviving in public.
    const scrubbed = scrubCrashText('Kai Roberts', ['Kai Roberts', 'Kai']);
    expect(scrubbed).toBe('[name]');
  });

  it('skips names under three characters rather than destroying the report', () => {
    // A player called "Jo" would otherwise redact the "jo" in "json" and every path containing
    // it, reducing the stack to noise while protecting nothing the longer names miss.
    const stack = 'at parseJson (json/parse.ts:1:1)';
    expect(scrubCrashText(stack, ['Jo'])).toBe(stack);
  });

  it('survives a name containing regex metacharacters', () => {
    // Names do contain punctuation, and an unescaped "." or "(" would throw inside the crash
    // reporter — turning one crash into two and losing the first.
    expect(() => scrubCrashText('player A.J. (Junior) here', ['A.J. (Junior)'])).not.toThrow();
    expect(scrubCrashText('player A.J. (Junior) here', ['A.J. (Junior)'])).toBe(
      'player [name] here',
    );
  });

  it('leaves the text alone when there is nothing to redact', () => {
    // A crash during the very first open, before any squad has been read.
    const stack = 'Error: database failed to open';
    expect(scrubCrashText(stack, [])).toBe(stack);
  });
});

describe('the issue', () => {
  it('titles itself with the route and the message', () => {
    expect(crashTitle(report())).toMatch(/^Crash on \/run — Cannot read properties/);
  });

  it('keeps the title inside what GitHub will show', () => {
    expect(crashTitle(report({ message: 'x'.repeat(300) })).length).toBeLessThanOrEqual(72);
  });

  it('falls back when the thrown value had no message', () => {
    expect(crashTitle(report({ message: '' }))).toContain('Unknown error');
  });

  it('names the kind in the body, since the label may be dropped', () => {
    // Same reason as the feedback box: GitHub strips `?labels=` from non-collaborators.
    expect(crashBody(report())).toContain('- **Kind:** Crash');
  });

  it('puts the stack in a fenced block so GitHub does not eat it', () => {
    expect(crashBody(report())).toContain('```');
    expect(crashBody(report())).toContain('at RunPage');
  });

  it('says a stack is missing rather than showing an empty block', () => {
    expect(crashBody(report({ stack: '' }))).toContain('(no stack trace)');
  });

  it('reports how many times it happened', () => {
    expect(crashBody(report({ seen: 1 }))).toContain('1 time');
    expect(crashBody(report({ seen: 4 }))).toContain('4 times');
  });

  it('states that names were redacted, so `[name]` is not mistaken for a bug', () => {
    expect(crashBody(report())).toContain('[name]');
    expect(crashBody(report())).toMatch(/never publish squad data/i);
  });
});

describe('the issue URL', () => {
  it('labels a crash as a bug', () => {
    expect(crashIssueUrl(report())).toContain('labels=bug');
  });

  it('round-trips the body through the query string', () => {
    const url = new URL(crashIssueUrl(report()));
    expect(url.searchParams.get('body')).toBe(crashBody(report()));
  });

  it('trims a huge stack rather than producing a URL no browser will follow', () => {
    const url = crashIssueUrl(report({ stack: 'at someDeepFrame (a/b/c.ts:1:1)\n'.repeat(500) }));
    expect(url.length).toBeLessThanOrEqual(6000);

    // The context below the rule is what makes it reproducible, so it must survive the trim.
    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).toContain('**App version:** 0.1.0');
    expect(body).toContain('**Where:** /run');
  });
});

describe('folding repeats together', () => {
  it('counts the same crash again instead of storing it twice', () => {
    // A timer throwing on every tick would otherwise fill the device with identical reports and
    // bury the one that matters — and a coach offered a hundred buttons presses none.
    const first = recordCrash([], report());
    const second = recordCrash(first, report({ id: 'c2' }));

    expect(second).toHaveLength(1);
    expect(second[0]?.seen).toBe(2);
  });

  it('keeps the first occurrence, because when it started is the useful fact', () => {
    const first = recordCrash([], report());
    const second = recordCrash(first, report({ id: 'c2', occurredAt: '2026-09-07T11:00:00.000Z' }));
    expect(second[0]?.occurredAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('treats a different fault as a different report, newest first', () => {
    const first = recordCrash([], report());
    const second = recordCrash(first, report({ id: 'c2', message: 'Something else broke' }));

    expect(second).toHaveLength(2);
    expect(second[0]?.message).toBe('Something else broke');
  });

  it('caps what it keeps, so a crash loop cannot fill the device', () => {
    let stored: CrashReport[] = [];
    for (let i = 0; i < MAX_STORED_CRASHES + 5; i += 1) {
      stored = recordCrash(stored, report({ id: `c${i}`, message: `Fault ${i}` }));
    }
    expect(stored).toHaveLength(MAX_STORED_CRASHES);
    expect(stored[0]?.message).toBe(`Fault ${MAX_STORED_CRASHES + 4}`);
  });

  it('fingerprints on the message and the first frame', () => {
    // Same message from a different place is a different bug and must not be folded away.
    const a = fingerprintOf({ message: 'boom', stack: '    at A (a.ts:1:1)' });
    const b = fingerprintOf({ message: 'boom', stack: '    at B (b.ts:1:1)' });
    expect(a).not.toBe(b);
  });
});
