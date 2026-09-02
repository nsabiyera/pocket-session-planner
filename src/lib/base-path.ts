/**
 * GitHub Pages serves this app from a subdirectory, so **every path carries a base path**.
 *
 * Next's `basePath` rewrites `<Link>` hrefs and the `_next/` asset URLs for us. It does
 * **not** rewrite anything referenced by a raw string — a `<link rel="icon">`, a manifest
 * entry, the service-worker registration URL, or an `<img src>` pointing into `public/`.
 * Those go through here, and forgetting one is the single most likely cause of a deploy
 * that works perfectly on localhost and 404s in production.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Prefixes an absolute app path. `asset('/icons/icon-192.png')` -> `/psp/icons/icon-192.png`. */
export function asset(path: string): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_PATH}${normalised}`;
}

/** The service worker's URL and its scope, which must agree with the manifest's `scope`. */
export const SERVICE_WORKER_URL = `${BASE_PATH}/sw.js`;
export const SERVICE_WORKER_SCOPE = `${BASE_PATH}/`;
