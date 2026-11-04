# Architecture Decision Records

## Goal

The overall goal is to achieve true reactivity through data streams.

- Should deliver correct additional statuses:
  - Pending
  - Error
- Should work with an infinite number of events and correctly project them into additional statuses
- Should be error-aware:
  - Error is one of the possible states; the stream should not terminate on error
  - Errors should be strongly typed
  - The stream should be able to recover after errors

Additionally:

- The solution should hide meaningless boilerplate code behind a developer-friendly public API

## Glossary

**Event** - An event in an Observable. Something happens. This is not necessarily a DOM event or an event from a third-party library.

**Stream** - A data stream managed by Observables.

## Why not just an operator that wraps values into a stateful container?

This was one of the first iterations of this concept.  
See: https://github.com/earthdmitriy/rx-evo/blob/master/src/app/services/tinyStore/operators/wrapResponse.ts

Simplified version:

```typescript
export const wrapResponse =
  <T>(): OperatorFunction<T, ResponseWithStatus<T>> =>
  (source: Observable<T>): Observable<ResponseWithStatus<T>> =>
    source.pipe(
      map((value) => ({
        loading: false,
        value,
        error: null,
      })),
      startWith({ loading: true, value: null, error: null }),
      catchError((error: unknown) => of({ loading: false, value: null, error }))
    );
```

### Single event

Usage:

```typescript
const id$ = new ReplaySubject<number>();

const wrappedResponse$ = fetchSomething().pipe(wrapResponse());
```

```html
@if(wrappedResponse$ | async; as response) {
<div [class.loading]="response.loading">
  @if (response.error) {
  <app-generic-error></app-generic-error>
  } @else {
  <app-client-info [displayData]="response.value"></app-client-info>
  }
</div>
}
```

This looks acceptable, but it doesn't work correctly with multiple requests in the observable.

### Multiple events

Example:

```typescript
const formValue$ = this.form.valueChanges.pipe(startWith(this.form.value));

const wrappedResponse$ = this.formValue$.pipe(
  switchMap((formValue) => fetchSomething(formValue)),
  wrapResponse()
);
```

The user will only see the loading indicator once.

Example:

```typescript
const formValue$ = this.form.valueChanges.pipe(startWith(this.form.value));

const wrappedResponse$ = this.formValue$.pipe(
  switchMap((formValue) => fetchSomething(formValue).pipe(wrapResponse()))
);
```

This is better, but a new event from `formValue$` will emit `null` in the value, causing the previous content to be erased and resulting in unnecessary layout shifts.  
The new Angular resource has this flaw as well.

## About Angular Resources
In short, the synchronous nature of signals imposes certain limitations.

Using global state in a service is debatable because the resource isn't lazy and sends a request immediately. At the time, I had to put in a lot of effort to fight off unnecessary requests. It wasn't about resources, but a custom implementation that would send requests as soon as the service instance was created.

I don't like that it resets the content when a new request starts (example here https://earthdmitriy.github.io/rx-evo/wip/resource – if the content is large, it doesn't look good). This behavior occurs because signals are inherently synchronous. Creating a version of the resource that wouldn't reset the content is also a bad idea, again due to the synchronous nature of signals. If someone calls resource.value() at the moment a new request starts, they will receive an outdated version of the data.

