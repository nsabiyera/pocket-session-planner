// jsdom has no IndexedDB. `fake-indexeddb/auto` installs a spec-faithful in-memory
// implementation on globalThis, which is what lets the *real* IdbDataStore run under the
// same contract suite as the in-memory fake.
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
