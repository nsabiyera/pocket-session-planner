import { Serwist } from 'serwist';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * **Precache everything, network never.**
 *
 * There is no API, no remote image and no analytics endpoint, so `runtimeCaching: []` is a
 * feature rather than an omission — every byte the app will ever need is in the precache
 * manifest, and a request that misses it is a bug rather than a cache miss.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,

  /**
   * **Never swap the app mid-session.** A new worker waits until the page tells it to take
   * over, and `<UpdateToast>` only offers that once no session is running.
   */
  skipWaiting: false,
  clientsClaim: true,

  runtimeCaching: [],

  navigationPreload: false,

  fallbacks: {
    entries: [
      {
        url: `${BASE_PATH}/`,
        matcher: ({ request }) => request.mode === 'navigate',
      },
    ],
  },
});

/**
 * The update handshake. `<UpdateToast>` posts this only when the coach taps `Tap to
 * restart`, and only when no session is in progress.
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

serwist.addEventListeners();