Also, if you need to combine multiple requests, you require an additional utility (example here https://github.com/earthdmitriy/rx-evo/blob/master/src/app/components/wip/resource/resource.component.ts and here https://github.com/earthdmitriy/rx-evo/blob/master/src/app/services/resource/combineResources.ts#L21).

So the answer is:
Resources are okay when you need to load data from a component once and don't need to combine requests.
For anything more complex, a fine-tuned RxJS will handle it better.

## Solution

1. Split the observable into three separate streams: `value`, `pending`, and `error`
   - Each delivers data independently
   - Therefore, new events in `pending` won't affect the rendered data
2. As a side effect, wrapping the observable provides access to the event source (e.g., `formValue`), allowing correct notification of consumers about new `pending` events

## Combining data streams

Example:

```typescript
// Separate data sources
const prices$ = this.pricesService.prices$;
const bucket$ = this.bucketService.bucket$;
// Their combination
const totalValue$ = combineLatest([prices$, bucket$]).pipe(
  map(([prices, bucket]) => calculateTotal(prices, bucket))
);
```

Without pending states and errors, this looks simple. However, if the user adds something to the bucket (sending a request), we need to show a loading indicator while the request is in progress and hide it when the new value arrives.

Additionally, error handling with multiple sources requires a lot of code.

### Solution

The library should provide a function to combine stateful observables out of the box.

```typescript
// Separate stateful observables
const prices$ = this.pricesService.prices;
const bucket$ = this.bucketService.bucket$;
// Their combination
const totalValue$ = combineStatefulObservables(
  [prices$, bucket$],
  ([prices, bucket]) => calculateTotal(prices, bucket)
);
```

## Chaining and pure rxjs interoperability

The second iteration was named `tinyRxStore`.  
Usage example:  
https://github.com/earthdmitriy/rx-evo/blob/master/src/app/components/wip/tiny-rx-store/tiny-rx-store.component.ts

```typescript
public readonly clientStore = createTinyRxStore({
  input: toObservable(this.clientId),
  loader: (clientId) => this.clientsApi.getClient$(clientId),
  processError: () => "Can't load client",
});

private readonly bucketStore = createTinyRxStore({
  input: toObservable(this.clientId),
  loader: (clientId) => this.bucketApi.getClientBucket$(clientId),
  processError: () => "Can't load bucket",
});

public readonly populatedBucketStore = combineTinyRxStores(
  [this.bucketStore, this.productsStore],
  ([bucket, products]) => prepareBucket(bucket, products),
);
```

Live demo:  
https://earthdmitriy.github.io/rx-evo/wip/tiny-rx-store

It includes:

- Internal binding to `DestroyRef` to ensure cleanup
- An additional stream `active$` that helps temporarily put the stream to sleep (e.g., when the user logs out, something expires, or becomes invalid)

This generally covers 80% of data management cases on the frontend.

Documentation:  
https://github.com/earthdmitriy/rx-evo/tree/master/src/app/services/tinyStore

However:

- People are often apprehensive about the word "Store" in the name, associating it with something large and complex
- It requires using it for the entire data chain, which is acceptable for new code, but sometimes additional data needs to be picked from another observable

### Solution

Rename it to `statefulObservable` to better explain the library's nature.

Add pipe methods to simplify interoperability and allow chaining.

Three methods are provided:

- `pipe` - Accepts only mono-type operators like `shareReplay`, `debounceTime`, `takeUntilDestroyed`, etc.
- `pipeValue` - Works like a regular pipe on an observable, applied to the `value` stream
- `pipeError` - Works like a regular pipe on an observable, applied to the `error` stream

Why not use a single pipe to rule them all?

This would require something like:

```typescript
const mapped = source.pipe(
  map((valueWithState) => {
    if (isLoading(valueWithState)) return valueWithState; // bypass
    if (isError(valueWithState)) return valueWithState; // bypass
    return transformValue(valueWithState);
  })
);
// Even worse with higher-order operators
const mapped = source.pipe(
  mergeMap((valueWithState) => {
    // concatMap will work incorrectly here
    if (isLoading(valueWithState)) return of(valueWithState); // bypass
    if (isError(valueWithState)) return of(valueWithState); // bypass
    return this.api.fetchBy(valueWithState);
  })
);
// Synchronous mapping with a helper
const mapped = source.pipe(
  map(onlyValue((value) => transformValue(value)))
);
// Async mapping with a helper
const mapped = source.pipe(
  mergeMap(onlyValueObservable((value) => this.api.fetchBy(value)))
);
```

Additional operators would reduce flexibility.

Separate pipes look better:

```typescript
const data = statefulObservable(this.formValue)
  .pipeValue(
    switchMap((formValue) => this.api.fetchBy(formValue)),
    switchMap(({ relatedId }) => this.api.fetchRelatedBy(relatedId))
  )
  .pipeError(map(processError))
  .pipe(takeUntilDestroyed(), shareReplay(1));
```

A side effect: since `takeUntilDestroyed` can be provided via the pipe, the library is no longer bound to Angular.

## Why Not Signals?

I tried.

Example:  
https://github.com/earthdmitriy/rx-evo/blob/master/src/app/components/wip/tiny-store/tiny-store.component.ts

Demo:  
https://earthdmitriy.github.io/rx-evo/wip/tiny-store

Sources:  
https://github.com/earthdmitriy/rx-evo/blob/master/src/app/services/tinyStore/tinyStore.ts

However, signals are synchronous by nature, making it complicated to make them lazy. I partially solved this with `toLazySignal` from `ngxtension`, but it only works until the first signal usage. If you hide the bucket in the playground, you'll see that the bucket request continues running (which it shouldn't).

