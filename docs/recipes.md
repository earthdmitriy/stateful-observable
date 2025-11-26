# Stateful Observable Recipes

## Installation

```bash
npm install @rx-evo/stateful-observable
```

## Usage

### Importing the library

```typescript
import {
  statefulObservable,
  combineStatefulObservables,
} from "@rx-evo/stateful-observable";
```

### Creating a stream

```typescript
private readonly stream = statefulObservable({
  loader: () => this.apiService.fetchSomething(),
});
```

### Creating a Stream with all parameters

```typescript
private readonly stream = statefulObservable({
  input: someStream$, // any Observable
  loader: (input) => this.apiService.fetchSomething(input),
  mapOperator: concatMap, // by default switchMap
  cacheKey: (input) => [input],
  cacheSize: 100500
});
```

### Shorthands

```typescript
private readonly stream = statefulObservable(someStream$);
// similar to
private readonly stream = statefulObservable({
  input: someStream$,
});
```

```typescript
private readonly stream = statefulObservable(
  () => this.apiService.fetchSomething()
);
// similar to
private readonly stream = statefulObservable({
  loader: () => this.apiService.fetchSomething(),
});
```

## Use cases
For angular

### Stateful request in component

#### Wrapping request

```typescript
protected readonly stream = statefulObservable({
  loader: () => this.apiService.fetchSomething(),
});
```

#### Unwrapping states in template

With spinner

```html
<div [class.withSpinner]="stream.pending$ | async">
  @if (stream.error$ | async) {
    <app-generic-error text="Failed to load"></app-generic-error>
  } @else {
    <app-data-widget [displayData]="stream.value$ | async"></app-data-widget>
  }
</div>
```

With skeleton

```html
@if (stream.pending$ | async) {
  <app-skeleton></app-skeleton>
} @else { 
  @if (stream.error$ | async) {
    <app-generic-error text="Failed to load" (reload)="stream.reload()"></app-generic-error>
  } @else {
    <app-data-widget [displayData]="stream.value$ | async"></app-data-widget>
  } 
}
```

Recommended way - stateful container
```html
<app-stateful-container
  [pending]="stream.pending$ | async"
  [error]="stream.error$ | async"
  (reload)="stream.reload()"
>
  @if (stream.value$ | async; as data) {
    <app-data-widget [displayData]="data"></app-data-widget>
  }
</app-stateful-container>
```
Or
```html
<app-stateful-container
  [stream]="stream"
>
  @if (stream.value$ | async; as data) {
    <app-data-widget [displayData]="data"></app-data-widget>
  }
</app-stateful-container>
```
If it's ok for you to bind component to statefulObservable


It's template
```html
<div [class.withSpinner]="pending()">
  @if (error()) {
    <app-generic-error (reload)="reload.emit()"></app-generic-error>
  } @else {
    <ng-content></ng-content>
  }
</div>
```
Stateful container should merge your default loading indicator and error view. Here is only generic implementation because everyone use own loading indicator and own error-handling views (if they exist, of course).


In UI, it is the most boilerplate-free way to handle loading and error states.


It is lazy
```typescript
protected readonly showData = signal(false);
```

```html
@if (showData()) {
  @if (stream.pending$ | async) {
    <app-skeleton></app-skeleton>
  } @else { 
    @if (stream.error$ | async) {
      <app-generic-error text="Failed to load"></app-generic-error>
    } @else {
      <app-data-widget [displayData]="stream.value$ | async"></app-data-widget>
    } 
  } 
}
```

Stream won't be materialized until showData() become true

### Mapping rx stream to request

```typescript
public readonly clientId = input<number>();
private readonly clientId$ = toObservable(clientId);
// or if you're not on signals yet
@Input() public set clientId(value: number) {
  this.clientId$.next(value);
}
private readonly clientId$ = new ReplaySubject<number>(1);
// or with forms
protected readonly clientIdCtrl = this.fb.control<number | null>(null, [
  Validators.required,
]);
// no debounce an filtering to shorten example
private readonly clientId$ = this.clientIdCtrl.valueChanges;

protected readonly stream = statefulObservable({
  input: this.clientId$,
  loader: (clientId) => this.apiService.fetchClient(clientId),
});
```

With spinner

```html
<div [class.withSpinner]="stream.pending$ | async">
  @if (stream.error$ | async) {
    <app-generic-error text="Failed to load client"></app-generic-error>
  } @else {
    <app-client-info [client]="stream.value$ | async"></app-client-info>
  }
</div>
```

### Shared data in service

```typescript
@Injectable({
  providedIn: "root",
})
export class ProductsStreamService {
  private readonly productsApi = inject(ProductsApiService);

  // public method to trigger re-fetch
  public reload() {
    this.stream.reload;
  }

  public readonly stream = statefulObservable({
    input: this.reload$,
    loader: () => this.productsApi.allProducts$(),
  })
    .pipeValue(map((response) => response.data))
    .pipe(shareReplay(1));
}
```

### Combining data from streams

