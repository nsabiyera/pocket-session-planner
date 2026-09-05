/**
 * Turning a coach's sentence into a GitHub issue, without a server.
 *
 * There is no backend and there never will be (ADR 0001), so "send feedback" cannot mean
 * POST. It means: build the URL of GitHub's *own* new-issue form with the title, body and
 * label already filled in, and hand it to the browser. The coach then reads what is about to
 * be published and presses the button themselves.
 *
 * That last part is a feature rather than a limitation. An issue is public and permanent, and
 * it goes up under the coach's own GitHub name — so the app must never be the thing that
 * posts it. Prefilling gets the report written; consent stays where it belongs.
 *
 * **Nothing from the squad is ever attached.** The context block below is the app version,
 * the browser and the screen — no player names, no observations, no session data. This app
 * holds notes about children, and a feedback box that quietly shipped any of that to a public
 * issue tracker would be a serious breach rather than a convenience. `feedbackBody` builds
 * from `FeedbackReport` alone, which has no route to squad data, and the tests hold that line.
 */

/** The repository the issues land in. */
export const FEEDBACK_REPOSITORY = 'nsabiyera/pocket-session-planner';

/**
 * Two kinds, mapped onto the two labels every GitHub repository has out of the box.
 *
 * A longer taxonomy would be a triage convenience paid for by the one person least able to
 * afford it — a coach on a touchline deciding whether their problem is a "defect" or a
 * "regression". Broken or wanted; the maintainer can relabel.
 */
export type FeedbackKind = 'bug' | 'idea';

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: 'Something broke',
  idea: 'An idea',
};

/** The GitHub label each kind carries. Both ship with every new repository. */
const GITHUB_LABEL: Record<FeedbackKind, string> = {
  bug: 'bug',
  idea: 'enhancement',
};

/**
 * Where in the app it happened, in the coach's language rather than the router's.
 *
 * These read as the Plan → Do → Review loop the manual describes, not as route paths, because
 * the person filling this in has never seen `/plan/phases`.
 */
export const FEEDBACK_AREAS = ['plan', 'do', 'review', 'squad', 'offline', 'transfer'] as const;

export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];

export const FEEDBACK_AREA_LABELS: Record<FeedbackArea, string> = {
  plan: 'Plan — building the session',
  do: 'Do — running it pitch-side',
  review: 'Review — closing the loop',
  squad: 'Squad and players',
  offline: 'Offline, install or resume',
  transfer: 'Export and import',
};

/**
 * What the app knows about itself, and nothing else.
 *
 * Every field here is either a constant or something the browser tells any website that asks.
 * Adding a field is a decision about what a coach publishes to the internet, so the shape is
 * deliberately closed rather than a bag of strings.
 */
export interface FeedbackContext {
  readonly appVersion: string;
  readonly userAgent: string;
  /** `390×844`, already formatted — the domain does not read the DOM. */
  readonly screen: string;
  /** Installed to the home screen, or running in a browser tab. */
  readonly standalone: boolean;
}

export interface FeedbackReport {
  readonly kind: FeedbackKind;
  readonly note: string;
  readonly area: FeedbackArea | null;
  /** `null` when the coach unticked the box. Their call, every time. */
  readonly context: FeedbackContext | null;
}

/**
 * The cap on what a coach can type.
 *
 * Not a storage limit — a URL limit. The whole report travels in a query string, and browsers
 * stop following those somewhere above 8000 characters. 1200 is roughly four paragraphs,
 * which is far more than a touchline note and still leaves room for a long user agent.
 */
export const MAX_NOTE_LENGTH = 1200;

/** Kept well under the ~8000 where browsers and servers start disagreeing. */
const URL_LIMIT = 6000;

const TITLE_LIMIT = 72;

const TRUNCATION_MARK = ' […]';

/**
 * The issue title: the coach's first line.
 *
 * Their own words make a better title than anything derived from them, and the first line of
 * a bug report is nearly always the summary — people write that way without being asked.
 */
export function feedbackTitle(report: FeedbackReport): string {
  const firstLine = report.note.trim().split('\n')[0]?.trim() ?? '';
  if (firstLine === '') {
    return report.kind === 'bug' ? 'Bug report from the app' : 'Idea from the app';
  }
  if (firstLine.length <= TITLE_LIMIT) return firstLine;
  return `${firstLine.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
}

/**
 * The issue body: what they wrote, then a rule, then the facts that make it reproducible.
 *
 * The context sits below a horizontal rule and is never mixed into their prose, so a
 * maintainer reading the issue can tell at a glance which half a human wrote.
 *
 * **The kind is written into the body because the label cannot be trusted to arrive.**
 * GitHub silently drops `?labels=` from anyone without triage rights on the repository —
 * which is every coach this feature was built for. Verified by posting one: the label was
 * requested, the label existed, and the issue came out with none. `labels` stays on the URL
 * because it still works for a maintainer, but the line below is what actually survives.
 */
export function feedbackBody(report: FeedbackReport): string {
  const sections: string[] = [report.note.trim()];

  const facts: string[] = [`- **Kind:** ${FEEDBACK_KIND_LABELS[report.kind]}`];
  if (report.area !== null) {
    facts.push(`- **Where:** ${FEEDBACK_AREA_LABELS[report.area]}`);
  }
  if (report.context !== null) {
    facts.push(`- **App version:** ${report.context.appVersion}`);
    facts.push(
      `- **Installed:** ${report.context.standalone ? 'to the home screen' : 'no — a browser tab'}`,
    );
    facts.push(`- **Screen:** ${report.context.screen}`);
    facts.push(`- **Browser:** ${report.context.userAgent}`);
  }

  // Never empty — the kind is always known — so the rule is always drawn.
  sections.push(['---', '', ...facts].join('\n'));
  sections.push('_Sent from the feedback box in Pocket Session Planner._');

  return sections.join('\n\n');
}

/**
 * The prefilled new-issue URL.
 *
 * If a very long note and a very long user agent together outrun `URL_LIMIT`, the *note* is
 * what gets trimmed — the context is what makes the report actionable, and a maintainer can
 * always ask for the rest of the prose but cannot recover a browser version after the fact.
 */
export function feedbackUrl(report: FeedbackReport, repository = FEEDBACK_REPOSITORY): string {
  const capped: FeedbackReport = { ...report, note: report.note.trim().slice(0, MAX_NOTE_LENGTH) };

  let candidate = capped;
  let url = buildUrl(candidate, repository);

  while (url.length > URL_LIMIT && candidate.note.length > 0) {
    const shorter = candidate.note.slice(0, Math.max(0, candidate.note.length - 200)).trimEnd();
    candidate = { ...capped, note: shorter === '' ? '' : shorter + TRUNCATION_MARK };
    url = buildUrl(candidate, repository);
  }

  return url;
}

function buildUrl(report: FeedbackReport, repository: string): string {
  const params = new URLSearchParams({
    title: feedbackTitle(report),
    body: feedbackBody(report),
    labels: GITHUB_LABEL[report.kind],
  });
  return `https://github.com/${repository}/issues/new?${params.toString()}`;
}