Overall, laziness is a very important feature of observables because it allows declaring data streams but materializing them only when needed.

Additionally, since the first version, the Angular team has added a `write` method to resources and linked signals. This makes it impossible to declare pure data transformation pipes because anyone can interfere with them anywhere. This is unfortunate. Signals are still suitable for simple data management in components, but for complex scenarios, I prefer using Observables with this wrapper.

## Error logging
Sometimes consumers don't subscribe to the `error$` stream and therefore don't see any feedback when an error occurs. Errors can become unintentionally muted. Handling errors in a separate stream is not a common pattern, so this is understandable.

Some may say that a stateful observable simply mutes errors. That statement is false.

As a solution, I added a side effect to `statefulObservable`. If there are no subscriptions to the `error$` stream, a specific message will be logged to the console:

```
Unhandled error in statefulObservable 'myDataStream #0'
Subscribe to the 'error$' stream to handle and silence these errors
Error details: [exception or network error]
```

Normally such errors won't be visible, but this message should help newcomers discover and handle them.

### Meta info for logging
For convenience, I've added an optional `name` parameter to the stream:

```typescript
const data = statefulObservable({
  input: clientId$,
  loader: (clientId) => fetchClient(client),
  name: 'clientStream',
}); // errors will refer to 'clientStream #0'

const relatedData = data.pipeValue(
  switchMap(({ foreignKey }) => fetchRelatedEntity(foreignKey)),
); // errors will refer to 'clientStream #1'
```

`#1` is the index in the chain; it indicates which node of the transformation chain failed.


## Full RxJS interop

While having `subscribe` is enough to work with async pipe and toSignal in Angular, `statefulObservable` can't be passed into high-order RxJS operators and things like firstValueFrom don't accept `statefulObservable` because they require Observable or InteropObservable.

Pros:
- Easier integration with existing RxJS code

Cons:
- Unfortunately `statefulObservable` needs to implement interface InteropObservable and mimic class Observable.

### Decision:
- Done

## Reimplement `active$` stream from `tinyRxStore` for nested cache invalidation

Pros:
- The source would be able to invalidate the cache for successors

Cons:
- Is this a common use case?
- Will need to pass additional `active$` stream through entire chain and use in `combine` logic

### Decision:
- Not worth it, with chaining it add much more complexity than profit

## Reimplement `active$` with additional event type in `raw` stream

Previously here was 3 types of events: value, error and pending in `raw` stream. Technically `sleeping` state can be implemented by pushing `loading` event through the chain. It has highest priority and will push value and error out of the data stream effectively invalidating cache and putting stream into kind of `sleeping` state. It seems to be simple enough because we don't require passing additional stream through the chain. Although subscribers of `pending$` stream will be notified that something is going on, that's, technically, not true.

