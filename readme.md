# Stateful Observable

A TypeScript library that provides a stateful wrapper for RxJS observables, making it easier to handle loading state, errors, and data streams in a consistent way.

> **Purity is the path of least resistance.**

## Installation

```bash
npm install @rx-evo/stateful-observable
```

## Key Features

- Wraps RxJS observables with loading, error, and success states
- Provides true reactivity — works with an infinite number of events, projecting them correctly into `value`, `pending`, and `error` streams
  - Stateful observables do not stop on errors (even without catchError).
  - Errors are routed into the `error$` stream, while the main stream continues to receive and pipe other events.
- Provides type-safe error handling
- Supports value and error transformation through piping
- Enables easy combination of multiple stateful observables
- Dynamic source switching via `statefulConnection` — connect or disconnect a data source at runtime without rebuilding the pipe chain
- Implements caching and retry functionality
- Implements InteropObservable - can replace vanilla Observables anywhere
- `ResponseDto` — serializable ResponseContainer for logs and network (`serializeResponse` / `deserializeResponse`)

## Usage

```typescript
import { statefulObservable } from "@rx-evo/stateful-observable";

// Wrap a source observable with statefulObservable
const clientId$ = statefulObservable(form.valueChanges);

// Add transformation
const client$ = clientId$.pipeValue(switchMap((id) => fetchClient(id)));

// Add more transformations
const entity$ = client$.pipeValue(
  switchMap(({ relatedEntityId }) => fetchAnotherEntity(relatedEntityId)),
);

// Another stream
const bucket$ = clientId$.pipeValue(switchMap((id) => fetchClientBucket(id)));

// Every stream is shared; `refCount: false` keeps it without subscribers
const products$ = statefulObservable({
  loader: () => fetchProducts(),
  refCount: false,
});

// Combine stateful observables into a single derived stream
const processedBucket$ = combineStatefulObservables(
  [bucket$, inject(productCatalog)],
  ([bucket, products]) => prepareBucket(bucket, products),
).pipeError(
  // Use a separate pipe for error processing
  map(typeguard),
);

// Create a view slot early, connect a source when the context is known
const userView$ = statefulConnection<User>({ name: "userView" });
const userDisplay$ = userView$.pipeValue(map((u) => u.displayName));

userView$.connect(userStore.get(userId));
// or a vanilla observable:
userView$.connect(http.get<User>(`/users/${userId}`));
// switch context:
userView$.connect(userStore.get(otherId));
// disconnect (emits inactive):
userView$.disconnect();

// Full notation
const datastream = statefulObservable({
  input: form.valueChanges,
  loader: (value) => api.fetch(value),
  cacheKey: (input) => [input],
  cacheSize: 10,
  name: "myDataStream",
});

// Transform values with pipeValue
const transformedData = datastream.pipeValue(map(processResponse));

// Handle errors in separate stream
datastream.error$.subscribe((error) => {
  console.error("An error occurred:", error);
});

// Track loading state
datastream.pending$.subscribe((isLoading) => {
  console.log("Loading:", isLoading);
});

// All together
datastream.subscribe({
  pending: isLoading => console.info("Loading:", isLoading),
  next: value => console.log("Value:", value),
  error: error => console.error("Error:", error),
  complete: () => console.log("Completed"),
})

// Manually trigger reload
datastream.reload();
```

Any of the streams above can be materialized in a template using the following pattern:

```html
<div [class.withSpinner]="client$.pending$ | async">
  @if (client$.error$ | async; as error) {
    <app-generic-error text="Failed to load"></app-generic-error>
  } @else {
    <app-data-widget [displayData]="client$ | async"></app-data-widget>
  }
</div>
```

With statefulObservable you can create, chain, and combine data streams, and pick `error$` and `pending$` streams anywhere in your app.
No more `tap(() => loading$.next(true))` boilerplate.
No more dead observables after an error — statefulObservable will handle the next input change as usual, even if a pipe previously produced an error.

## More recipes

See https://github.com/earthdmitriy/stateful-observable/blob/main/docs/recipes.md

## API Reference

### `statefulObservable(options)`

