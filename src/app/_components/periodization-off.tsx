'use client';

import Link from 'next/link';
import { Empty, Screen, ScreenHead } from './ui';

/**
 * What `/squad/game-model`, `/plan/week` and `/plan/prepare` render when tactical periodization
 * is switched off (ADR 0008).
 *
 * **These routes stay reachable on purpose.** Every route in the app is precached by the
 * service worker and there is no server to redirect anything, so a bookmark, a back button or
 * a home-screen shortcut will land here whatever the flag says. A blank screen or a crash
 * boundary would read as the app being broken; this says which switch is off and where it is.
 *
 * Nothing is deleted by turning the flag off. A game model already authored is still in the
 * database, and switching back on finds it exactly as it was — which is the sentence a coach
 * needs before they are willing to try the switch at all.
 */
export function PeriodizationOff({ title }: { title: string }) {
  return (
    <Screen>
      <ScreenHead eyebrow="Turned off" title={title} />
      <Empty>
        This screen is part of the tactical periodization planning set, which is off. Anything you
        have already written is kept — turn it back on and it is all still here.
      </Empty>
      <Link href="/settings" className="btn btn--primary btn--block">
        Turn it on in Settings
      </Link>
      <Link href="/plan" className="btn btn--block">
        Plan a session instead
      </Link>
    </Screen>
  );
}
