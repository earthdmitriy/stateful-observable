# Changelist

All releases of `@rx-evo/stateful-observable`. The readme lists only the latest release.

## 0.7.0

### New

- `reload(options?: ReloadOptions)`; `reload()` without options is unchanged.
  - `{ onlyFailed: true }`: on a `combineStatefulObservables` node, reloads only the sources that are currently failed, recursing through nested combined nodes. Falls back to every source when the node has no information about them (never subscribed, or refCount dropped to zero). A plain `statefulObservable` root ignores it.
  - `{ where: (node) => boolean }`: reloads only the part of the graph behind the handle whose `name` or `meta` matches. Every node on the way to the roots is checked, including meta set with `.with()`; a match reloads that node's subtree, and a root with no match on its way is not reloaded.
  - `{ path: number[] }`: follows source positions, e.g. `[0, 1]` is source 0 of the combination, then its source 1. Only combinations are hops; the positions match the nested `error$` tuple. An index out of range or a path deeper than the graph reloads nothing.
  - All compose: `path` is followed first, then `onlyFailed` and `where` apply. `ReloadOptions` and `ReloadTarget` are exported. `statefulConnection.reload` stays a no-op. See the [ADR](./adr.md#selective-reload-of-a-derived-graph).
- `statefulObservableFactory` is no longer marked `@experimental`.

### Changed

- Operators in `pipe`, `pipeValue` and `pipeError` run as one pipeline per node instead of per event. Stateful operators work again (`scan`, `distinctUntilChanged`, `startWith`, `take`), and operators that hold context decide how long the node stays connected after its last subscriber leaves (`shareReplay(1)` keeps it, `share` with a reset delay keeps it for the delay), and the operator decides about concurrency: a `mergeMap` inside `pipeValue` now runs every value instead of behaving like `switchMap`. An error thrown inside still becomes an error event and later values are still processed; a result that arrives after a newer loading or error event is dropped; `inactive` resets the pipeline. A value dropped by an operator leaves the node pending. See the [ADR](./adr.md#operators-in-pipes).
- Loading is emitted only for work that does not finish synchronously. An input-only node, a synchronous loader and a cache hit emit their value without a preceding loading event (previously every input emitted loading first, so a cached value made `pending$` flicker). A pipe whose operators do not finish synchronously emits its own loading. Code that expected `[loading, value]` for synchronous results now gets `[value]`.
- Cache keys (`cacheKey` on `statefulObservable` and on the factory) are encoded as JSON instead of joined with `"|"`.
  - `1` and `"1"`, or `["a|b"]` and `["a", "b"]`, are different keys (previously they collided).
  - Factory: object inputs without a `cacheKey` are keyed by content (previously every object became `"[object Object]"`, so all object inputs shared one stream). Field order matters.
  - Key parts must be JSON-serializable (no cycles; BigInt is supported). An empty array still skips caching, but `[undefined]`, `[null]` and `[""]` are now real keys (previously they skipped caching too).
- `statefulObservableFactory` counts consumers instead of source subscriptions.
  - `reset(false)` drops `refCount: false` entries whose consumers have left (previously such an entry, once subscribed, was never dropped).
  - `cacheSize` eviction skips entries that have consumers, so the next `get` no longer creates a duplicate stream for a key that is still in use. The cache can temporarily exceed `cacheSize` while that many entries are in use.
  - A new entry is kept for one tick (until the next microtask), so a burst of `get` calls cannot evict it before its consumer subscribes.

### Fixed

- Memory leak: an operator in `.pipe(...)` that completes the stream (`takeUntilDestroyed()`, `takeUntil`, `take`, `first`) now completes the subscribers and releases the source. Since 0.4.0 it only ended the processing of one event, so `stream.pipe(takeUntilDestroyed()).subscribe(...)` without an unsubscribe stayed subscribed to its source after destroy.
- `statefulObservableFactory().reset(false)` keeps entries that still have subscribers (previously it dropped every entry, because the subscriber count was a snapshot taken at creation).
- `statefulObservableFactory().reset(true)` completes the cached streams for their subscribers (previously it only emptied the cache).
- `active: false` clears the stream's result cache, so after logout and relogin the loader runs for the new user instead of serving the previous user's cached result. The stream has to be subscribed when the flag flips.
- The result cache serves falsy results (`0`, `""`, `false`, `null`); previously they called the loader again every time.
- A loader that returns `null` no longer crashes the stream.
- A loader or `cacheKey` that throws synchronously produces an error event for that input, and the stream keeps handling later inputs (previously the stream ended).

### Docs and tooling

- New: [Comparing approaches to async state](./compare.md) with its [corrections log](./compare-corrections.md), and [Quality-of-life helpers](./QoL.md).
- ADR: decided entries on the pending state of a connection with a vanilla source and on error events in `subscribe` and interop; a To Be Determined entry on the stale mix after reloading synchronous sources.
- `npm run build` works again (`tsconfig.build.json` without the project reference).

## 0.6.0

- `ResponseDto`: a serializable response container for logs and the network.
  - `{ value } | { pending: true } | { inactive: true } | { error }`
  - Success is always wrapped as `{ value }`, so user data cannot collide with the sentinels.
- `serializeResponse` / `deserializeResponse` convert between `ResponseWithStatus` and `ResponseDto`.
- Sentinel symbols are registered with `Symbol.for`, so they have the same identity across bundled copies of the package.
- The `log` callback receives a `ResponseDto` (including pending and inactive).

## 0.5.2

- Fixed meta type inference after pipes.
- `statefulConnection` with a vanilla source: the loading event is emitted together with each value instead of on `connect` (see the [ADR](./adr.md#pending-state-of-a-connection-with-a-vanilla-source)).

## 0.5.1

- Fixed type inference for `combineStatefulObservables` when its inputs have meta.

## 0.5.0

- `statefulConnection`: a stateful observable declared up front and wired to a data source at runtime.
  - `connect(source)` accepts a `StatefulObservable` or a vanilla `ObservableInput<T>`. A stateful source is forwarded through `raw$`; for a vanilla source, values arrive with loading events and errors become error events.
  - `disconnect()` unsubscribes and emits inactive.
  - Disconnected, and before the first `connect`, the connection is inactive (the same state as `active: false`).
- `meta`: arbitrary metadata attached to a `StatefulObservable`, set with `options.meta` and kept through `pipeValue`, `pipeError` and `pipe`.
- `.with(options)` returns a new `StatefulObservable` with an updated name and/or meta (replaces `rename`).
- Tests moved from Jest to Vitest.

## 0.4.0

- `statefulObservable` implements `InteropObservable`, so it is accepted wherever RxJS expects an Observable (`merge`, `combineLatest`, `firstValueFrom`, higher-order operators). The result does not carry the state information.
- Pipes unsubscribe the current processing chain when a new input arrives, so an outdated result cannot override a newer one.
- `active` option: while it emits `false`, the stream is disabled, its internal data is cleaned up and it emits nothing until `active` is `true` again, while all subscriptions stay alive.
- `refCount` option (default `true`). `false` prevents cleanup in shared streams. Chained nodes inherit it, and `combineStatefulObservables` uses `true` if any source has it.
- `value$` is not deprecated (a short-lived deprecation together with an Observable mimic was reverted).

## 0.3.0

- Errors in pipes are logged with `console.error` when nobody subscribes to `error$`, so they are not muted unintentionally.
- Debugging options: `log` to track every event in the chain, and `name` to identify the source of an event.

## 0.2.0

- `subscribe` on `statefulObservable`, so it can be passed directly to an async pipe or to `toSignal`.
- Shorthand constructors: `statefulObservable(myInput$)` for an input and `statefulObservable(() => http.get("/items"))` for a loader.
- `statefulObservableFactory`: one cached stateful observable per key (marked `@experimental` until 0.7.0).

## 0.1.1 – 0.1.3

- Documentation improvements; the readme and recipes are included in the published package.

## 0.1.0

- `cacheKey` and `cacheSize` options for caching responses per key.
- Fixed stream recovery after an error in `pipeValue`.

## 0.0.2

- First published version: `statefulObservable` with `value$`, `error$` and `pending$`, pipes and `combineStatefulObservables`. Types and utilities are included in the public build.
