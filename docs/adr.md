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
For anything more complex, a fine-tuned RxJs will handle it better.

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
const totalValue$ = combineStatefulObservable(
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
// Syncronous mapping with a helper
const mapped = source.pipe(
  map(onlyValue((value) => transformValue(valueWithState)))
);
// Async mapping with a helper
const mapped = source.pipe(
  mergeMap(onlyValueObservable((value) => this.api.fetchBy(valueWithState)))
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


## Full RxJs interop

While having `subsribe` is enough to work with async pipe and toSignal in Angular, `statefulObservable` can't be passed into high-order RxJs operators and things like firstValueFrom don't accept `statefulObservable` because they require Observable or InteropObservable.

Pros:
- Easier integration with existing RxJs code

Cons:
- Unfortunately `statefulObservable` need to implement interface InteropObservable and mimic class Observable.

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

Previously here was 3 types of events: value, error and pending in `raw` stream. Techincally `sleeping` state can be implemented by pushing `loading` event through the chain. It has highest priority and will push value and error out of the data stream effectively invalidating cache and putting stream into kind of `sleeping` state. It seems to be simple enough because don don't require passing addtional stream through the chain. Although subsribers of `pending$` stream will be notified that something is going on, that's, techincally, not true.

But it can be avoided with additional event type (let's name it `inactive`) with priority even higher than `pending` event. It will push any other events out of cache, but won't be passed into actual subscriptions. Therefore goal can be achived - stream can become inactive while keeping its subscriptions.

Pros:
- Seems to be more elegant solution than additional `active$` stream - new event will push last value out of the `raw` stream cleaning its state
- No additional subscription management like in `publishWhile` operator

Cons:
- Additional conditions in `value$`,`pending$` and `error$` streams, as well as in `subscribe`
- Behavior of `pipeValue(mergeMap(()) => anotherStream)` should be amended. `statefulObservable` should ignore any events in pipes when parent node is `inacative`

### Decision:
- Implemented

## Set Caching Strategy on Initialization?

This would allow piped successors to reuse it without needing to write `shareReplay(1)` again.

### Decision:
- Implemented as optional `refCount` parameter

# To Be Determined

## Deprecate value$ output stream
Pros:
- Since `subscribe` was added directly on the `statefulObservable` instance plus `InteropObservable` were implemented, there is no reason to subscribe onto `value$` to receive data.

Cons:
- some functions of RxJs (firstValueFrom) require exact Observable as parameter

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
