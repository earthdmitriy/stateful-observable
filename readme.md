# Stateful Observable

A TypeScript library that provides a stateful wrapper for RxJS observables, making it easier to handle loading state, errors, and data streams in a consistent way.

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
- Implements caching and retry functionality
- Written with functional programming in mind — helps reduce mutation in projects

## Usage

```typescript
import { statefulObservable } from '@rx-evo/stateful-observable';

// Wrap a source observable with statefulObservable
const clientId$ = statefulObservable(form.valueChanges);

// Add transformation
const client$ = clientId$
  .pipeValue(
    switchMap(id => fetchClient(id))
  );

// Add more transformations
const entity$ = client$
  .pipeValue(
    switchMap(({ relatedEntityId }) => fetchAnotherEntity(relatedEntityId))
  );

// Another stream
const bucket$ = clientId$
  .pipeValue(
    switchMap(id => fetchClientBucket(id))
  );

// Data can be cached and shared (add operators like `shareReplay` as needed)
const products$ = statefulObservable(() => fetchProducts()).pipe(
  takeUntilDestroyed(),
  shareReplay(1),
);

// Combine stateful observables into a single derived stream
const processedBucket$ = combineStatefulObservable(
  [bucket$, inject(productCatalog)],
  ([bucket, products]) => prepareBucket(bucket, products),
).pipeError(
  // Use a separate pipe for error processing
  map(typeguard),
);

// Full notation
const datastream = statefulObservable({
  input: form.valueChanges,
  loader: value => api.fetch(value),
  cacheKey: (input) => [input],
  cacheSize: 10,
  name: 'myDataStream'
});

// Transform values with pipeValue
const transformedData = datastream.pipeValue(
  map(processResponse)
);

// Handle errors
datastream.error$.subscribe(error => {
  console.error('An error occurred:', error);
});

// Track loading state
datastream.pending$.subscribe(isLoading => {
  console.log('Loading:', isLoading);
});

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

#### Returns

Returns a `StatefulObservable` object with the following properties:

- `raw$`: The raw observable containing all states (loading, error, success)
- `value$`: Observable that emits only successful values
- `error$`: Observable that emits only error states
- `pending$`: Observable that emits boolean loading states
- `reload`: Function to trigger a manual reload
- `pipe(...)`: Method to apply operators to the raw observable
- `pipeValue(...)`: Method to transform successful values
- `pipeError(...)`: Method to transform error states

## Error Handling

The library provides comprehensive error handling through the `ResponseError` type:

```typescript
// Handle errors with pipeError
const datastream = statefulObservable({
  input: source$
}).pipeError(
  map(error => `Processed error: ${error}`)
);

// Access error states
datastream.error$.subscribe(error => {
  // Handle error
});
```


### Utilities

#### `combineStatefulObservables()`

Combines multiple stateful observables into a single one.

```typescript
const combined = combineStatefulObservables(
  // tuple
  [datastream1, datastream2], // [StatefulObservable<T1,E1>,StatefulObservable<T2,E2>]
  // types are being inherited from sources
  // [T1, T2]
  ([value1, value2]) => ({ value1, value2 })
);
```
It aware of error type
```typescript
const combined = combineStatefulObservables(
  [datastream1, datastream2], // [StatefulObservable<T1,E1>,StatefulObservable<T2,E2>]
).pipeError(
  // type is inherited from source tuple
  // [E1 | false, E2 | false]
  map(([e1,e2])=> mapError(e1,e2))
);
```

## State Management Example

```typescript
class UserService {
  // mimic formValue
  private userInput = new BehaviorSubject<number>(1);
  
  users = statefulObservable({
    input: this.userInput,
    loader: (id: number) => this.fetchUser(id)
  }).pipeValue(
    map(user => transformUser(user))
  );

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

type ResponseError<E = unknown> = {
  state: typeof errorSymbol;
  error: E;
};

type ResponseWithStatus<T, E = unknown> = ResponseLoading | ResponseError<E> | T;

const statefulObservable: StatefulObservable<User,UserErrors> = create();

const rawStream: Observable<ResponseWithStatus<User,UserErrors>> = statefulObservable.raw;
```

By default the `raw` stream is cached using `shareReplay({ bufferSize: 1, refCount: true })`, but you can apply your own caching strategy, for example:
```typescript
const statefulObservable: StatefulObservable<User,UserErrors> = create().pipe(shareReplay(1));
```
Only the last value is cached.

Using typeguards, the `raw` stream is split into three separate streams to simplify state consumption:
```typescript
const value = raw.pipe(filter(isSuccess));
const error = raw.pipe(
  filter(isError),
  map((e) => e.error)
);
const pending = raw.pipe(map(isLoading));
```

Angular template for example
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

And, where magic happens. As you remember only last value being cached in raw stream.

Let's imagine it 'loading' event.
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

Stateful Observables are a purposeful abstraction built on top of RxJS.

- Origin: They were created to solve the repetitive boilerplate of handling loading, error, and data states in a large Angular application.

- Purpose: They encapsulate common patterns so you don't have to rebuild them repeatedly.

- Relationship: They are designed to work with RxJS, not replace it. We recommend using this library for standard state management (~80% of cases) and pure RxJs for the remaining complex scenarios.

## How is this different from a global state manager (like NgRx, Akita, etc.)?

Our approach is founded on a key principle: global state creates more problems than it solves.

- Problem with Global State: It leads to tight coupling across your app, making it fragile and hard to debug. Tracing the source of data becomes difficult.

- Our Solution: Atomic, feature-specific states. By keeping state granular and co-located, you always know exactly where your data comes from, resulting in more transparent and predictable code.

## Why [XXX] / I want [YYY]?
Check Architecture Decision Records https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md 
You might find answers here.

Or create new issue https://github.com/earthdmitriy/stateful-observable/issues

## Changelog
0.3.0 
- `statefulObservable` will log errors in pipes with `console.error` so errors aren't unintentionally muted
  - only if no one is subscribed to `error$`
- new parameters for debugging
  - `log` to track any event in chain
  - `name` to assign public name for stream - should help identifying event source
0.2.0 
- `subscribe` method on `statefulObservable`. This makes it easy to pass the observable directly into an async pipe or convert it to a signal with `toSignal`.
- statefulObservable constructor - shorthands `statefulObservable(myInput$)` for input and `statefulObservable(() => http.get("/items"))` for loader

0.1.0 
- option defining cacheKey and cacheSize

## License

ISC
