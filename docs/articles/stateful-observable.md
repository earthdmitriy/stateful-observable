# Stateful Observable: loading, errors and combined data in RxJS without the boilerplate

*Why I stopped writing `tap(() => this.loading = true)`.*

Every Angular codebase I have worked on has the same few lines somewhere, usually in many places: a `loading` flag set from a `tap`, an `error` field set from a `catchError`, and a `shareReplay` somewhere in between.

It works for the happy path. Then someone adds a second async pipe to the template and the request goes out twice. A failure path forgets to reset `loading`, and the spinner never goes away. Someone combines this stream with another one, and now there are two `loading` flags and two `error` fields to merge by hand. A user logs out, and a `shareReplay(1)` three services away still replays the previous user's data.

When I searched GitHub for `tap(() => this.loading`, I got about 12 thousand files. That number has no denominator, but it does show that this pattern is everywhere.

This article is about **[Stateful Observable](https://github.com/earthdmitriy/stateful-observable)** ([`@rx-evo/stateful-observable`](https://www.npmjs.com/package/@rx-evo/stateful-observable) on npm), a small library I built on top of RxJS to replace that boilerplate. A *stateful observable* is an observable that carries its own loading, error and inactive state, survives errors, shares itself by default and combines with other stateful observables. On top of that it gives you a dataflow graph that you can recover from any node.

```bash
npm install @rx-evo/stateful-observable
```

The library depends only on RxJS. My examples are written for Angular because that is where the library started, but it isn't tied to Angular. It runs in Node.js too, more on that below.

## It looks like a small thing. It isn't.

One `tap` for a loading flag or one `shareReplay` doesn't look like much. The trouble is that they don't come alone. Here is the data part of a component based on a real one from my [demo app](https://github.com/earthdmitriy/rx-evo). It shows a client and the client's bucket enriched with a product catalog:

```typescript
export class StreamComponent {
  public readonly clientId = input.required<number>();
  private readonly clientId$ = toObservable(this.clientId);

  public readonly clientLoading$ = new BehaviorSubject(true);
  public readonly bucketLoading$ = new BehaviorSubject(true);
  public readonly productsLoading$ = new BehaviorSubject(true);

  public readonly client$ = this.clientId$.pipe(
    tap(() => this.clientLoading$.next(true)),
    switchMap((clientId) => this.clientsApi.getClient$(clientId)),
    tap(() => this.clientLoading$.next(false)),
  );
  private readonly bucket$ = this.clientId$.pipe(
    tap(() => this.bucketLoading$.next(true)),
    switchMap((clientId) => this.bucketApi.getClientBucket$(clientId)),
    tap(() => this.bucketLoading$.next(false)),
  );
  private readonly products$ = this.productsApi
    .allProducts$()
    .pipe(tap(() => this.productsLoading$.next(false)));

  public readonly populatedBucket$ = combineLatest([
    this.bucket$,
    this.products$,
  ]).pipe(
    map(([bucket, products]) => prepareBucket(bucket, products)),
    shareReplay(1),
  );

  public readonly combinedLoading$ = combineLatest([
    this.bucketLoading$,
    this.productsLoading$,
  ]).pipe(map((arr) => arr.some(Boolean)));
}
```

The business logic here is three API calls and one `prepareBucket`. Everything else is plumbing: three mutable loading subjects, five `tap`s that write to them, a hand-merged `combinedLoading$`, and a `shareReplay` on one stream but not on the others. Each of those is a decision someone had to get right.

And this version has **no error handling at all**. If the bucket request fails, `bucket$` ends, `populatedBucket$` ends with it, `bucketLoading$` stays `true`, and the spinner spins forever. A new `clientId` doesn't help, because the stream is already dead. Adding error handling means a `catchError` and an error subject per stream, and one more hand-merged `combinedError$`. The noise roughly doubles.

The same component with Stateful Observable:

```typescript
private readonly clientId$ = statefulObservable(toObservable(this.clientId));
private readonly allProducts$ = inject(allProductsToken); // shared, app-wide

public readonly client$ = this.clientId$.pipeValue(
  switchMap((id) => this.clientsApi.getClient$(id)),
);
private readonly bucket$ = this.clientId$.pipeValue(
  switchMap((id) => this.bucketApi.getClientBucket$(id)),
);

public readonly populatedBucket$ = combineStatefulObservables(
  [this.bucket$, this.allProducts$],
  ([bucket, products]) => prepareBucket(bucket, products),
);
```

What's left is the business logic. Loading, errors, recovery after a failure and sharing are all there, and you can read each of them from any node: `populatedBucket$.pending$`, `populatedBucket$.error$`, `populatedBucket$.reload()`.

## What I wanted to fix

I started with a list of problems I kept running into on real projects:

1. **Common RxJS misuses that cost requests.** The best-known one is a missing `shareReplay`, which turns every extra subscriber into another HTTP request.
2. **Loading flags set by hand.** No more `tap(() => this.loading.set(true))`.
3. **Errors that end the stream.** I wanted error handling and recovery built in, not written by hand for each stream.
4. **Combining several data sources**, each with its own loading and error state, in a way that behaves correctly.
5. **A dataflow graph that costs nothing to build.** Once 1–4 are solved, that graph is what you get.

I'll go through them in that order.

## 1. Shared by default: no accidental extra requests

A plain observable is cold. Every subscription runs the whole pipeline again. If you bind one stream in a template three times (value, pending flag, error), you send three requests. In a measured run with a hand-written state operator, three subscriptions made three requests, and adding `shareReplay` brought it down to one.

Adding `shareReplay` is easy to forget. Once you remember it, you have more choices to make: `refCount` or not, and how to reset the buffer later (`shareReplay` has no reset, which matters at logout).

A stateful observable is shared by default. Each node caches its raw stream with `shareReplay({ bufferSize: 1, refCount: true })`, so all subscribers share one request and the source is released when the last one leaves:

```typescript
import { statefulObservable } from "@rx-evo/stateful-observable";

const client$ = statefulObservable({
  input: clientId$,
  loader: (id: number) => api.getClient(id),
});

// value$, pending$ and error$ together: one request
```

Data that should live for the whole app is one option away:

```typescript
const products$ = statefulObservable({
  loader: () => api.allProducts(),
  refCount: false, // keep it without subscribers
});
```

It is still lazy. Nothing happens until something subscribes, so a section rendered under `@if` starts its request when it is expanded and releases it when it collapses. You don't write any code for that.

## 2. Loading state without `tap`

A stateful observable exposes three derived streams next to the values:

- `value$`: successful values only
- `pending$`: `true` while a change was started and has no result yet
- `error$`: errors, as values

All three are derived from one cached `raw$` stream, so they always agree with each other. Nothing in your code writes to them. Loading is derived from the loader, not set from a `tap`. In a template, using the `client$` from the component above:

```html
<div [class.loading]="client$.pending$ | async">
  @if (client$.error$ | async; as error) {
    <app-error [error]="error" (retry)="client$.reload()" />
  } @else {
    <app-client [client]="client$.value$ | async" />
  }
</div>
```

Two details took me several attempts to get right:

**The previous value stays on screen while new data loads.** A new `pending` event does not clear the last value. Only a new value or a new error replaces it. Many "wrap the response" helpers emit `{ loading: true, value: null }` on every request, which wipes the content and makes the layout jump. I didn't want that.

**Loading is emitted only for work that is actually asynchronous.** A cache hit or a synchronous result arrives without a loading event, so `pending$` doesn't flicker.

`pipeValue` and `pipeError` take ordinary RxJS operators. You don't need special operators that know about wrapped values or `if (isLoading(x)) return x` branches. `switchMap` switches, `mergeMap` runs everything in parallel, and `scan` and `distinctUntilChanged` keep their state as they do in plain RxJS.

### Why three pipes instead of one

A single `pipe` over wrapped events would make every operator deal with the state:

```typescript
// one pipe for everything
source.pipe(
  mergeMap((event) => {
    if (isLoading(event)) return of(event); // bypass
    if (isError(event)) return of(event);   // bypass
    return api.fetchBy(event);
  }),
);
// and concatMap in that place behaves incorrectly
```

The other way out is a set of helper operators (`onlyValue(...)` and friends). That's one more API to learn, and it fits badly with operators that weren't written for it. Separate pipes keep ordinary operators working, including higher-order ones:

```typescript
statefulObservable(formValue$)
  .pipeValue(switchMap((v) => api.fetchBy(v)))  // values only
  .pipeError(map(toTypedError))                 // errors only
  .pipe(takeUntilDestroyed());                  // the whole stream
```

Plain `pipe` is for operators that apply to the whole stream: `takeUntilDestroyed`, `shareReplay`, `debounceTime`. And because `takeUntilDestroyed` goes in through `pipe`, the library doesn't need Angular to clean up after itself. The full reasoning is in the [ADR](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md#chaining-and-pure-rxjs-interoperability).

## 3. Errors are data, and the stream survives them

In RxJS an error ends the stream. In a `combineLatest`, one failing branch ends the combined stream and everything below it. Recovering takes `catchError` in the right place, at every level.

In a stateful observable, an error is one of the states. An error thrown in any pipe is caught at that node and sent on as an error event, and the stream goes on to handle the next input:

```typescript
const result$ = statefulObservable(query$).pipeValue(
  switchMap((q) => this.api.search(q)), // fails for one query...
);
// ...and still delivers the result for the next one
```

Errors can be typed. You narrow them once at the source, and the type carries through later pipes and combinations:

```typescript
const products$ = statefulObservable({
  loader: () => api.allProducts(),
  name: "allProducts",
}).pipeError(map(toProductsError)); // error$ is now Observable<ProductsError>
```

Every node has `reload()`, so a retry button needs no extra Subject:

```html
<button (click)="client$.reload()">Retry</button>
```

Errors are also hard to lose. If nothing subscribes to `error$`, the failure is logged to the console with the node's name and its position in the chain (`Unhandled error in statefulObservable 'clientStream #1'`). When you subscribe, the message goes away. A stateful observable doesn't swallow errors without a trace.

## 4. Combining data sources properly

This is the part that tends to go wrong. A bucket enriched with a product catalog looks like this in plain RxJS:

```typescript
const populatedBucket$ = combineLatest([bucket$, products$]).pipe(
  map(([bucket, products]) => prepareBucket(bucket, products)),
);
```

That's fine until you need a spinner and an error view. Then you need a rule: is the combination pending if *any* source is pending? Which error wins? Which source failed? Each team writes this rule a bit differently in each combination.

With `combineStatefulObservables` the rule is part of the library:

```typescript
import { combineStatefulObservables } from "@rx-evo/stateful-observable";

const populatedBucket$ = combineStatefulObservables(
  [bucket$, products$],
  ([bucket, products]) => prepareBucket(bucket, products),
);
```

- Values come in as a typed tuple (`[Bucket, Product[]]`), inferred from the sources.
- The error is a tuple too, with one entry per source: `[BucketError | false, ProductsError | false]`. You can see exactly which source failed.
- The priority is the same at every combination: **inactive, then pending, then error, then value.**
- An error is emitted only once every source has settled. An error event therefore describes the full state. It is never partial and never extended later, so "retry what failed" reaches everything that failed.
- While a source is pending, the combination emits pending instead of combining that source's old value with another source's new one. With asynchronous sources this removes the outdated combinations that plain `combineLatest` briefly emits.

The cost of that rule: an error waits for the slowest source in the same combination. The reasoning and the alternatives I considered are in the [ADR](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md#priority-of-states-in-a-combination).

Combinations nest, and a combined node is a stateful observable like any other. You can pipe it, combine it again and reload it.

### Chained requests: where plain RxJS gets tricky

A very common case: load an entity by id, then load a related entity by its foreign key, and show both together.

```typescript
const entity$ = id$.pipe(
  switchMap((id) => api.fetchEntity(id)),
  shareReplay(1),
);
const relatedEntity$ = entity$.pipe(
  switchMap(({ foreignKey }) => api.fetchRelatedEntity(foreignKey)),
);
const combined$ = combineLatest([entity$, relatedEntity$]);
```

This is where loading tracking and stale data get difficult:

- **Stale mix.** When the id changes, `entity$` gets the new entity first, while `relatedEntity$` still holds the related entity of the old one. `combineLatest` emits that pair: the new entity with the old related data, a combination that never existed. In a quick run with two delayed requests and the id going from 1 to 2, the vanilla version emitted `1/10`, then **`2/10`**, then `2/20`.
- **Loading.** The related entity is out of date as soon as the id changes, not when the new entity arrives. So a hand-written `relatedLoading` flag has to start on the id, not on its own input. Get that wrong, and the old related data is shown as current while the new entity loads.
- **Errors.** If either request fails, the whole chain ends, as in the component at the start of this article.

The same with Stateful Observable:

```typescript
const id$ = statefulObservable(form.valueChanges);

const entity$ = id$.pipeValue(
  switchMap((id) => api.fetchEntity(id)),
);
const relatedEntity$ = entity$.pipeValue(
  switchMap(({ foreignKey }) => api.fetchRelatedEntity(foreignKey)),
);

const combined$ = combineStatefulObservables(
  [entity$, relatedEntity$],
  ([entity, related]) => ({ entity, related }),
);
```

Pending travels down the chain, so `relatedEntity$` is pending as soon as `entity$` is, and the combination emits pending instead of pairing new data with old. In the same run, this version emitted `1/10`, then pending, then `2/20`. The mix was never emitted. Each step has its own `pending$` and `error$`, a failure in the second request leaves the first one on screen, and `combined$.reload()` reloads the chain.

### Split, chain, combine

The library is built for the shapes real dataflows take. A stream gets **split** into several branches. A branch **chains** requests, each one depending on the previous. Branches get **combined** again, either from separate roots (a client's bucket with the app-wide catalog) or by recombining a stream with something derived from it (an entity with its related entity). Each of those shapes has its own edge cases: stale mixes, loading that starts at the wrong moment, errors that end everything. In a stateful observable they're handled the same way at every node. So a reliable dataflow graph takes no extra effort.

In most apps I've seen, this graph is never built. Handling it properly means a lot of boilerplate and edge cases, so the usual shortcut is to merge everything together: one `forkJoin`, one big request, one store update, one spinner for the whole page. It works, but the cost is real. Nothing renders until the slowest request answers, so there's no progressive loading. One failed endpoint takes down the whole page, so there's no graceful degradation. And the error handling is a single "something went wrong" with no way to retry only the part that failed.

## 5. The result: a dataflow graph you get for free

Go back to the stateful version of the component at the start of this article. The root token behind `allProducts$` is one more declaration:

```typescript
export const allProductsToken = new InjectionToken("allProducts", {
  providedIn: "root",
  factory: () => {
    const api = inject(ProductsApiService);
    return statefulObservable({
      loader: () => api.allProducts$(),
      name: "allProducts",
      refCount: false, // app-wide data: keep it without subscribers
    });
  },
});
```

Put together, the pieces form a graph:

![Stateful Observable dataflow graph: clientId feeds clientId$, which feeds client$ and bucket$; bucket$ and the app-wide allProducts$ combine into populatedBucket$; client$ feeds the client block and populatedBucket$ feeds the bucket block, two independent UI blocks](https://raw.githubusercontent.com/earthdmitriy/stateful-observable/main/docs/articles/images/stateful-observable-dataflow.png)

Every node has the same handle: `value$`, `pending$`, `error$`, `reload()`. That brings a few things with it:

**Graceful degradation follows from the shape of the graph.** Each piece of UI is a leaf that depends only on the sources it needs. A failure blocks only the nodes that depend on it, and every other leaf still renders. If the catalog endpoint is down, the client header still shows.

**Progressive rendering is the default.** Streams are lazy and each region subscribes to its own sources, so each region renders as soon as those sources answer, without waiting for the rest of the page.

**Recovery works from any handle.** A template often holds only the final node. `reload()` on that node reloads every source behind it, through every layer of pipes and combinations. If you add a source to the combination later, the retry button doesn't need to change. You can narrow it down:

```typescript
populatedBucket$.reload();                                    // everything behind it
populatedBucket$.reload({ onlyFailed: true });                // only what failed
populatedBucket$.reload({ where: ({ name }) => name === "allProducts" }); // by name or meta
populatedBucket$.reload({ path: [1] });                       // by position, as in the error tuple
```

You don't need a global registry or query keys, and the caller doesn't need to know what the sources are.

**The dataflow can be read straight from the code.** Derived nodes have no write API, so a value has exactly one producer, and you find where it comes from by following references. The diagram above is redrawn from what [angular-mermaider](https://github.com/earthdmitriy/angular-mermaider) produced for the component. It's a static analyser I wrote as a proof of concept, and it draws this graph without running the app. That only works because the graph is pure.

None of this needs plumbing per layer. In plain RxJS you can build the same thing, but you build it yourself: `{ data$, reload }` pairs from every layer, a combining helper with a rule, a reload method that knows every source. A stateful observable gives every node all of that.

On top of the core, the library has a few tools for real-app problems: `active` to drop user data at logout, a result cache per input, and factories for lookups by id, with batching. [Part 2](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/articles/four-data-layers.md) shows them at work on a complex page. The [quality-of-life guide](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/QoL.md) describes them in detail.

## Why not signals, resources or a store?

I tried signals first. Signals are synchronous by nature, which makes laziness hard. In my experiments the requests kept running after the UI that needed them was hidden. By default, Angular's `resource` resets its value when a new request starts, so large content jumps; keeping it takes a documented extra pattern. Combining several resources needs your own helper, and that helper again has to decide which status wins and which source failed. My notes from those attempts are in the [ADR](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md). Signals do work well as the presentation layer on top of stateful streams (`toSignal(stream.value$)`).

Stores solve a different problem: shared *mutable* state. I deliberately made Stateful Observable without a write path. A value changes only because an input went through the loader. My premise is that a frontend owns no source of truth except user input, and everything else is a projection of an API. If your problem really needs many writers patching shared state, a store is the right tool. A stateful observable isn't.

### Looks like a resource, doesn't it?

Yes and no. A resource is fine in a component that projects a single data source: one read, owned by that component, with loading, error and reload built in. It starts to need workarounds when you combine several sources, or when the data is held in a shared service: a cache shared between sections, invalidation after a write, cancelling a read nobody waits for, dropping user data at logout. In the contest in part 2, the resources entry needed per-entity registries and a version counter for invalidation, and it still failed 14 scenarios.

A stateful observable is one solution that works the same way everywhere: in a component, in a shared service or token, and in a combination of both. The contest entry in part 2 used the same handle for all of them.

## Not only Angular

The library started in Angular apps, but it depends only on RxJS. It has no framework code, no browser globals and no timers of its own. The Angular parts in my examples (`toObservable`, `inject`, the async pipe) are glue on the consumer side.

So it runs in Node.js too. My other project, [langflower](https://github.com/earthdmitriy/langflower), is a local visual workflow tool: a node graph that runs agents, tools, checks and human gates on a project folder. Its runtime, compiler and node SDK use Stateful Observable under the hood. That's a good fit, because an agentic workflow is the same problem as a page full of data: a graph of steps where each step can be in progress, fail or succeed, where a failure should stay local, and where a retry should rerun only the part that needs it.

## Limitations

- **It's young, but not new.** Version 0.8.0, one maintainer, a small user base. It didn't appear overnight, though. The first version went to npm in October 2025, and 16 releases have followed since. The design grew out of earlier iterations described in the [ADR](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md) (a wrapping operator, then a small store), and today it has a suite of 733 tests. It's also a thin layer over RxJS, so what you rely on underneath (`switchMap`, `shareReplay`, `combineLatest`) is mature.
- **There's no write path, by design.** You can't patch cached data. Saves are requests whose result you show (through the input or a separate save stream). Optimistic UI is possible as an overlay you write yourself.
- **Two things to know about pipes.** Both come with features plain RxJS doesn't have. Pending can't tell a value dropped by `filter` *inside* a pipe from a request still running, so the node stays pending; validation belongs on the input. And the stream survives an error, where plain RxJS would stop, but operator state such as `scan` starts over after it.
- **No runtime devtools yet.** A prototype exists: an operator that sends every event to the Redux DevTools extension. It isn't shipped, because a proper integration has to be on in development builds and absent from production, and that switch ties it to each framework's build tools. The core stays framework-agnostic, so devtools would mean a separate package per framework. Until then, the graph topology makes tracing cheap: a `log` callback on a root traces every node derived from it, and nodes carry names and `meta`. If you'd use devtools, [tell me in an issue](https://github.com/earthdmitriy/stateful-observable/issues): that decides whether the packages get built.
- **No time-based cache policy out of the box.** A TTL or polling is composed from RxJS operators and `reload()`.
- **Events are plain RxJS work.** RxJS is good at managing events as it is: debounce, merges, sequences, time windows. The library doesn't replace that. It closes the gap that RxJS leaves for async data that can fail.

## Recipes for people and agents

The library ships [recipes](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/recipes.md), a [quality-of-life guide](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/QoL.md) and [design decisions](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md), written for both people and AI agents: where a source lives, how to invalidate the cached values of a subtree (for example on logout), how to batch a lookup, how to refresh what a write changed, and why the library works the way it does. In a check on the page from part 2, an agent given the recipes built a slice of it (a session, a batched lookup per row, a polled section, a write that refreshes another view) and followed the intended pattern on every point, with no steering.

## Try it

```bash
npm install @rx-evo/stateful-observable
```

```typescript
import {
  statefulObservable,
  combineStatefulObservables,
} from "@rx-evo/stateful-observable";

const user$ = statefulObservable({
  input: userId$,
  loader: (id: number) => api.getUser(id),
  name: "user",
});

user$.subscribe({
  pending: (isLoading) => console.log("loading:", isLoading),
  next: (user) => console.log("user:", user),
  error: (error) => console.error("error:", error),
});
```

- Source and docs: [github.com/earthdmitriy/stateful-observable](https://github.com/earthdmitriy/stateful-observable)
- npm: [@rx-evo/stateful-observable](https://www.npmjs.com/package/@rx-evo/stateful-observable)
- Recipes: [docs/recipes.md](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/recipes.md)
- Quality-of-life guide: [docs/QoL.md](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/QoL.md)
- Design decisions: [docs/adr.md](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/adr.md)

**Does it hold up on a real page?** In [part 2](https://github.com/earthdmitriy/stateful-observable/blob/main/docs/articles/four-data-layers.md), I build one busy page four ways (plain RxJS, Stateful Observable, Angular signals with resources, NgRx SignalStore), judge all of them with the same test suite, and count the code.

If you've written `tap(() => this.loading = true)` more than once this year, try a stateful observable on one screen. If it saved you some plumbing, star the [repo](https://github.com/earthdmitriy/stateful-observable). If it didn't, [open an issue](https://github.com/earthdmitriy/stateful-observable/issues) and tell me why.
