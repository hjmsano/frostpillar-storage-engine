# 35. Dependency Injection for Tree-Shakable Storage Drivers

Date: 2026-03-11

## Status

Accepted

## Context

Frostpillar Storage Engine previously used a discouraged pattern for bundler-based environments: it accepted a configuration object (`{ location: 'browser', browserStorage: 'localStorage' }`) and internally aggregated `DurableBackendController` factories.
Because these controller classes (such as `IndexedDBBackendController`, `FileBackendController`, `OpfsBackendController`, and `SyncStorageBackendController`) were statically imported by the library's internal bootstrap mechanism (`bootstrapDatastoreBackend`), bundlers like Vite, Webpack, esbuild, and Rollup could not determine which controllers were actually used at runtime. As a result, they bypassed dead-code elimination (tree-shaking) for unused storage engines, forcing developers to deliver an unnecessarily large bundle over the network even if they only needed a single backend like `localStorage`.

Furthermore, adding new backend technologies in the future would disproportionately increase the base bundle size for all runtime environments.

## Decision

Replace string-based location/browser backend selection with explicit dependency
injection via subpath driver factories.

1. `DatastoreConfig` exposes optional `driver?: DatastoreDriver`.
2. In-memory datastore is selected by omitting `driver`.
3. Durable backends are selected by importing an explicit driver factory from
   package subpaths.

```typescript
// Usage Example

import { Datastore } from 'frostpillar-storage-engine';
import { localStorageDriver } from 'frostpillar-storage-engine/drivers/localStorage';

const db = new Datastore({
  // Only localStorage bridging code is imported into the bundler tree.
  driver: localStorageDriver({
    keyPrefix: 'prefix',
    maxChunkChars: 1000000,
  }),
});
```

A backend driver exposes `init()` and optional backend-limit resolver capability.
Core datastore orchestration no longer statically imports concrete durable
backend controllers.

## Consequences

- **Positive:** Massive reduction in compiled bundle size for consumers who only bundle one specific storage backend.
- **Positive:** Cleaner architectural boundaries. The `Datastore` core doesn't need to depend on the entirety of available backend controllers.
- **Negative:** **Breaking API Change.** Constructor calls that depend on
  `location: ...` and `browserStorage: ...` require refactoring.
- **Negative:** Requires updating all of our internal tests which span the `browser` vs `file` vs `memory` spectrum, as they currently iterate through location shapes dynamically.
