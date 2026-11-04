# Quality-of-life helpers

These helpers are not crucial. Everything here can be written by hand on top of `statefulObservable` and RxJS. They exist because, in the author's experience, the same boilerplate keeps showing up in real applications, and each one removes a common piece of it:

| Helper | Replaces |
| --- | --- |
| [Result cache](#1-result-cache-cachekey-cachesize) (`cacheKey`, `cacheSize`) | a hand-written `Map` of responses by key, with eviction |
| [Factory](#2-factory-statefulobservablefactory) (`statefulObservableFactory`) | the collect-ids, fetch, map and keep-in-sync code that resolves related entities for list rows (and hand-written `{ [id]: stream }` maps) |
| [Connection](#3-connection-statefulconnection) (`statefulConnection`) | a `BehaviorSubject` of sources plus a `switchMap` plus the state handling, for streams whose source is not known yet |
| [Active and inactive state](#4-active-and-inactive-state-active) (`active`) | wrapping every user-bound stream, derived stream and cache in a switch on the login state |

The samples use Angular for context (`inject`, services), but the library itself only depends on RxJS. The behaviour marked "observed" was checked with throwaway probes against the current code, which were deleted afterwards, so the numbers cannot be reproduced from the repository; the rest is read from the source. Where something behaves in a way that may surprise you, it says so.

**Version.** This guide describes 0.7.0. Behaviour marked *(since 0.7.0)* differs in 0.6.0 and earlier, and each such place says how.

## 1. Result cache (`cacheKey`, `cacheSize`)

Without a cache, switching the input back to a value you already loaded repeats the request. With `cacheKey`, successful results are kept per key and served again.

**Before** (by hand):

```typescript
private readonly cache = new Map<number, Client>();

readonly client$ = this.clientId$.pipe(
  switchMap((id) => {
    const hit = this.cache.get(id);
    if (hit) return of(hit);
    return this.api.getClient(id).pipe(tap((c) => this.cache.set(id, c)));
  }),
  // ...plus loading and error handling, plus eviction
);
```

**After:**

```typescript
readonly client$ = statefulObservable({
  input: this.clientId$,
  loader: (id) => this.api.getClient(id),
  cacheKey: (id) => [id], // the array is encoded as JSON to form the key
  cacheSize: 10,          // optional, default 42
});
```

What happens when the id goes `1`, `2`, `1` (observed with a loader that counts its calls):

| Step | Loader called? | Value emitted |
| --- | --- | --- |
| `1` | yes | result for 1 |
| `2` | yes | result for 2 |
| `1` again | **no**, served from the cache | result for 1 |

A key can have several parts, which is how a filtered, paginated table is cached:

```typescript
readonly page$ = statefulObservable({
  input: this.query$, // { status, role, page }
  loader: (q) => this.api.search(q),
  cacheKey: (q) => [q.status, q.role, q.page],
  cacheSize: 20,
});
```

Details worth knowing:

- **No `cacheKey` means no caching.** The default key is empty, and an empty key skips the cache. Returning an empty array for some inputs skips it for those inputs only.
- **Only successful results are cached.** An error is not stored, so a retry really calls the loader again.
- **Falsy results are cached too** *(since 0.7.0; in 0.6.0 a result of `0`, `""`, `false` or `null` is never served from the cache and calls the loader every time, and a `null` result crashes the stream)*.
- **The key is the array encoded as JSON** *(since 0.7.0; in 0.6.0 it is joined with `"|"`, so `1` and `"1"` are one key, `["a|b"]` and `["a", "b"]` collide, and every object becomes `"[object Object]"`)*. Types and part boundaries are kept apart, and an object part is keyed by its content. Parts must be JSON-serializable (no cycles). Only an empty array skips caching; `[undefined]`, `[null]` and `[""]` are keys like any other.
- **Eviction is least-recently-used.** A hit moves the entry to the newest position. With `cacheSize: 2` and the sequence `1, 2, 1, 3`, key `2` is the one evicted, and asking for `2` again calls the loader.
- **A hit is not pending.** It is served synchronously, so it emits the value without a loading event, and `pending$` only emits `false` *(since 0.7.0; in 0.6.0 it emitted `true` and then `false`, so a spinner could flicker on a cached value)*.
- **If the loader emits more than once**, the last emitted value is what gets cached.
- **The cache belongs to one stream instance.** Two `statefulObservable` instances do not share results. To share across components, share the stream (a token or service) or use the [factory](#2-factory-statefulobservablefactory).
- **`reload()` empties the cache** of that stream and fetches the current input again.
- **Re-emitting an input with the same key does not refetch.** It is served from the cache. Use `reload()` or a different key to force a request. This matters for update actions pushed through the input: give them a key that cannot hit the cache, or no key at all.
- **There is no expiry, and the result cache is not released when subscribers leave.** Two things are easy to mix up. The stream's shared *last event* (what a late subscriber receives) is released when the last subscriber leaves, because of `refCount`. The *result cache* is separate and stays for as long as the stream object exists: in a probe with the default `refCount`, unsubscribing everyone and subscribing again did not call the loader a second time (the same with `refCount: false`). To drop results, call `reload()` (which empties the cache but also fetches again) or drop the whole stream, for example with the factory's `reset`, or let it go inactive (see [Active and inactive state](#4-active-and-inactive-state-active)), which clears it. A time-limited cache is composed with RxJS; see [compare.md](./compare.md), "Caching strategies compose with RxJS".

## 2. Factory (`statefulObservableFactory`)

The problem it targets: **a list refers to related entities by id, and the backend cannot join them.** A table of orders has a `customerId` per row, a list of tasks has an `assigneeId`, and each row should show the related entity's name or avatar. Rendering that costs either many requests or complex mechanics. By hand it usually becomes a pre-fetch that collects the ids of the page, requests them, builds a lookup map, and re-does all of it when the page, the sorting or the filters change.

The factory makes the lookup a property of the cell. A cell asks for the entity by id, and the factory returns **one stream per id**, shared by every cell that asks for the same id.

**Before** (by hand): collect the ids, fetch, map, keep the map in sync with the list.

```typescript
readonly rows$ = this.query$.pipe(switchMap((q) => this.api.orders(q)));

readonly customersById$ = this.rows$.pipe(
  map((rows) => [...new Set(rows.map((r) => r.customerId))]),
  switchMap((ids) => forkJoin(ids.map((id) => this.api.customer(id))).pipe(
    map((customers) => new Map(customers.map((c) => [c.id, c]))),
  )),
  // ...plus pending and error handling per customer, plus caching across pages
);
```

**After:**

```typescript
@Injectable({ providedIn: "root" })
export class CustomersLookup {
  private readonly api = inject(CustomersApi);

  private readonly byId = statefulObservableFactory({
    loader: (id: number) => this.api.customer(id),
    cacheSize: 200,   // how many customers to keep; default 42
    refCount: false,  // keep a loaded customer when no cell shows it (see below)
  });

  customer(id: number) {
    return this.byId.get(id);
  }
}
```

```typescript
// in the table component
protected readonly customers = inject(CustomersLookup);
```

```html
@for (row of rows(); track row.id) {
  <tr>
    <td>{{ row.id }}</td>
    <td>
      <!-- the same id returns the same stream, so asking per row is cheap -->
      @let customer = customers.customer(row.customerId);
      <app-stateful-block [stream]="customer">
        {{ (customer | async)?.name }}
      </app-stateful-block>
    </td>
  </tr>
}
```

What this gives (observed with 100 rows over 5 distinct ids):

| Situation | Result |
| --- | --- |
| `get(id)` for rows that nobody renders | no request (the stream is lazy) |
| 100 cells rendered, 5 distinct ids | 5 requests, one per id, however many cells show it |
| Page changes and the same ids come back (`refCount: false`) | no new requests, served from the kept stream |
| Page changes and the same ids come back (default `refCount`) | a request again, because the stream was released when the last cell left |
| One id fails | only the cells with that id show an error; the other cells are unaffected |
| `get(id).reload()` for the failed id | one request; every cell with that id recovers |

Each cell has its own pending and error state through the same stateful handle, so a slow or failed lookup never blocks the table.

Details worth knowing:

- **There is still one request per distinct id.** The factory deduplicates and caches; it does not batch. If the backend has a bulk endpoint ("customers by ids"), one request for the page is cheaper than many single ones, and batching has to be composed in the loader yourself (for example by collecting ids over a short time window with RxJS).
- **`refCount` decides whether an id is fetched again.** With the default `refCount: true`, a stream is released when its last cell unsubscribes, and the next cell fetches again. With `refCount: false` the loaded value is kept for as long as the entry stays in the factory. `cacheSize` bounds that: entries beyond it are evicted, least recently used first, skipping entries that still have consumers.
- **Eviction skips entries that have consumers** *(since 0.7.0; in 0.6.0 a stream still on screen can be evicted, and the next `get` for its id creates a second instance with its own request, which the factory's `reload()` does not reach)*. A stream in use is never duplicated by eviction; while more than `cacheSize` entries are in use, the cache holds them all and shrinks back as consumers leave. A new entry is also kept for one tick (until the next microtask), so a burst of `get` calls in one render pass cannot evict an entry before its cell subscribes. An entry that is never subscribed becomes evictable after that tick.
- **Staleness is yours to manage.** There is no expiry, so a kept customer stays until it is evicted, reset or reloaded. `reload()` on the factory reloads every cached entry, which is a lot after a long list; reload single ids with `get(id).reload()` when only some changed.
- **Two different caches.** The result cache (`cacheKey` inside `statefulObservable`) stores the responses of one stream for different inputs. The factory stores whole streams, one per key. Use the first for one stream whose input changes (a form), the second for many streams addressed by key (the entities a list refers to).
- **The key defaults to the input itself, encoded as JSON** *(since 0.7.0; in 0.6.0 it is joined as a string, so every object input becomes `"[object Object]"` and all of them share one stream)*. An object input is keyed by its content, so equal objects built separately share a stream and different ones do not. Field order matters (`{ a, b }` and `{ b, a }` are different keys), so for objects a `cacheKey: (input) => [input.id]` is still the safer choice.

The API:

| Member | Does |
| --- | --- |
| `get(input)` | returns the stream for that key, creating it on first use; the same key returns the same instance |
| `reload()` | calls `reload()` on every cached stream |
| `reset(true)` | completes all cached streams (their subscribers receive `complete`) and empties the cache, so the next `get` creates a new instance for every key *(since 0.7.0; in 0.6.0 it only empties the cache, and subscribers are not completed)* |
| `reset(false)` | drops only entries that have no subscribers; an entry with a live subscriber is kept *(since 0.7.0; in 0.6.0 it drops every entry)*. Consumers are counted, not source subscriptions, so this also works with `refCount: false` |

### Another use: a list of ids to one combined stream

The same factory also answers "an aggregate refers to several entities, give me all of them":

```typescript
@Injectable({ providedIn: "root" })
export class ProductsService {
  private readonly byId = statefulObservableFactory({
    loader: (id: number) => this.api.getProduct$(id),
    cacheSize: 100,
  });

  products(ids: number[]) {
    return combineStatefulObservables(
      ids.map((id) => this.byId.get(id)),
      (products) => products,   // Product[] in the same order as ids
    );
  }

  onLogout() {
    this.byId.reset(true);      // complete and drop everything
  }
}
```

The combined stream is pending while any product loads, reports errors per source, and `reload({ onlyFailed: true })` on it retries only the failed products *(since 0.7.0; in 0.6.0 `reload()` reloads every product)*. Here the list is the consumer, not each cell, so one handle covers the whole aggregate.

Unlike `get`, `products(ids)` builds a new combined stream on every call. Call it once per list of ids (in a field, or when the ids change), not from a template expression, which would create a new stream on every change detection.

## 3. Connection (`statefulConnection`)

Sometimes a piece of UI or a service needs a stream *before* it knows where the data comes from: the selected entity changes with the route, the source depends on a user choice, the source is created later. A connection is a stateful observable you declare once and wire to a source at runtime.

**Before** (by hand):

```typescript
private readonly source$ = new BehaviorSubject<Observable<Entity> | null>(null);

readonly entity$ = this.source$.pipe(
  switchMap((source) => (source ? source.pipe(/* loading, error, value handling */) : of(null))),
  // ...plus the inactive state, plus keeping the stream alive after an error
);
```

**After:**

```typescript
@Injectable()
export class EntityPanelService {
  readonly entityView = statefulConnection<Entity>({ name: "entityPanel" });

  // derived streams are declared once, before any source exists
  readonly entityTitle$ = this.entityView.pipeValue(map((e) => e.title));

  private readonly entityFactory = statefulObservableFactory({
    loader: (id: number) => this.api.getEntity(id),
  });

  showEntity(id: number) {
    this.entityView.connect(this.entityFactory.get(id)); // switch context
  }

  showFromAnywhere(entity$: Observable<Entity>) {
    this.entityView.connect(entity$);                    // a vanilla observable also works
  }

  clear() {
    this.entityView.disconnect();                        // back to inactive
  }
}
```

What a subscriber sees (observed with `subscribe({ next, pending, active })`):

| Moment | Events |
| --- | --- |
| before the first `connect` | `active(false)`: inactive, no pending, no value |
| after `connect` of a vanilla observable, before its first value | nothing: the connection still looks as it did before, with no pending state |
| `connect` a vanilla observable that emits `1`, `2` | `pending(true)`, `next(1)`, `pending(false)`, `pending(true)`, `next(2)`, `pending(false)` |
| `connect` a stateful observable | its own events are forwarded: `pending(true)`, `next(…)`, `pending(false)` |
| `disconnect()` | `active(false)` |

Details worth knowing:

- **Inactive means "no data source", not an error.** Before the first `connect` and after `disconnect` the connection is inactive, the same state as `active: false` on a normal stream. Subscribers stay subscribed and simply receive nothing.
- **A stateful source is forwarded as it is.** Loading, error, value and inactive events from its `raw$` pass through. A vanilla source gets a pending event before each value, and an error in it becomes an error event.
- **A vanilla source shows no pending state while it waits.** This is by design: pending means a change is under way and a result is coming soon, and a vanilla source (a `Subject` may stay silent for a long time) gives no sign of that until it emits. The pending event is emitted together with the value, not on `connect`, so a spinner bound to `pending$` does not appear during an HTTP request (observed: after `connect` of a delayed source, the next events were `pending(true)`, `next(1)`, `pending(false)` in the same instant). For a real loading state, connect a stateful observable instead, for example `connect(statefulObservable({ loader: () => source$ }))`. The reasoning is in the [ADR](./adr.md#pending-state-of-a-connection-with-a-vanilla-source).
- **Switching cancels the previous source.** Connecting a new source unsubscribes from the old one, so a late answer from the old context cannot arrive after the switch.
- **A failed source does not kill the connection.** The source ends, but the connection stays and can be connected to another source.
- **Piped derivatives follow the root.** `connect` and `disconnect` exist only on the root connection; streams made with `pipeValue`, `pipeError` or `combineStatefulObservables` receive its events.
- **`reload()` does nothing on a connection.** To retry, reload the source you connected (keep the reference, or reload the factory). A combination that includes a connection will reload its other sources, but not the connection's current source.
- **Options:** `name` (default `"connection"`), `refCount` (default `true`) and `meta`, as on `statefulObservable`.

## 4. Active and inactive state (`active`)

The intent: **clear user-bound data, and everything derived from it, on logout and relogin.** Stores, caches and derived streams are the places where one user's data tends to outlive their session. A stream with an `active` option can be switched off and on again without being rebuilt and without anyone unsubscribing.

**Before** (by hand): switching the source on the login state is the easy part. The real pain starts when the user-bound stream is combined with other streams and the result is shared with `shareReplay(1)`, a common choice in services and tokens:

```typescript
readonly profile$ = this.auth.loggedIn$.pipe(
  switchMap((loggedIn) => (loggedIn ? this.api.profile() : EMPTY)),
);

readonly dashboard$ = combineLatest([this.profile$, this.orders$]).pipe(
  map(([profile, orders]) => buildDashboard(profile, orders)),
  shareReplay(1), // keeps the last dashboard for everyone who subscribes later
);
```

`shareReplay` has no reset signal, and the switch above emits nothing on logout, so nothing tells the buffer that the user is gone. No way to clear it from outside without a cost was found. What was checked:

| Attempt | Result |
| --- | --- |
| the switch on the login state, as above | a subscriber that arrives after logout still receives the previous user's dashboard from the buffer |
| `shareReplay({ bufferSize: 1, refCount: true })` | the buffer is dropped only when **every** subscriber has left; while any long-lived subscriber remains, new subscribers still receive the previous user's value |
| `share({ connector, resetOnComplete: true })` with `takeUntil(logout$)` | it does reset, but it completes **every** subscriber, so all of them have to resubscribe |

Two more routes exist, neither was run, and both have a cost by construction: emit a "cleared" marker value on logout, which changes the type for every consumer and every derived stream; or rebuild the whole chain on logout, which leaves everyone who holds the old reference with the stale stream. On top of that, the same has to be done for every derived stream and every cache.

**After:** give `active` to the streams that own user data. Everything derived from them follows.

```typescript
@Injectable({ providedIn: "root" })
export class UserData {
  private readonly auth = inject(AuthService);

  readonly profile$ = statefulObservable({
    loader: () => this.api.profile(),
    active: this.auth.loggedIn$,        // Observable<boolean>
  });

  readonly orders$ = statefulObservable({
    input: this.query$,
    loader: (q) => this.api.orders(q),
    active: this.auth.loggedIn$,
  });

  // derived data needs nothing
  readonly displayName$ = this.profile$.pipeValue(map((p) => p.name));
  readonly dashboard$ = combineStatefulObservables(
    [this.profile$, this.orders$],
    ([profile, orders]) => buildDashboard(profile, orders),
  );
}
```

What happens (observed with a loader that returns the current user's name):

| Moment | What subscribers of the stream see |
| --- | --- |
| `loggedIn$` emits `false` | `active(false)`; a request in flight is cancelled and its answer never arrives |
| while inactive | nothing: no value, no pending, no error. A subscriber that arrives now receives only `active(false)`, not the old user's value |
| a combination followed by `.pipe(shareReplay(1))`, subscriber arrives after logout | only `active(false)`; after relogin, the new user's value. The buffered value of the previous user is not replayed |
| Piped and combined streams | become inactive as well, with the same events; a combination is inactive when any of its sources is |
| `loggedIn$` emits `true` | `pending(true)`, the loader runs again for the new user, then the new value; derived and combined streams follow |

`active` is available on `statefulObservable` and on `statefulObservableFactory`. A [connection](#3-connection-statefulconnection) is inactive while it has no source, which is the same state.

Details worth knowing:

- **Only the roots that hold user data need `active`.** Pipes and combinations inherit the state. A combination mixing user data with public data is inactive as a whole while the user is logged out, because inactive has the highest priority.
- **Subscribers stay subscribed.** Nothing has to be torn down and rebuilt on relogin, which is the point.
- **The input has to replay.** While inactive, the input is not subscribed. On reactivation it is subscribed again, so a `BehaviorSubject`, `toObservable(signal)` or a form's `valueChanges` with `startWith` triggers the load, while a plain `Subject` does not replay its last value and nothing loads until its next emission.
- **Inactive does not emit on `value$`, `pending$` or `error$`.** They stay silent for it, so a view bound to `value$ | async` that is still mounted keeps showing its last value. For a logout this normally does not matter, in the author's experience, because the logged-out state is a different layout with different templates, so the user-bound views are gone anyway. It can even be what you want when `active` is switched off temporarily (for example while a token is being renewed): the screen does not flicker or empty. When a view does need to react, use `subscribe({ active })` or filter `raw$` with `isInactive`.
- **Going inactive clears the stream's result cache** *(since 0.7.0; in 0.6.0 the result cache survives going inactive, so after relogin a cached key can serve the previous user's result)*. If the stream uses `cacheKey`, results cached for the previous user are dropped when `active` emits `false`, so after relogin the loader runs for the new user. Going inactive itself does not cause a request. Observed: logging out and back in as another user with `cacheKey: (id) => [id]` calls the loader again and delivers the new user's value. Derived and combined streams are covered through their sources.
- **The stream has to be subscribed when the flag flips.** The cache is cleared by the stream's own `active` handling, which only runs while something is subscribed. If every subscriber has left before logout, nothing is listening: observed, a stream that was unsubscribed during logout and relogin served the first user's cached value to the next subscriber. This is why `active` is designed for streams whose subscribers stay in place. For streams that can have no subscribers at that moment, add the user to the key (`cacheKey: (id) => [userId, id]`) or call `reload()` on the stream in the logout handler: with nobody subscribed it only empties the cache and fetches nothing.
- **It does not clear anything outside the stream.** Data that was already copied into component state, a signal, a form or a `localStorage` entry is not touched.

## See also

- [Recipes](./recipes.md): the same helpers in application scenarios
- [Comparison with other approaches](./compare.md): where these helpers sit next to RxJS, signals and stores
