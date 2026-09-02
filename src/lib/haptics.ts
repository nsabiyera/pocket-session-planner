/**
 * Haptic feedback.
 *
 * Outdoors, with gloves, a coach cannot always see the screen react — a buzz is the only
 * confirmation that a tap landed. `navigator.vibrate` is unsupported on iOS, so every call
 * is best-effort and nothing is ever gated on it.
 */
export type HapticPattern = 'tap' | 'confirm' | 'warn' | 'overrun' | 'pause';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 20,
  confirm: 40,
  // One long buzz for the one-minute warning.
  warn: 200,
  // Three, so an overrun is distinguishable from a warning without looking.
  overrun: [400, 120, 400, 120, 400],
  pause: 120,
};

export function haptic(pattern: HapticPattern): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Some browsers throw when the page is not visible. Never worth breaking a tap over.
  }
}
