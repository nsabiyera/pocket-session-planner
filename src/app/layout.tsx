import type { Metadata, Viewport } from 'next';
import { AppProviders } from './_components/app-providers';
import { asset } from '@/lib/base-path';
import './globals.css';

/**
 * The root layout is the **one server component in the app** (ADR 0002). It exists to export
 * `metadata` and `viewport`, which Next.js can only collect from a server component, and to
 * render the client boundary that everything else lives inside.
 */

export const metadata: Metadata = {
  title: 'Pocket Session Planner',
  description: 'Plan, run and review a football training session — pitch-side and offline.',
  applicationName: 'Pocket Session Planner',
  manifest: asset('/manifest.webmanifest'),
  appleWebApp: {
    capable: true,
    title: 'Sessions',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: asset('/icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { url: asset('/icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: asset('/icons/apple-touch-icon.png'), sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0b6b33' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f12' },
  ],
  width: 'device-width',
  initialScale: 1,
  // **Never disable zoom** (WCAG 1.4.4). A coach who needs to pinch to read the organisation
  // notes must be able to.
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