Creates a new stateful observable wrapper.

#### Options

- `input`: Source observable providing input values
- `loader`: (Optional) Function to transform input values
- `mapOperator`: (Optional) Custom operator for mapping values (defaults to switchMap)
- `cacheKey`: Method mapping input to key identifying the query
- `cacheSize`: Cache size. Defaults to 42. Cache uses an LRU-like strategy
- `name`: (Optional) Debug name used in error messages and `log`
- `log`: (Optional) Called for each event with a `ResponseDto` (and `{ input }` on the root)
- `meta`: (Optional) Arbitrary metadata attached to the observable instance, accessible via `.meta`

#### Returns

Returns a `StatefulObservable` object with the following properties:

- `raw$`: The raw observable containing all states (loading, error, success)
- `value$`: Observable that emits only successful values
- `error$`: Observable that emits only error states
- `pending$`: Observable that emits boolean loading states: `true` while a change was started and has no result yet
- `reload(options?)`: Function to trigger a manual reload; `{ onlyFailed, where, path }` narrow it to failed, matching or positioned sources (see below)
- `pipe(...)`: Method to apply operators to the raw observable
- `pipeValue(...)`: Method to transform successful values
- `pipeError(...)`: Method to transform error states
- `with(options)`: Returns a new `StatefulObservable` with updated name and/or meta

Loading is emitted only for work that does not finish synchronously. A synchronous result (an input-only node, a loader returning `of(...)`, a cache hit) comes without a loading event. A pipe whose operators do not finish synchronously (a request inside `pipeValue`, a `delay`) emits its own loading.

Operators inside `pipe`, `pipeValue` and `pipeError` behave as in plain RxJS, with a few guarantees on top:

- they run as one pipeline per node, so operators that keep state across values work (`scan`, `distinctUntilChanged`, `startWith`), the operator decides about concurrency (`switchMap` switches, `mergeMap` runs every value), and operators that hold context decide how long the node stays connected (`shareReplay(1)` keeps it);
- an error thrown inside becomes an error event, and the stream keeps processing later values (operator state restarts after the error);
- a result that arrives after a newer loading or error event has passed is outdated and dropped;
- `inactive` cancels work in flight and resets operator state;
- an operator that completes the stream (`takeUntilDestroyed()`, `takeUntil`, `take`, `first`) completes the subscribers and releases the source, so `stream.pipe(takeUntilDestroyed()).subscribe(...)` cleans up on destroy;
- a value dropped by an operator (`filter`, `distinctUntilChanged`) leaves the node pending: a change was started and has no result. To start nothing at all, apply such operators to the input instead.

