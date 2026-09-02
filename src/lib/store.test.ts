import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

describe('createStore', () => {
  it('returns the current snapshot', () => {
    const store = createStore({ count: 0 });
    expect(store.getSnapshot()).toEqual({ count: 0 });
  });

  it('notifies subscribers on a change', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 1 });
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual({ count: 1 });
  });

  it('accepts an updater function', () => {
    const store = createStore({ count: 1 });
    store.setState((current) => ({ count: current.count + 1 }));
    expect(store.getSnapshot().count).toBe(2);
  });

  it('does not notify when the snapshot is referentially unchanged', () => {
    // `useSyncExternalStore` loops forever on an unstable snapshot, so this identity check
    // is load-bearing rather than an optimisation.
    const state = { count: 0 };
    const store = createStore(state);
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState(state);
    store.setState(() => state);
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes cleanly', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.setState({ count: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies every subscriber, and survives one unsubscribing mid-notification', () => {
    const store = createStore({ count: 0 });
    const calls: string[] = [];

    const unsubscribeB = store.subscribe(() => calls.push('b'));
    store.subscribe(() => {
      calls.push('a');
      // A component unmounting in response to a change must not skip the next listener —
      // hence the copy of the listener set before iterating.
      unsubscribeB();
    });

    store.setState({ count: 1 });
    expect(calls).toEqual(['b', 'a']);
  });
});