But it can be avoided with additional event type (let's name it `inactive`) with priority even higher than `pending` event. It will push any other events out of cache, but won't be passed into actual subscriptions. Therefore goal can be achieved - stream can become inactive while keeping its subscriptions.

Pros:
- Seems to be more elegant solution than additional `active$` stream - new event will push last value out of the `raw` stream cleaning its state
- No additional subscription management like in `publishWhile` operator

Cons:
- Additional conditions in `value$`,`pending$` and `error$` streams, as well as in `subscribe`
- Behavior of `pipeValue(mergeMap(()) => anotherStream)` should be amended. `statefulObservable` should ignore any events in pipes when parent node is `inactive`

### Decision:
- Implemented

## Set Caching Strategy on Initialization?

This would allow piped successors to reuse it without needing to write `shareReplay(1)` again.

### Decision:
- Implemented as optional `refCount` parameter

## Pending state of a connection with a vanilla source

In this library *pending* means *pending changes*: a change was started and has not produced a result yet (a loader is running, or a value is still being processed by a pipe; an operator that drops the value leaves it pending). A vanilla source connected with `statefulConnection.connect(source)` gives no sign that a change was started until it emits: a request waits and then emits, but a `Subject`, a form's `valueChanges` or a websocket may stay silent for a long time. The connection cannot tell them apart, so there is no truthful pending state to show before the first value. Pending from `connect` would be a guess, and so would a caller-supplied option such as `connect(source, { pending: true })`: it states an assumption and guarantees nothing.

### Decision:
- A vanilla source gets a loading event only together with each value; until then the connection keeps its previous state. A spinner bound to `pending$` does not show while a vanilla request waits.
- No configuration option. Documented in [QoL](./QoL.md), "Connection", with the alternative: a stateful source brings its own pending state, for example `connect(statefulObservable({ loader: () => source$ }))`.

## Error events in `subscribe` and interop

`subscribe` with an object observer forwards each error event to `observer.error` and keeps delivering later values. This is outside the usual Observable contract, on purpose: the library treats a stream that stops on the first error as a design gap of vanilla RxJS.

Consequences:
- Consumers that keep listening recover. In Angular 21.1, `toSignal(stream)` throws when read after an error and returns the next value again; `stream | async` renders the next value.
- Consumers that follow the contract stop at the first error (RxJS operators through `InteropObservable`, `firstValueFrom`); RxJS ignores whatever arrives after it.
- With `| async`, each failed load also reaches `ErrorHandler` as an application error, so it shows up in error monitoring.

### Decision:
- Keep it. Consumers that must survive failures use `value$`, `pending$` and `error$`, which carry a failure as a value.

## Selective reload of a derived graph

`reload()` on a handle reloads every source behind it. A component usually holds only the final handle, so it cannot reach a single source by reference, but it often needs to: retry just the failed part, or just the catalog.

`reload(options?)` takes three filters, and they compose:
- `onlyFailed: true` reloads the sources whose latest state is an error.
- `where: ({ name, meta }) => boolean` reloads the part whose name or meta matches. Every node from the handle down to the roots is checked, including meta set with `.with()`; a match reloads that node's subtree. This is the default way to address a source: name it where it is declared and match the string.
- `path: number[]` follows source positions, e.g. `[0, 1]` is source 0 of the combination, then its source 1. Only combinations are hops. The positions are the same as in the nested `error$` tuple, so a UI that renders errors per source already has the path of the failed one.

`path` is followed first; `onlyFailed` and `where` apply inside the subtree it reaches. No match, an index out of range, or a path deeper than the graph reloads nothing.

Considered and rejected:
- Parsing a combined node's generated name (`[[bucket, catalog], user]`): names may contain `", "`, unnamed sources are all `"unnamed"`, and the format is meant for logs.
- A helper that lists the roots behind a handle: with `where` and `path` there is no need to discover the sources first.
- A global registry, as with query keys in TanStack Query: the search is limited to the graph behind the handle by design, so there is no central registry to maintain.

Costs:
- `where` depends on naming: only named or tagged sources can be addressed.
- A hard-coded `path` is a contract on the order of sources: inserting a source shifts the paths behind it. A path derived from `error$` does not have this problem.
- `path` is `readonly number[]` and is not checked against the tuple types.

### Decision:
- Implemented as `ReloadOptions` (`onlyFailed`, `where`, `path`), replacing the unreleased `reload(onlyFailed?: boolean)`.

## Loading only for asynchronous work

A root used to emit loading for every input, before the result, even when the result arrived in the same tick (an input-only node, a synchronous loader, a cache hit). In a form projection such as `statefulObservable(form.valueChanges).pipeValue(map(toQuery), filter(isValid), switchMap(search))` every keystroke then put the node into loading, and a value dropped by `filter` left it there, although nothing was started. A cache hit made `pending$` flicker.

With *pending* meaning "a change was started and has not produced a result yet", a change that finishes at once was never pending. So:
- a root subscribes to the result first and emits loading only if nothing arrived synchronously;
- a pipe does the same for each event it processes, so an asynchronous step inside `pipeValue` (a request, a `delay`) shows its own loading, and a loading event that directly follows another is dropped;
- a value dropped by an operator *on the input* starts nothing, so it changes nothing downstream.

Asynchronous loaders behave as before. Inside a pipe, a value dropped by an operator leaves the node pending (see "Operators in pipes"), so validation and deduplication that should start nothing go on the input: `statefulObservable(form.valueChanges.pipe(map(toQuery), filter(isValid), distinctUntilChanged(sameQuery)))`.

### Decision:
- Implemented in 0.7.0. Results that arrive synchronously no longer emit `[loading, value]`, only `[value]`, which is considered a positive side effect.

## Operators in pipes

In vanilla RxJS an error thrown in an operator ends the stream. To keep a stateful observable alive, 0.4.0 started to run the operators of `pipe`, `pipeValue` and `pipeError` per event: every event went through a fresh copy of them inside a `switchMap`. That isolated failures and cancelled outdated work, but it silently broke every operator that keeps state across events: `distinctUntilChanged`, `scan`, `take` did nothing, `startWith` emitted before every value, and `shareReplay` stopped sharing.

Four strategies were prototyped and run against the same requirements: per event (the 0.4.0 behaviour), one pipeline for the whole stream, a pipeline rebuilt on error, and a pipeline rebuilt on error with a gate. Only the last one met all of them.

Decision: each node gets one long-lived operator pipeline, fed through a Subject.
- Stateful operators work as in plain RxJS, and the operator decides about concurrency (`switchMap` switches, `mergeMap` runs every value).
- An error inside the pipeline becomes an error event, and only the pipeline is rebuilt. The Subject does not replay, so the failing event is not fed again; operator state restarts after the error.
- A result that arrives after a newer loading or error event has passed by is outdated and dropped (the gate), so it cannot override the newer state.
- `inactive` rebuilds the pipeline, which cancels work in flight and resets operator state.
- When a fed value produces no output synchronously, loading is emitted: the change was started and has no result yet. That covers asynchronous steps and values dropped by an operator, which cannot be told apart.
- Lifetime follows the operators. Context can be held in many ways (`shareReplay(1)`, `share` with a reset delay, a custom caching operator), so no operator is special-cased: when the last subscriber leaves, the node stays connected for as long as the operators stay subscribed to the feed, and is released when they let go, also later. A subscriber that comes back gets the latest state: the operator's replay when it is current, otherwise the last event (a loading or error that happened in between). A fixed `refCount` option on derived nodes was rejected for this reason: it would replace the operators' own strategy with one global choice.

Costs:
- A value dropped inside a pipe leaves the node pending. Validation and deduplication that should start nothing belong on the input.
- Work started for an outdated value keeps running until the operator itself cancels it (the next value for `switchMap`); only its result is dropped *(reasoned)*.
- An operator that completes the pipeline (`takeUntil`, `takeUntilDestroyed`, `take`, `first`) completes the node's subscribers and releases its source, as in plain RxJS. The per-event pipes of 0.4.0 to 0.6.0 never completed anything this way, so `stream.pipe(takeUntilDestroyed()).subscribe(...)` without an unsubscribe kept the node subscribed to its source after destroy (a leak, covered by `tests/pipeLifetime.spec.ts`).
- While the operators keep the node connected without subscribers, its events are still processed and recorded, so a loader can run with nobody looking; that is what holding context means.
- The implementation keeps mutable bookkeeping per node (the Subject, the gate, the count of operators holding the feed, the last event) inside the operator, like the combine and factory code.

## Roots do not complete

A root lives as long as the application. It is not ended when its input completes: it can be deactivated (`active: false`) to flush its data, and it stays ready to wake up and do its job again, which is also what lets `reload()` run after the input has completed. Only leaves that live in disposable components and services end, for example with `takeUntilDestroyed()` in their pipe, which completes their subscribers and releases the sources.

Consequences:
- Operators that act on completion do not act when applied directly to the live stream: there `reduce`, `last`, `toArray`, `count` never emit, `bufferCount` does not flush its last partial buffer, and `debounceTime` emits a pending value when its timer fires, not on completion. Inside a higher-order operator they work as usual, because the inner stream completes: `switchMap((id) => api.page(id).pipe(toArray()))` or `mergeMap((items) => from(items).pipe(reduce(...)))` (both directions in `tests/vanillaParity.spec.ts`). On the live stream itself, end the leaf first (`take`, `takeUntil`) when a finite result is needed.
- A timer applied to the live stream (`withLatestFrom(interval(...))`) runs for as long as the node is subscribed or kept alive by its operators; bound it, or end the leaf with the component. A timer inside a higher-order operator ends with its inner stream as usual.

### Decision:
- Expected behaviour; roots are deactivated, leaves are ended.

# To Be Determined

## Stale mix after reloading a combination of synchronous sources

`reload()` on a combined node reloads its sources one after another. A source that settles synchronously answers before the next one is reloaded, so `value$` briefly gets a mix of new and old values (e.g. new `a` + old `b`). Async sources are not affected: all of them are pending before any answers.

Accepted for now: in practice there is no reason to reload a synchronous data source. Possible fix if needed: `pipe(debounceTime(0))` on the combined stream, which collapses the synchronous burst into its final state. Its cost: every combined emission becomes asynchronous, one macrotask per combined layer.

## Deprecate value$ output stream
Pros:
- Since `subscribe` was added directly on the `statefulObservable` instance plus `InteropObservable` were implemented, there is no reason to subscribe onto `value$` to receive data.

Cons:
- some functions of RxJS (firstValueFrom) require exact Observable as parameter

## More shorthands

```typescript
const data = stream.pipeError(map(processError));
// shorthand version
const data = stream.mapError(processError);
```

```typescript
const data = stream.pipeValue(map(processValue));
// shorthand version
const data = stream.mapValue(processValue);
```

## In subscribe.next emit null on error

Pros:
In case if user ignore recommendation to use stateful container
```typescript
@if (stream.error$ | async) {
  Error
} @else {
  @if (stream$ | async; as value) {
    {{ value }}
  }
}
```
can be replaced with
```typescript
@if (stream.error$ | async) {
  Error
} 
@if (stream$ | async; as value) {
  {{ value }}
}
```
shorter, no nesting

Cons:
- Since implementation of InteropObservable generic parameter of type should represent actual type of value in subscribe
  - StatefulObservable<string> should satisfy Observable<string>, but with null it should be  Observable<string | number>
- possible intersection with null as user-defined possible value
- it is only QoL change

Possible solution:
- add null as possible value into value$ stream. Since it's common Observable its type can be defined as Observable<Value | null>
