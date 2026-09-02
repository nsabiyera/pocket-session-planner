/**
 * A minimal module store, read through `useSyncExternalStore`.
 *
 * This is the whole of the "no client state library" convention. Every screen reads the
 * same snapshot, so a write in Do mode repaints the home screen's resume line without any
 * component knowing the other exists — and without pulling in Redux or Zustand for what is,
 * in the end, a `Set` of callbacks.
 *
 * `getSnapshot` must return a **referentially stable** value between notifications, or React
 * loops forever. That is why `setState` replaces the whole object and every read is a plain
 * property access off it.
 */
export interface Store<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  setState(update: T | ((current: T) => T)): void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setState(update) {
      const next = typeof update === 'function' ? (update as (current: T) => T)(state) : update;
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
