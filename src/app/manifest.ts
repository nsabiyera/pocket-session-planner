import type { MetadataRoute } from 'next';
import { BASE_PATH, asset } from '@/lib/base-path';

/**
 * The web app manifest.
 *
 * **Every path here carries the base path** — `start_url`, `scope`, and every icon `src`.
 * `scope` also determines the service worker's scope, so getting it wrong breaks offline
 * mode in a way that only shows up on the deployed site.
 */
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pocket Session Planner',
    short_name: 'Sessions',
    description:
      'Plan, run and review a football training session — pitch-side, offline, on your phone.',
    start_url: `${BASE_PATH}/`,
    scope: `${BASE_PATH}/`,
    display: 'standalone',
    // Phones portrait, tablets landscape — let the device decide rather than fighting it.
    orientation: 'any',
    background_color: '#f6f7f4',
    theme_color: '#0b6b33',
    categories: ['sports', 'productivity'],
    lang: 'en-GB',
    dir: 'ltr',
    icons: [
      { src: asset('/icons/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: asset('/icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops a maskable icon to a circle or squircle, so its artwork sits inside
      // the central 80% safe zone.
      {
        src: asset('/icons/icon-maskable-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // Screenshots are what make Chrome show the rich install dialog rather than the minimal
    // one, which measurably changes whether anyone installs at all.
    screenshots: [
      {
        src: asset('/icons/screenshot-run.png'),
        sizes: '540x960',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'Running a session pitch-side',
      },
      {
        src: asset('/icons/screenshot-plan.png'),
        sizes: '540x960',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'Planning a session in seconds',
      },
    ],
    // A home-screen long-press jumps straight to the thing the coach wants.
    shortcuts: [
      { name: 'Start a session', url: `${BASE_PATH}/plan/`, description: 'Plan a new session' },
      { name: 'Resume', url: `${BASE_PATH}/run/`, description: 'Back to the running session' },
      { name: 'Squad', url: `${BASE_PATH}/squad/`, description: 'Your roster' },
    ],
  };
}