A root does not complete when its input does: it lives as long as the application, is deactivated with `active` rather than ended, and stays ready for `reload()`. Only leaves in disposable components and services end, for example with `takeUntilDestroyed()`. So operators that act on completion (`reduce`, `last`, `toArray`, `count`) do not emit when applied directly to the live stream; inside a higher-order operator they work as usual, because the inner stream completes (`switchMap((id) => api.page(id).pipe(toArray()))`). A timer applied to the live stream runs until its leaf ends; see the [ADR](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md#roots-do-not-complete).

## Error Handling

The library provides comprehensive error handling through the `ResponseError` type:

```typescript
// Handle errors with pipeError
const datastream = statefulObservable({
  input: source$,
}).pipeError(map((error) => `Processed error: ${error}`));

// Access error states
datastream.error$.subscribe((error) => {
  // Handle error
});
```

## Metadata

Attach arbitrary metadata to a stateful observable for debugging, logging, or framework integration:

```typescript
const stream = statefulObservable({
  input: source$,
  meta: { feature: "user-profile", role: "admin" },
});

console.log(stream.meta); // { feature: "user-profile", role: "admin" }
```

Metadata is preserved through `pipeValue`, `pipeError`, and `pipe` chains:

```typescript
const derived = stream.pipeValue(map(transform));
derived.meta; // same reference as stream.meta
```

### `.with(options)`

Returns a new `StatefulObservable` with updated name and/or meta. The original instance is not modified.

```typescript
// rename only
const renamed = stream.with({ name: "userStream" });

// change meta only
const withNewMeta = stream.with({ meta: { feature: "other" } });

// change both
const updated = stream.with({ name: "newName", meta: { feature: "other" } });
```

When only `name` is provided, the original meta is preserved. When `meta` is provided, it replaces the previous value.

### Utilities

#### `combineStatefulObservables()`

Combines multiple stateful observables into a single one.

```typescript
const combined = combineStatefulObservables(
  // tuple
  [datastream1, datastream2], // [StatefulObservable<T1,E1>,StatefulObservable<T2,E2>]
  // types are being inherited from sources
  // [T1, T2]
  ([value1, value2]) => ({ value1, value2 }),
);
```

It is aware of the error type:

```typescript
const combined = combineStatefulObservables(
  [datastream1, datastream2], // [StatefulObservable<T1,E1>,StatefulObservable<T2,E2>]
).pipeError(
  // type is inherited from source tuple
  // [E1 | false, E2 | false]
  map(([e1, e2]) => mapError(e1, e2)),
);
```

`reload()` on a combined node calls `reload()` on every source (through nested combined nodes and pipes). `reload(options?)` narrows that down:

```typescript
combined.reload(); // reload all sources
combined.reload({ onlyFailed: true }); // only the sources that are currently failed
combined.reload({ where: ({ meta }) => isProducts(meta) }); // only the matching part
combined.reload({ onlyFailed: true, where: ({ name }) => name === "catalog" }); // both
combined.reload({ path: [0, 1] }); // by position: source 0, then its source 1
```

With `onlyFailed` a failed source is reloaded, a source that is itself a combined node recurses into its own failed sources, and loading, inactive or healthy sources are not refetched (so with no failed source nothing is refetched). A plain `statefulObservable` root ignores `onlyFailed` and reloads. The node knows the sources' latest state only while it has subscribers; if there is no such information (never subscribed, or the last subscriber left so `refCount` reset the stream) it falls back to reloading all sources.

With `where`, every node on the way from the handle to the roots is checked against its own `name` and `meta` (including meta set with `.with()`). A match reloads that node's whole subtree; a root with no match on its way is not reloaded. The search covers only the graph behind the handle you call it on, so the caller needs no references to the sources. `meta` is `unknown` in the predicate, because sources carry different meta types; narrow it with a type guard.

The selector does not have to be a string literal: take it from the derived stream itself, so renaming it cannot break the retry.

```typescript
const productsTag = { area: "products" };

const catalog$ = allProducts$
  .pipeValue(map(toCatalog))
  .with({ name: "catalog", meta: productsTag });

const basket$ = combineStatefulObservables(
  [bucket$, catalog$],
  ([bucket, catalog]) => prepareBasket(bucket, catalog),
);

// retry only the catalog part of the basket
basket$.reload({ where: ({ name }) => name === catalog$.name });
// or by meta: compared by identity, so no type guard is needed
basket$.reload({ where: ({ meta }) => meta === catalog$.meta });
```

`path` addresses a source by position instead, which needs no names at all. Only combinations count as hops; pipes and `.with()` are passed through. The positions are the same as in the nested `error$` tuple, so a per-source error view already has the path of the failed source:

```typescript
// [[bucket, catalog], user]: error$ emits [[false, catalogError], false]
const page$ = combineStatefulObservables([basket$, user$], ([basket, user]) => ({ basket, user }));

page$.reload({ path: [0, 1] }); // catalog only
page$.reload({ path: [0], onlyFailed: true }); // failed sources of the basket
```

`path` is followed first, then `onlyFailed` and `where` apply inside the part it reaches. An index out of range, or a path deeper than the graph, reloads nothing. A hard-coded path depends on the order of sources, so prefer `where` with a name unless the path comes from `error$`. See the [ADR](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md#selective-reload-of-a-derived-graph).

#### `statefulConnection(options?)`

Creates a relay `StatefulObservable` that can be wired to a source at runtime.

```typescript
const slot = statefulConnection<User, ApiError>({ name: "userView" });

slot.connect(statefulSource);
slot.connect(http.get<User>("/users/1")); // vanilla ObservableInput also works
slot.disconnect(); // emits inactive
```

Options:

- `name`: Optional debug name (default: `"connection"`)
- `refCount`: Optional refCount for the internal relay (default: `true`)
- `meta`: Optional metadata attached to the connection, accessible via `.meta`

Returns `StatefulConnection<T, E>` — a `StatefulObservable` plus:

- `connect(source)` — `StatefulObservable<T, E>` or `ObservableInput<T>`
  - stateful source: forwards `raw$` events (loading, error, value, inactive)
  - vanilla source: emits loading, then values; errors via `catchResponseError`
- `disconnect()` — unsubscribes and emits inactive

Before the first `connect` and after `disconnect`, the connection is inactive (same semantics as `active: false`). `connect` and `disconnect` exist only on the root instance; piped derivatives receive relayed events from the root.

`reload()` is a no-op on connections.

#### `serializeResponse()` / `deserializeResponse()`

`ResponseWithStatus` uses `Symbol.for` sentinels, so it is stable across bundled copies of the package but is not JSON-safe.

`ResponseDto` is the serializable ResponseContainer:

```typescript
type ResponseDto<T, E = unknown> =
  | { value: T }
  | { pending: true }
  | { inactive: true }
  | { error: E };
```

Success is always `{ value }`, so user data such as `{ pending: true }` cannot collide with a loading sentinel.

```typescript
import {
  serializeResponse,
  deserializeResponse,
} from "@rx-evo/stateful-observable";

const dto = serializeResponse(rawEvent);
const json = JSON.stringify(dto);
const restored = deserializeResponse(JSON.parse(json));
```

The optional `log` callback receives this same `ResponseDto` shape (plus `{ input }` on the root node), including pending and inactive events.

## State Management Example

```typescript
class UserService {
  // mimic formValue
  private userInput = new BehaviorSubject<number>(1);

  users = statefulObservable({
    input: this.userInput,
    loader: (id: number) => this.fetchUser(id),
  }).pipeValue(map((user) => transformUser(user)));

  setUserId(id: number) {
    this.userInput.next(id);
  }

  private fetchUser(id: number): Observable<User> {
    return this.http.get(`/api/users/${id}`);
  }
}
```

## Under the hood

### Response Types

At the heart of a StatefulObservable is the `raw` data stream.

```typescript
type ResponseLoading = {
  state: typeof loadingSymbol;
};

type ResponseInactive = {
  state: typeof inactiveSymbol;
};

type ResponseError<E = unknown> = {
  state: typeof errorSymbol;
  error: E;
};

type ResponseWithStatus<T, E = unknown> =
  | ResponseInactive
  | ResponseLoading
  | ResponseError<E>
  | T;

const stream: StatefulObservable<User, UserErrors> = create();

const rawStream: Observable<ResponseWithStatus<User, UserErrors>> =
  stream.raw$;
```

Sentinel symbols are registered with `Symbol.for("@rx-evo/stateful-observable/...")`, so type guards work even when several copies of the package are bundled. For logs and the network, convert to `ResponseDto` with `serializeResponse`.

By default every node caches its `raw` stream with `shareReplay({ bufferSize: 1, refCount: true })`: subscribers share one request, and the stream is released when the last one leaves. Pass `refCount: false` to keep it without subscribers (chained nodes inherit it):

```typescript
const user$ = statefulObservable({ loader: () => fetchUser(), refCount: false });
```

Operators passed to `.pipe(...)` decide how long they keep the node: when the last subscriber leaves, the node stays connected for as long as the operators hold on to it. `.pipe(shareReplay(1))` keeps it alive and replays to the next subscriber, `map` lets go at once, and `share({ resetOnRefCountZero: () => timer(5000) })` lets go five seconds later. A returning subscriber gets the latest state (a newer loading or error wins over a buffered value). `refCount: false` keeps a node alive without any operator. For time-based policies, wrap the loader's observable or drive `reload()` (see [compare.md](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/compare.md), "Caching strategies compose with RxJS").

Only the last value is cached.

Using typeguards, the `raw` stream is split into three separate streams to simplify state consumption:

```typescript
const value = raw.pipe(filter(isSuccess));
const error = raw.pipe(
  filter(isError),
  map((e) => e.error),
);
const pending = raw.pipe(map(isLoading));
```

Angular template example:

```html
<div [class.loading]="statefulObservable.pending$ | async">
  @if (clientData.error$ | async; as error) {
  <app-generic-error
    [error]="error"
    (reload)="statefulObservable.reload()"
  ></app-generic-error>
  } @else {
  <app-client-info
    [displayData]="statefulObservable.value$ | async"
  ></app-client-info>
  }
</div>
```

```markdown
              ┌──────────────┐                             ┌───────────┐
     ┌────────│ Loading:true │─────────────────┐        ┌──│ loading$  │
     │        └──────────────┘                 │        │  └───────────┘
┌──────────┐  ┌────────────┐ok┌─────────────┐ok│────────│  ┌───────────┐
│  Source  │──│ Processing │──│ Processing  │──│  raw$  │──│ value$    │
└──────────┘  └────────────┘  └─────────────┘  │────────│  └───────────┘
                    │                │         │        │  ┌───────────┐
                    │ fail           │ fail    │        └──│ error$    │
                ┌────────┐       ┌────────┐    │           └───────────┘
                │  Error │       │ Error  │────│                        
                └────────┘       └────────┘    │                        
                    └──────────────────────────┘                                         
```

And here is where the magic happens. As you remember, only the last value is cached in the raw stream.

Let's imagine it is a 'loading' event.
Template will get:

- Loading: true
- Value: empty
- Error: empty

Only spinner or skeleton will be shown.

What if it contain 'value' event?
Template will get:

- Loading: false
- Value: data
- Error: empty

Template will render data.

What's with 'error' event?
Template will get:

- Loading: false
- Value: empty
- Error: error

Template will render error.

Therefore any subscriber will receive the correct value at any time.

Moreover, on reload (or when new input arrives) the `raw` stream emits a new `loading` event. That replaces the previous value in the current StatefulObservable instance and in any derived observables created via `pipeValue` or `pipeError`.
The data (or error) is retained until a new data (or error) event appears. This behavior helps prevent unnecessary layout shifts.

## How does this compare to pure RxJS?

For a side-by-side comparison with vanilla RxJS, Angular signals and resources, and NgRx, including where each one is the better choice, see https://github.com/earthdmitriy/stateful-observable/blob/main/docs/compare.md

Stateful Observables are a purposeful abstraction built on top of RxJS.

- Origin: They were created to solve the repetitive boilerplate of handling loading, error, and data states in a large Angular application.

- Purpose: They encapsulate common patterns so you don't have to rebuild them repeatedly.

- Relationship: They are designed to work with RxJS, not replace it. We recommend using this library for standard state management (~80% of cases) and pure RxJS for the remaining complex scenarios.

## How is this different from a global state manager (like NgRx, Akita, etc.)?

Our approach is founded on a key principle: global state creates more problems than it solves.

- Problem with Global State: It leads to tight coupling across your app, making it fragile and hard to debug. Tracing the source of data becomes difficult.

- Our Solution: Atomic, feature-specific states. By keeping state granular and co-located, you always know exactly where your data comes from, resulting in more transparent and predictable code.

## Why [XXX] / I want [YYY]?

Check Architecture Decision Records https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md
You might find answers here.

Or create new issue https://github.com/earthdmitriy/stateful-observable/issues

## Changelog

0.7.0
- `reload({ onlyFailed, where, path })`: reload only the failed sources, the part of the graph whose name or meta matches, or a source by position
- cache keys are encoded as JSON: no more collisions between `1` and `"1"` or between different object inputs; key parts must be JSON-serializable
- factory: consumers are counted, so `reset(false)` and `cacheSize` eviction never drop or duplicate a stream that is in use; no longer `@experimental`
- fixes: `reset(true)` completes subscribers, `active: false` clears the result cache, falsy results are served from the cache, a `null` result no longer crashes the stream, a synchronous throw in a loader or `cacheKey` no longer ends the stream

Full history: [docs/changelist.md](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/changelist.md)

## License

ISC
