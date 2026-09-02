import { describeDataStoreContract } from './data-store-contract';
import { FakeDataStore } from './fake-data-store';

// The fake is held to exactly the same contract as the real IndexedDB adapter. If the two
// ever diverge, one of these two suites goes red — which is the entire point.
describeDataStoreContract('FakeDataStore', () => new FakeDataStore());
