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
  statefulObservableFactory,
  statefulConnection,
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
  cacheKey: (input) => [input.id], // JSON-serializable parts; [] skips caching
  cacheSize: 100, // by default 42
  active: this.auth.loggedIn$, // Observable<boolean>; false = inactive, caches cleared
  refCount: false, // by default true; false keeps the stream without subscribers
  name: "something", // used in logs, error messages and reload({ where })
  meta: { area: "something" }, // any metadata, readable as stream.meta
  log: (event, name, index) => console.debug(name, index, event), // every event
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

Stream won't be materialized until showData() becomes true

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
// no debounce and filtering to shorten example
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

### Form projection without extra requests

A form changes on every keystroke, but a request should go out only when the projected query is valid and has changed.

```typescript
protected readonly search = this.fb.group({ text: [""], status: ["active"] });

protected readonly results = statefulObservable(
  this.search.valueChanges.pipe(
    map((form) => ({ text: (form.text ?? "").trim(), status: form.status })),
    // dedupe on the input: an unchanged query starts nothing
    distinctUntilChanged((a, b) => a.text === b.text && a.status === b.status),
  ),
).pipeValue(
  filter((query) => query.text.length >= 3), // too short: no request, no pending
  switchMap((query) => this.api.search(query)),
);
```

The input node is synchronous, so a keystroke emits no loading by itself. `pending$` becomes `true` only when the request inside `pipeValue` actually starts. Keep `filter` and `distinctUntilChanged` on the input, as shown: inside `pipeValue` they work too, but a dropped value there means a change was started without a result, so the node stays pending.

### Shared data in service

```typescript
@Injectable({
  providedIn: "root",
})
export class ProductsStreamService {
  private readonly productsApi = inject(ProductsApiService);

  public readonly stream = statefulObservable({
    loader: () => this.productsApi.allProducts$(),
    name: "products",
    refCount: false, // keep the catalog for the app's lifetime
  }).pipeValue(map((response) => response.data));

  // public method to trigger re-fetch
  public reload() {
    this.stream.reload();
  }
}
```

Every stateful observable is already shared: subscribers of one node get one request. With the default `refCount: true` the stream is released when its last subscriber leaves and fetched again on the next one; `refCount: false` keeps it. An operator in `.pipe(...)` can decide the lifetime instead: the node stays connected for as long as the operators hold on to it. That is the way to express other strategies, for example keeping the catalog for a minute after the last subscriber leaves:

```typescript
public readonly stream = statefulObservable({
  loader: () => this.productsApi.allProducts$(),
}).pipe(share({ resetOnRefCountZero: () => timer(60_000) }));
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
    @for (product of bucketStream.value$ | async; track product.shortProduct.productId) {
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
  map((error) => {
    if (is404(error)) return "404";
    if (is403(error)) return "403";
    if (is500(error)) return "500";
    return "unknown"; // don't return error as is because it will merge union type into unknown
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
  // the default switchMap would cancel an in-flight update when the next action arrives
  mapOperator: concatMap,
});

protected submit() {
  this.action$.next({ type: "update", payload: this.form.value });
}
```

A save shows the same pending state as a fetch, and the response of the update replaces the value. If you also use `cacheKey`, give update actions a key that cannot hit the cache (or return `[]` for them), otherwise a repeated update is served from the cache.

### Dynamic combined stream

In case if you need cache entities queried by id

```typescript
@Injectable({
  providedIn: "root",
})
export class ProductsStreamService {
  private readonly productsApi = inject(ProductsApiService);

  // one shared stream per id, bounded, entries in use are never evicted
  private readonly productById = statefulObservableFactory({
    loader: (id: number) => this.productsApi.getProduct$(id),
    cacheSize: 200,
    refCount: false, // keep a loaded product when nobody shows it
  });

  public getStreamById(id: number) {
    return this.productById.get(id);
  }

  public getCombinedStreamByIds(ids: number[]) {
    const streams = ids.map((id) => this.getStreamById(id));
    return combineStatefulObservables(streams, (products) => products);
  }
}
```

`getCombinedStreamByIds` builds a new combined stream on every call, so call it once per list of ids (in a field, or when the ids change), not from a template expression. A hand-written `{ [id]: stream }` map works too, but it has no eviction and no `reset`. See [QoL](./QoL.md), "Factory", for the details.

### Smart cache

In case if you need cache filtered lists of entities

```typescript
@Injectable({
  providedIn: "root",
})
export class ProductsStreamService {
  private readonly productsApi = inject(ProductsApiService);
  private readonly loggedIn$ = inject(EventsService).loggedIn$;

  private readonly productsByFilters = statefulObservableFactory({
    loader: (filters: FiltersObject) => this.productsApi.searchProducts$(filters),
    // the key is encoded as JSON, so equal filter objects share one stream
    cacheKey: (filters) => [filters.status, filters.role, filters.page],
    active: this.loggedIn$, // inactive while logged out
  });

  constructor() {
    this.loggedIn$
      .pipe(
        filter((loggedIn) => !loggedIn),
        takeUntilDestroyed(),
      )
      // drop every cached query on logout, because queries can contain private data
      .subscribe(() => this.productsByFilters.reset(true));
  }

  public getStream(filters: FiltersObject) {
    return this.productsByFilters
      .get(filters)
      .pipeError(map(() => `Can't fetch products`));
  }
}
```

List the filter fields in `cacheKey` explicitly: object keys in a different order would otherwise be different keys. `getStream` pipes on every call, so call it once per filter change rather than from a template expression.

### Dynamic source switching

Use `statefulConnection` when a single view or service slot should stay alive while the underlying source changes — for example on route changes or when selecting another entity from a factory cache.

```typescript
@Injectable()
export class EntityPanelService {
  readonly entityView = statefulConnection<Entity>({ name: "entityPanel" });

  readonly entityTitle$ = this.entityView.pipeValue(
    map((entity) => entity.title),
  );

  private readonly entityFactory = statefulObservableFactory({
    loader: (id: number) => this.api.getEntity(id),
    cacheKey: (id) => [id],
  });

  showEntity(id: number) {
    this.entityView.connect(this.entityFactory.get(id));
  }

  clear() {
    this.entityView.disconnect();
  }
}
```

Call `connect` on the root connection instance. Piped derivatives such as `entityTitle$` receive relayed events automatically.

A vanilla observable can be connected too, but it shows no pending state until it emits (see the [ADR](./adr.md#pending-state-of-a-connection-with-a-vanilla-source)). For a request, connect a stateful observable: `connect(statefulObservable({ loader: () => request$ }))`.

### Retrying part of a combined stream

The handle a template holds can recover any part of the graph behind it, without references to the sources.

```typescript
protected readonly page$ = combineStatefulObservables(
  [this.basket$, this.catalog$, this.user$],
  ([basket, catalog, user]) => ({ basket, catalog, user }),
);
```

```html
<button (click)="page$.reload()">Retry everything</button>
<button (click)="page$.reload({ onlyFailed: true })">Retry what failed</button>
<button (click)="page$.reload({ where: ({ name }) => name === 'catalog' })">Retry the catalog</button>
<button (click)="page$.reload({ path: [1] })">Retry source 1</button>
```

`where` matches the `name` or `meta` of any node behind the handle, so give the sources you want to address a `name` (or take it from the stream: `name === catalog$.name`). `path` addresses a source by position; the positions are the same as in the nested `error$` tuple, so a per-source error view can retry exactly the failed one. The options compose: `{ path: [0], onlyFailed: true }` retries the failed sources of the first branch.

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
