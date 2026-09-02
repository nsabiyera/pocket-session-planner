import withSerwistInit from '@serwist/next';

const isProd = process.env.NODE_ENV === 'production';

// GitHub Pages serves the app from https://<account>.github.io/pocket-session-planner/,
// so every emitted URL needs the repository name in front of it. Overridable so a
// user-page or custom-domain deploy can set an empty base path.
const basePath = isProd ? (process.env.NEXT_PUBLIC_BASE_PATH ?? '/pocket-session-planner') : '';

/**
 * Every route in the app.
 *
 * These have to be listed by hand. `@serwist/next` builds the precache manifest during the
 * **webpack** phase, which finishes before `output: 'export'` has written a single HTML
 * file — so without this the manifest contains chunks and icons but not one page, and a cold
 * offline load of `/run/` finds nothing.
 *
 * `trailingSlash: true` means each route resolves to `<route>/index.html`, so that is what
 * gets precached.
 */
const ROUTES = [
  '/',
  '/plan/',
  '/plan/phases/',
  '/plan/intervention/',
  '/run/',
  '/review/',
  '/sessions/',
  '/sessions/detail/',
  '/squad/',
  '/squad/player/',
  '/settings/',
];

/**
 * Icons and screenshots, listed explicitly rather than left to the plugin's `public/` scan.
 *
 * The scan is both platform-sensitive (it emitted Windows separators) and quiet about
 * failure — a manifest that silently loses its icons still builds, installs, and then shows
 * a blank tile on someone's home screen. Naming them here makes their absence a build-time
 * mistake instead of a field-time one.
 */
const PUBLIC_ASSETS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/screenshot-run.png',
  '/icons/screenshot-plan.png',
];

/**
 * Changes on every build, so a deploy actually replaces the cached HTML. The pages are a few
 * kB each, so re-downloading all eleven on an update costs nothing worth optimising.
 */
const buildRevision = process.env.BUILD_REVISION ?? String(Date.now());

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // Serwist's webpack plugin does not run under the Turbopack dev server, and an
  // offline-first app is easier to develop without a cache in the way.
  disable: !isProd,
  // Nothing to reload for: the app never talks to the network.
  reloadOnOnline: false,
  // We register the worker ourselves in `<UpdateToast>`, because the registration and the
  // "do not update mid-session" policy are the same concern.
  register: false,
  scope: `${basePath}/`,
  swUrl: `${basePath}/sw.js`,

  additionalPrecacheEntries: [...ROUTES, ...PUBLIC_ASSETS].map((path) => ({
    url: `${basePath}${path}`,
    revision: buildRevision,
  })),

  manifestTransforms: [
    (entries) => ({
      manifest: entries.map((entry) => ({
        ...entry,
        // The plugin walks `public/` with the platform path separator, so a Windows build
        // emits `icons\icon-192.png` — a URL that 404s on every server on earth. Normalise
        // before it reaches the manifest.
        url: entry.url.replace(/\\/g, '/'),
      })),
      warnings: [],
    }),
  ],
});

export default withSerwist({
  output: 'export',
  basePath,
  assetPrefix: basePath,
  // Static hosts resolve /plan/ -> /plan/index.html.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
});