```typescript
public readonly clientId = input<number>();

private readonly bucketApi = inject(BucketApiService);
private readonly productsStream = inject(ProductsStreamService).stream;

private readonly bucketStream = statefulObservable({
  input: toObservable(this.clientId),
  loader: (clientId) => this.bucketApi.getClientBucket$(clientId),
});

protected readonly populatedBucketStream = combineStatefulObservables(
  [this.bucketStream, this.productsStream],
  ([bucket, products]) => prepareBucket(bucket, products)
);
```

With spinner

```html
<div [class.withSpinner]="populatedBucketStream.pending$ | async">
  @if (populatedBucketStream.error$ | async) {
    <app-generic-error text="Failed to load"></app-generic-error>
  } @else {
    <app-bucket [data]="populatedBucketStream.value$ | async"></app-bucket>
  }
</div>
```

### Nested streams

```typescript
public readonly clientId = input<number>();

private readonly bucketApi = inject(BucketApiService);
private readonly productApi = inject(ProductApiService);
private readonly productsStream = inject(ProductsStreamService).stream;
private readonly destroyRef = inject(DestroyRef);

protected readonly bucketStream = statefulObservable({
  input: toObservable(this.clientId),
  loader: (clientId) => this.bucketApi.getClientBucket$(clientId),
}).pipeValue(map((response) =>
  response.products.map((productInBucket) => ({
    shortProduct: productInBucket,
    expanded: signal(false),
    productDetailsStream: statefulObservable({
      loader: () => this.productApi.getProduct$(productInBucket.productId),
    }),
  }))
));
```

Unwrapping in template

```html
<div [class.withSpinner]="bucketStream.pending$ | async">
  @if (bucketStream.error$ | async) {
    <app-generic-error text="Failed to load bucket"></app-generic-error>
  } @else { 
    @for (product of bucketStream.data | async; track product.productId) {
      <div>
        <app-short-product-info
          [product]="product.shortProduct"
        ></app-short-product-info>
      </div>
      <div>
        <button (click)="toggleExpand(product)">Toggle details</button>
      </div>
      @if (product.expanded()) {
        <div [class.withSpinner]="product.productDetailsStream.pending$ | async">
          ...
        </div>
      }
    } 
  }
</div>
```

### Handling separate error types

```typescript
protected readonly stream = statefulObservable({
  input: this.clientId$,
  loader: (clientId) => this.apiService.fetchClient(clientId),
}).pipeError(
  map((error, clientId) => {
    if (is404(error)) return "404";
    if (is403(error)) return "403";
    if (is500(error)) return "500";
    return "unknown"; // don't return error as is because it will merge return union type into unknown
  })
);
```

Type will be

```typescript
StatefulObservable<Client, "404" | "403" | "500" | "unknown">;
```

Therefore you'll be able to show different error messages for each error type

### Putting UPDATE result into stream

```typescript
protected readonly action$ = new BehaviorSubject<
  { type: "fetch" } | { type: "update"; payload: UserSettings }
>({ type: "fetch" });

protected readonly stream = statefulObservable({
  input: this.action$,
  loader: (action) => {
    switch (action.type) {
      case "fetch":
        return this.apiService.fetchSettings();
      case "update":
        return this.apiService.updateSettings(action.payload);
    }
  },
});

protected submit() {
  this.action$.next({ type: "update", payload: this.from.value });
}
```

### Dynamic combined stream

In case if you need cache entities queried by id

```typescript
@Injectable({
  providedIn: "root",
})
export class ProductsStreamService {
  private readonly productsApi = inject(ProductsApiService);

  private readonly productByIdStream: {
    [id: number]: StatefulObservable<Product, string>;
  } = {};

  public getStreamById(id: number) {
    return (this.productByIdStream[id] ??= statefulObservable({
      loader: () => this.productsApi.getProduct$(id),
    }).pipe(shareReplay(1)));
  }

  public getCombinedStreamByIds(ids: number[]) {
    const streams = ids.map((id) => this.getStreamById(id));
    return combineStatefulObservable(streams, (products) => products);
  }
}
```

### Smart cache

In case if you need cache filtered lists of entities

```typescript
@Injectable({
  providedIn: "root",
})
export class ProductsStreamService {
  private readonly productsApi = inject(ProductsApiService);
  private readonly loggedIn$ = inject(EventsService).loggedIn$;

  private readonly dataByQuery: {
    [query: string]: StatefulObservable<Product[], string>;
  } = {};

  constructor() {
    this.loggedIn$
      .pipe(
        filter((loggedIn) => !loggedIn),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        // clear, because query can contain private data
        for (const query in this.dataByQuery) {
          delete this.dataByQuery[query];
        }
      });
  }

  public getStream(filters: FiltersObject) {
    const stringifiedQuery = JSON.stringify(filters);
    return (this.dataByQuery[stringifiedQuery] ??= statefulObservable({
      loader: () => this.productsApi.getProduct$(filters),
      processError: (_, filters) => `Can't fetch products`,
    }));
  }
}
```

### Unit tests

Use statefulObservable with mock data in loader

```typescript
describe("SomeService", () => {
  let service: SomeService;

  const createService = createServiceFactory({
    service: SomeService,
    providers: [
      {
        provide: StreamService,
        useValue: {
          stream: statefulObservable({
            loader: () => of([1, 2, 3, 4, 5]),
          }),
        },
      },
    ],
  });
});
```
