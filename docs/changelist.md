# Changelist

All releases of `@rx-evo/stateful-observable`. The readme lists only the latest release.

## 0.8.0

### New

- `statefulObservableFactory().project(input$, { key?, combine? })`: a stream that follows an input observable and shows, for each emitted value, the same entry `get(value)` returns (the value is keyed with the factory's `cacheKey`). Projections and `get` of one key share one entry: one request, one state, and `reload()` on any of them reloads all of them. Projections are separate streams (a projection can move to another key), so only the entry is shared, not the projection object. How long a key is kept follows `refCount` and `cacheSize` of the factory, as for `get`. `reload()` on a projection reloads the entry it shows; `factory.reload()` and `factory.reset()` act on the entries, and `reset(true)` completes projections too. Optional `key` and `combine(response, value)` work as for `projectMany`; a value with the same key as the current one is not shown again.
- `statefulObservableFactory().projectMany(ids$, { key?, combine? })`: a stream that follows an observable of lists and shows, for each list, the entries `get` returns for its items, combined as with `combineStatefulObservables`: `Response[]` in input order (duplicates included), pending while any entry loads, an error list of `error | false` per item, and `[]` at once for an empty list. When the list changes, the new entries are subscribed before the previous ones are released, so an item that stays keeps its load in flight (no second request or batch); items that left are released as for `get`. A list with the same keys in the same order is skipped. `reload()` reaches the current combination, so `onlyFailed` and `path: [i]` work. The factory's `mapOperator` is not used. Optional `key` selects the input of an item (required by the types when the items are not inputs), and optional `combine(responses, items)` computes the value from the responses and the items of the list they were loaded for: a list with the same keys but other items runs `combine` again without loading, so data outside the key never meets responses of another list; a throw in it becomes an error event.
- `statefulObservableFactory({ name })` and `statefulObservableBatchFactory({ name })`: a debug name given to every entry and to the streams made with `project` and `projectMany` (they were `"unnamed"`), so it shows in logs and `reload({ where })` can match it.
- `statefulObservableBatchFactory({ loader, idOf, batchTime?, maxBatchSize? })`: a factory for backends that load many ids in one request. Consumers use it as `statefulObservableFactory` (`get`, `project`, `projectMany`, `reset`, `reload`, same options for `active`, `refCount`, `cacheSize`, `mapOperator`). The loader takes the ids of a batch and returns a list of items, matched to ids with `idOf` (compared as strings, so `1` matches `"1"`). Ids requested within `batchTime` ms (default `0`, one tick), counted from the first one, are sent together, at most `maxBatchSize` per loader call. An id missing from the response gets an error, a failed batch fails each of its ids, reloading one entry requests only its id, and reloads within one window share one batch. A consumer leaving before the batch is sent takes its id out; a sent batch is cancelled once all of its consumers have left.

### Changed

- `statefulObservableFactory` entries keep the value of their last load that completed, also without subscribers: a consumer that comes back is served synchronously, with no request and no loading event. With the default `refCount: true` a load still in flight is still cancelled when the last consumer leaves, so the factory now cancels what nobody waits for and keeps what has arrived. In 0.7.x `refCount: true` loaded a key nobody showed again on the next visit, and `refCount: false` was the only way to keep it (and also let abandoned loads run). `refCount` now only decides whether an entry stays connected to its loader (`false`: for live streams, prefetching, or work that must finish). Errors and loads that did not complete are not kept. A kept value is dropped by `reload()` (the entry's or the factory's), by `active: false` (one watch per factory while some value is kept, also with no subscribers) and when the entry leaves the cache. An entry releases its loader one microtask after its last consumer leaves, so a request that completes in the same callback as its value (`firstValueFrom`, `take(1)`) is still kept. Applies to `statefulObservableBatchFactory` too. See the [ADR](./adr.md#keep-settled-values-in-factory-entries).

### Fixed

- `statefulObservableFactory` with `refCount: false` no longer leaks entries that leave the cache. An entry dropped by `cacheSize` eviction, `reset(false)` or `reset(true)` stayed subscribed to its loader and to `active`, and kept its last value, for the lifetime of the app (`reset(true)` completed its subscribers but did not unsubscribe the source). Such an entry is now ended when it leaves the cache: its loader and `active` are unsubscribed, and a reference to it kept elsewhere replays its last value and completes instead of connecting again. With the default `refCount: true` nothing changes: an entry was already released when its last consumer left.

## 0.7.1

### Fixed

- `active: false` clears the result cache also when the stream has no subscribers. Only streams with a `cacheKey` were affected, which is rare for shared user data (a balance, account info or settings usually have no input key and no result cache). In 0.7.0 the cache was cleared only while something was subscribed, so a root with `cacheKey` and `refCount: true` that nobody read during logout and relogin served the previous user's cached result to the next subscriber. While a stream with `active` and `cacheKey` has no subscribers it now watches `active` until the first `false` (streams without `cacheKey`, factory entries included, have nothing to drop and do not watch), drops the cache then and stops watching; a subscriber that returns takes over as before. The cache still survives unsubscribing and subscribing again while logged in.

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
- `active: false` clears the stream's result cache, so after logout and relogin the loader runs for the new user instead of serving the previous user's cached result. The stream had to be subscribed when the flag flipped (fixed in 0.7.1).
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
