# Stateful Observable

A TypeScript library that provides a stateful wrapper for RxJS observables, making it easier to handle loading state, errors, and datastream in a consistent way.

## Installation

```bash
npm install stateful-observable
```

## Key Features

- Wraps RxJS observables with loading, error, and success states
- Provides true reactivity - works with ifinite amount of event projecting them correctly into 'value', 'pending' and 'error' streams
- Provides type-safe error handling
- Supports value and error transformation through piping
- Implements caching and replay functionality
- Enables easy combination of multiple stateful observables

## Usage

```typescript
import { statefulObservable } from 'stateful-observable';

// Create a basic stateful observable
const datastream = statefulObservable({
  input: new BehaviorSubject(1)
});

// Transform values with pipeValue
const transformedData = datastream.pipeValue(
  map(value => value * 2)
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

## More recipes
See https://github.com/earthdmitriy/stateful-observable/blob/main/docs/recipes.md 

## API Reference

### `statefulObservable(options)`

Creates a new stateful observable wrapper.

#### Options

- `input`: Source observable providing input values
- `loader`: (Optional) Function to transform input values
- `mapOperator`: (Optional) Custom operator for mapping values (defaults to switchMap)

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
datastream.error.subscribe(error => {
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

Heart of StatefulObservable is 'raw' datastream.
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

By default raw being cached using `shareReplay({ bufferSize: 1, refCount: true })`, but you can add your caching strategy, for example
```typescript
const statefulObservable: StatefulObservable<User,UserErrors> = create().pipe(shareReplay(1));
```
But only last value should be cached. 

Using typeguards raw stream being split to 3 separate streams to simplify state consumption.
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

Therefore any subsriber at any time will get correct value.

Moreover - in case of reload we'll get new `true` in 'loading' stream.
And datastream (or error) will be kept intact until new datastream (or error) event appear.
It will prevent unnecessary layout shift.

## Why [XXX] / I want [YYY]?
Check Architecture Decision Records https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md 
You might find answers here.

Or create new issue https://github.com/earthdmitriy/stateful-observable/issues


## License

ISC
