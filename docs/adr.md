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
The new Angular resource has this flaw as well. Example: https://earthdmitriy.github.io/rx-evo/wip/resource  
Compare it with the behavior of a stateful observable: https://earthdmitriy.github.io/rx-evo/wip/stateful-observable

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
const totalValue$ = combineStatefulObservable([prices$, bucket$],
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

Add pipe methods to simplify interoperability.

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
// With a helper
const mapped = source.pipe(
  map(onlyValue((value) => transformValue(valueWithState)))
);
// Not ideal
const mapped = source.pipe(
  map(onlyValueObservable((value) => this.api.fetchBy(valueWithState)))
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

Additionally, since the first version, the Angular team has added a `write` method to resources and almost every signal. This makes it impossible to declare pure data transformation pipes because anyone can interfere with them anywhere. This is unfortunate. Signals are still suitable for simple data management in components, but for complex scenarios, I prefer using Observables with this wrapper.

# To Be Determined

## Set Caching Strategy on Initialization?

This would allow piped successors to reuse it without needing to write `shareReplay(1)` again.

## Reimplement `active$` stream from `tinyRxStore` for nested cache invalidation

Pros:
- The source would be able to invalidate the cache for successors

Cons:
- Is this a common use case?