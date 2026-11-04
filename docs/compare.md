# Comparing approaches to async state

How do you load data, show a spinner, survive errors and combine several sources? This article compares four common answers:

1. Vanilla RxJS
2. `statefulObservable`
3. Angular signals, including `resource` / `rxResource`
4. A store, with NgRx SignalStore (`@ngrx/signals`) as the example

## Origin of this document

This comparison was written by an AI agent (Claude) that was asked to produce an honest comparison of different approaches to async state. The agent did not know this library beforehand. The library's author gave hints about its purpose and intended capabilities (deterministic dataflows without mutation or side effects; combining streams in many different ways; graceful degradation and recovery when an endpoint fails; business logic not buried under boilerplate; and, added later, low resistance for writing modular, atomic code), pointed the agent at a real application as the running example, and then challenged the draft claim by claim.

Claims about the library were checked against its source and tests. Claims about other tools were checked against their documentation or source where possible. The places where the first version was wrong are listed, with the original claim, in a separate [corrections log](./compare-corrections.md). In the text, "I" means the agent.

## Read this first

- **The criteria below are the ones the library was built for**, as given by its author, so it scores well on them by construction. Section "Criteria it does not optimize for" lists where the library is weaker or deliberately absent.
- **Versions.** `statefulObservable` 0.7.0 (pre-1.0; history in the [changelist](./changelist.md)). Statements about Angular resources were first checked against the Angular 20 documentation and source, and the guide at angular.dev was read again in November 2026, which changed some of them (see section 3). NgRx SignalStore is `@ngrx/signals`. Classic `@ngrx/store` (actions, reducers, effects, selectors) is mentioned only where it differs. Check the docs for your versions.
- **What kinds of evidence are used.** Where it matters, a claim carries one of these tags:
  - *(ran)*: throwaway probes against the library and plain RxJS, deleted afterwards, so the numbers cannot be reproduced from the repository.
  - *(tests)*, *(source)*: the library's own tests or source. They show the library does what it says, not that alternatives cannot.
  - *(docs)*: official documentation or source of another tool, read at one point in time.
  - *(secondary)*: blog posts, forum threads, search snippets.
  - *(author)*: the library author's experience or opinion.
  - *(reasoned)*: an inference that was not tried.
  - *(unverified)*: common knowledge or an assumption, with no source checked.

  Untagged statements about other tools are readings of their documentation, not tests: "DIY" means I did not find the thing provided, not that I built it and measured the cost.
- **Examples are Angular-flavoured** because that is where the library was born. `statefulObservable` itself only depends on RxJS.

## The author's perspective (experience, not evidence)

The weighting of the criteria below comes from more than twelve years as a software engineer, not only as a frontend developer:

- **Functional programming.** An early interest (Akka, Scala). Working as a C# developer, the author used patterns from it, such as functional error handling, which later became the foundation for the graceful-degradation criterion.
- **Rx.NET and LINQ for data streams** showed that much of what is usually solved with imperative code can be written declaratively.
- **Moving to frontend**, the author was frustrated by how many problems in JavaScript code appear only at runtime, and started looking for ways to make frontend code reliable and strongly typed, as in other mainstream languages.

Specific criteria come from problems that recurred across several projects:

- **Eagerness** leads to unnecessary requests, and they are sometimes hard to deal with. It is why laziness (requests start when something consumes them) is a criterion here.
- **Mutation makes debugging hard.** An entity passed by reference and mutated somewhere else can cost hours of debugging, or days when the state it produces is rare.
- **Huge classes with many mutable properties are very hard to test and debug**, which is why the author prefers to write logic as deterministic data streams.
- **Stores are another kind of mutable class.** Actions can be traced in devtools, but who invoked an action? Potentially any part of the code can invoke it and mutate state, and overpopulated stores made the dataflow untraceable even with the devtools in use. This experience is with the classic action-based store; a SignalStore with protected state narrows the writers to its own methods (section 4), which is a smaller version of the same problem.

  "Traceable" covers three different questions. *What happened*: a devtools log shows it. *Which call site dispatched it*: only with the opt-in `trace` option and a developer attached to a running session with access to the store. *Who is able to dispatch it*: any code that can reach the dispatcher, which only reading the code answers. In a bug reported from the field the first two are usually unavailable, since devtools are typically used in development sessions and not in production *(unverified)*. The third question remains, and the suspects are every piece of code that can invoke the action. In a pure graph, as long as the purity actually holds, only what can reach the start of the event chain can affect a value, which narrows the search to the sources and the code that writes to them. It is why traceability and small, isolated units are criteria here.

The overpopulated-store problem is recognised beyond those projects (see below). Its cause is contested: one view is that slices can be kept small and decoupled, so overpopulation is misuse of a store; the other is that keeping them small takes extra effort, so the cheapest path leads the other way, which is the "path of least resistance" test this document applies to the library. The sources below show that the problem occurs, not how often or why.

What a search of docs, blog posts and forum threads found (practitioner opinion, not measurement):

- **Overpopulated stores are recognised.** The [Redux FAQ](https://redux.js.org/faq/organizingstate) says local component state is fine and gives rules of thumb for what belongs in a store. A [post on common NgRx mistakes](https://medium.com/briebug-blog/3-ways-youre-using-ngrx-wrong-6cc6e085d151) calls local UI state in the global store "intent is local, implementation is global". Both frame it as misuse of a store.
- **Untraceable origin is acknowledged, and the mitigation has conditions.** An [article](https://dev.to/bnevilleoneill/redux-devtools-tips-tricks-for-faster-debugging-2afn) says repeated actions from many places hide the root cause. Redux DevTools and NgRx's [store devtools](https://app.unpkg.com/@ngrx/store-devtools@20.0.0/files/src/config.d.ts) can record a stack trace for every dispatched action, but only when the opt-in `trace` option is on, with a developer attached to a running session and able to reach the store. That tells which call site did dispatch an action, not who can. For a bug reported from the field those conditions are typically not met *(unverified)*. The `trace` option and its default (off) come from the `@ngrx/store-devtools` 20.0.0 type definitions and its configuration guide *(secondary)*; its behaviour in `logOnly` mode was not checked. These are the classic store's devtools; for SignalStore, Redux DevTools integration comes from a community toolkit *(secondary)*.

Most of these sources come from the Redux world, where a store is the usual container for shared state. Angular already has component classes and services for that, so the same mistakes look different there. The Redux docs themselves now make RTK Query the default for data fetching ([tutorial](https://redux.js.org/tutorials/essentials/part-7-rtk-query-basics)).

## Criteria the library optimizes for

1. **Deterministic, trackable dataflows.** Derived data is described by pure pipes over other data, not by imperative updates. Every derived value has exactly one producer, so its origin is found by following references. The graph is the uniform structure: every piece of dataflow is an isolated wire (source, pipes, combine) exposed through the same handle (`value$`, `error$`, `pending$`, `reload`), which is meant to make it easy to read and track regardless of who wrote it (a design intent, not a measured result). The usual weakness of writable shared stores is that anyone can write, which makes the source of a value hard to establish. The claim about writers here has three steps:
   - **No tool can forbid it.** A side effect can be written anywhere the language allows: in any operator, in a subscription, in a `computed`, in a mutable closure. No library or approach prevents that, and this one does not try. The goal is less ambitious: make side effects as rare as possible by default, so that each one breaks the code style and is felt as a code smell. Writers exist at the sources you declare (a `Subject`, a form control or a signal feeding `input`), they are explicit, and their reach is as wide as the references to them.
   - **So the question is what the default path contains.** A value derived with a plain RxJS `pipe` or a `computed` signal has no write API either. The usual reason derived state acquires writers is exposing its status: loading and error flags mutated from `tap`, whether as fields, signals or Subjects (the first sample in section 1). In the author's experience this is common practice; a rough code search supports that it is widespread (see "Purity is the path of least resistance"). Among signals, `linkedSignal` is a derived value that is writable, and resources expose `set` / `update` (the current guide lists a `local` status for a value set that way).
   - **Here that reason disappears.** Pending, error and inactive are derived from the loader, so the status of a derived node has no writer either, and no code is written for it. In vanilla RxJS the same result is DIY: a `withState`-style operator you write, test and maintain. This is the DIY versus first-class line used throughout, and "first-class" means provided, not enforced.

   This is a design argument about defaults, not a measurement and not a guarantee; see "Purity is the path of least resistance" for what it rests on and what would count as evidence. The aim is to help keep **business logic** free of side effects and mutation, which makes it more predictable and reliable. The library does not claim to be side-effect free itself: some effects are unavoidable (it keeps a cache and, by default, logs unhandled errors to the console).
2. **Streams are combined in many ways.** Some sources are shared app-wide (a root token or service), some combinations live in a feature service or another token, and a component can collect any of them in any combination without anyone declaring the combination in advance.
3. **Graceful degradation in complex dataflow.** Any endpoint can fail, and in a graph of derived and combined data the failure has to stay where it happened: it blocks only its descendants, it says which source failed, and the graph has a path back. Handling loading and error for one request is simple in every approach and is not counted here.
4. **Business logic stays visible.** Handling the above should not bury logic under boilerplate. In particular, the state of the whole graph (pending, error, inactive) and the ability to recover it come out of the box at every derived node, with no code written per layer. Other approaches can reach the same result, but only by writing and maintaining that plumbing; see "Recoverability of derived graphs".
5. **Low resistance to highly modular, atomic code.** Making a small, single-purpose unit of data (one source, one transformation, one combination) should be cheaper than adding it to something big. A unit is declared in one place, has the same handle as every other unit, and joins the graph by reference, so splitting, moving or reusing it does not require touching a central registry.

## Criteria it does not optimize for

These matter in real projects and are where other options win or where `statefulObservable` has nothing to offer:

- **Shared mutable state.** Many places updating one piece of state, patching cached data in place (optimistic UI is still possible as an overlay; see "No write path, by design"). This is excluded on purpose. The project's stated reason (readme, "How is this different from a global state manager") is that global state couples an application tightly, which makes it fragile and hard to debug, and makes it difficult to trace where a piece of data comes from. Its alternative is atomic, feature-specific states, kept granular and co-located, so the source of any value is known. That is a position and not a measured result (see "The author's perspective"). If your problem needs shared mutable state, this library is the wrong tool and a store or signals are right.
- **Composing events.** Deriving actions or side effects from one event or a set of events ("something happened", with or without a payload): debouncing, merging several streams, sequences and time windows. This is plain RxJS territory; `statefulObservable` is about state derived from data, not about events. Events can feed it as inputs, and it does not get in the way.
- **Runtime inspection.** Devtools, time travel and an audit log of what happened are not part of the package, and this is a decision, not an oversight. A prototype worked: an RxJS operator that sent each emission to the Redux DevTools extension as an action. It was not shipped. The author's reasoning, which I did not verify, is that a proper integration does not belong in a platform-agnostic core: it has to be wired in at compile time, so it would take a separate package for each framework (Angular, Vue, React and so on), and each of them has to be on in development builds and absent from production, which needs deep integration with that framework's build tools. Needing the browser extension is the smallest part of the problem. In the meantime what exists is structure, not runtime: a static diagram of the dataflow (see "Dataflow as a diagram"), and the `name`, `meta` and `log` options that a future integration would attach to.

Maturity and ecosystem matter in practice too, but they are not design criteria: they are not something the library is shaped for or against. They are stated as facts in the table and in the problems list.

## The running example

A client page that:

- loads a client when `clientId` changes,
- loads the client's bucket for the same id,
- shows a bucket enriched with a product catalog (the catalog is a shared, app-wide source; the client and bucket belong to the component),
- shows a spinner while loading and an error if something fails,
- keeps the previous content on screen while new data loads,
- recovers when the user picks another id after a failure.

The samples show the bucket and the catalog, which is where the approaches differ. The client is a single request on the same id; it appears only in the `statefulObservable` sample (and in its diagram), and in the other approaches it would be one more `withState`, resource or store method without new problems. Recovering on a new id after a failure is single-request error handling, which every approach here does (criterion 3), so it is not shown separately.

## 1. Vanilla RxJS

**The main point of this chapter.** At first glance the problem looks solvable with a few operators and utilities, and a first version takes minutes. The rabbit hole is deep, though: a reliable solution takes a deep understanding of RxJS. The sections below show where it goes down, most traps measured on running code and one (operators on wrapped values) taken from the ADR's analysis: a missing `shareReplay` that turns every extra subscription into another request, emissions that multiply and the equality that is needed to filter them, operators that have to know about wrapped values, combination rules that must be chosen and applied the same way everywhere, recovery that has to be wired by hand, and lifetimes that cannot be reset from outside.

RxJS has no concept of loading or error as data: an `Observable<T>` carries values, and an error terminates it. Everything else is built by you. A naive attempt uses side-effect subjects:

```typescript
const loading$ = new BehaviorSubject(false);
const error$ = new BehaviorSubject<unknown>(null);

const client$ = clientId$.pipe(
  tap(() => { loading$.next(true); error$.next(null); }),
  switchMap((id) =>
    this.api.getClient(id).pipe(
      catchError((e) => { error$.next(e); return EMPTY; }),
    ),
  ),
  tap(() => loading$.next(false)),
  shareReplay({ bufferSize: 1, refCount: true }),
);
```

This works for the happy path, but it is a poor baseline: the flags are mutated from several places, and a failure path that forgets to reset `loading$` leaves the spinner on. **A competent RxJS developer would not write it this way.** The stronger vanilla version writes the state machine once as an operator:

```typescript
type State<T> = { loading: boolean; value?: T; error?: unknown };

const withState =
  <I, O>(load: (input: I) => Observable<O>) =>
  (input$: Observable<I>): Observable<State<O>> => {
    const initial: State<O> = { loading: false };
    return input$.pipe(
      switchMap((input) =>
        load(input).pipe(
          map((value) => (): State<O> => ({ loading: false, value })),
          catchError((error) => of((s: State<O>): State<O> => ({ ...s, loading: false, error }))),
          startWith((s: State<O>): State<O> => ({ ...s, loading: true, error: undefined })),
        ),
      ),
      scan((state, update) => update(state), initial),
    );
  };
```

That is a dozen lines, keeps the previous value while loading, survives errors, and has no external mutation. For a single stream it is a legitimate answer, and it is fully under your control.

**A note on the `startWith` line, a tradeoff.** It copies the previous state with `loading: true`, which keeps the last value on screen and avoids wiping the UI. The price is that every request emits a new state object when it starts and another when it ends, so subscribers receive additional events and potentially re-render. Measured with two sequential requests: the operator emitted four states, a subscriber mapping them to the value received four values, and the previous value was re-emitted, with the same reference, when the next request began. `distinctUntilChanged` can remove the repeats, with nuances. On the extracted value of a single stream a reference comparison is enough, since the same object comes back. On a combined value it is not: the projection rebuilds the object on every emission, so equal results pass as new ones (in a run with a combination, a reference-based `distinctUntilChanged` passed three defined values for two distinct results). On the state wrapper itself every emission is a new object by construction. Those cases need a deep or custom comparator, which has its own cost and pitfalls, and it is one more thing to remember at every consumer. `statefulObservable` keeps value, pending and error as separate streams, so in the same run `value$` emitted twice.

### The running example in vanilla RxJS

The operator above is the easy case: one stream. The running example also has a **combination** (the bucket with the product catalog) and **shared data held in a service** (the catalog). Here is what that takes with the same `withState`. This code type-checks under `strict` and was run.

```typescript
// a combination of two states: another helper you write
const combineStates = <A, B, R>(
  a$: Observable<State<A>>,
  b$: Observable<State<B>>,
  project: (a: A, b: B) => R,
): Observable<State<R>> =>
  combineLatest([a$, b$]).pipe(
    map(([a, b]): State<R> => {
      const error = a.error ?? b.error;
      return {
        loading: a.loading || b.loading,
        error,
        value:
          !error && a.value !== undefined && b.value !== undefined
            ? project(a.value, b.value)
            : undefined,
      };
    }),
  );

// shared data in a service
@Injectable({ providedIn: "root" })
export class CatalogService {
  private readonly api = inject(ProductsApi);
  private readonly reload$ = new BehaviorSubject<void>(undefined);

  readonly products$ = this.reload$.pipe(
    withState(() => this.api.allProducts$()),
    shareReplay({ bufferSize: 1, refCount: true }), // a lifetime decision
  );

  reload() { this.reload$.next(); }
}

// the component
export class BucketPage {
  private readonly api = inject(BucketApi);
  private readonly catalog = inject(CatalogService);
  private readonly reloadBucket$ = new BehaviorSubject<void>(undefined);
  readonly clientId$ = new BehaviorSubject(1);

  readonly bucket$ = combineLatest([this.clientId$, this.reloadBucket$]).pipe(
    map(([id]) => id),
    withState((id: number) => this.api.getBucket(id)),
  );

  readonly populatedBucket$ = combineStates(
    this.bucket$,
    this.catalog.products$,
    (bucket, products) => prepareBucket(bucket, products),
  );

  // the recovery of the derived handle, composed by hand
  reloadPopulatedBucket() {
    this.reloadBucket$.next();
    this.catalog.reload();
  }
}
```

Run with a failing catalog and then a reload, the combined state went through: loading, then **loading and error at once** (the catalog failed while the bucket was still loading), then error alone, and after `reloadPopulatedBucket()` loading again and finally the value. Both sources were requested again.

What you wrote beyond the single-stream operator:

- **The combining helper.** It works for two sources. For N sources of different types you need variadic tuple typing (RxJS's own `combineLatest` does it with mapped tuple types), which is doable but is more type-level code to write and test.
- **The rules.** The helper emits `loading` and `error` together. That is a property of this minimal helper and a competent version would fix it in a line (for example, suppress `error` while anything loads); the point is that someone has to choose a rule, test it and apply it the same way in every combination. The combined `error` is the first one found, so this helper does not say which source failed; returning a tuple of errors would, at the cost of more types.
- **The recovery plumbing.** A reload subject per source and a method that composes them. The template has to call that method, and adding a source to the combination means remembering to update it.
- **The sharing decision.** `refCount: true` releases the catalog when nobody reads it; `false` keeps it for the life of the application, including across a logout (see [QoL](./QoL.md), "Active and inactive state").
- **What it still does not carry:** error types per source, or an inactive state across the graph.

None of this is hard, and all of it can be written once per team. The point is that it is written, tested and kept consistent by you, and that the work grows with the graph.

### What the two helpers do not cover

`withState` and `combineStates` are the kernel, not the library. For one page with two sources they are enough, and then there is little reason to adopt anything. The rest of `statefulObservable` is what the example leaves out, and each item below is something a graph tends to need as it grows:

- **Dependent steps.** A second request that depends on the first is the chain problem described under "Problems" in the evaluation below: without help, every operator after the wrapper has to know about the state. `pipeValue` and `pipeError` apply ordinary operators to the value or to the error and pass the state through, and they take higher-order operators too.
- **N sources, typed.** `combineStatefulObservables` takes any number of sources, keeps the value types as a tuple, and reports errors as a tuple with one entry per source, so the failed source is named. The helper above does two, and says only that something failed.
- **Fixed combination rules.** Priority is inactive, then pending, then error, then value, applied the same way at every combination. In the example the helper reported `loading` and `error` together.
- **Recovery of any handle.** One `reload()` reaches every source behind a derived node; `reload({ onlyFailed: true })` reaches only the failed ones, and `reload({ where })` only the ones whose name or meta matches. `onlyFailed` needs each source's latest state at reload time, tracked without keeping the sources alive, which is its own piece of code and its own tests.
- **Taking user data out.** `active` cancels in-flight work, signals inactive along every edge and clears the result cache. `shareReplay` has no reset signal, so in plain RxJS clearing its buffer from outside means restructuring the stream (for example recreating it on a reset trigger), which is code you write (see [QoL](./QoL.md), "Active and inactive state").
- **Caching and addressing by key.** A result cache with least-recently-used eviction, and a factory with one stream per key, deduplicated across consumers, bounded and resettable.
- **Dynamic wiring.** A connection that is declared first and connected to a source later, with the inactive state in between.
- **Diagnostics and interop.** Node names and positions in error messages, a warning when nobody listens to `error$`, serializable events, and acceptance anywhere an Observable is expected.
- **A test suite** for all of the above.

So the two helpers are **the entrance to the hole**, not a way around it. Even for one page, the traps above (re-emissions and equality, wrapped values in higher-order operators, combination rules, lifetimes) take real RxJS understanding to get right. The library is what the helpers become once those answers have been found, written, tested and maintained in one place. Whether to write that yourself is the build-versus-adopt question, and the project's own history is one data point: it started as an operator like `withState` and became a library as these needs appeared (see the [ADR](./adr.md)).

### Evaluation

**Features**

- **Cold and lazy.** A declaration does nothing until something subscribes. `@if` plus an async pipe starts the request on expand and stops it on collapse.
- **Keeps the old value by default.** A plain `switchMap` emits nothing when a new request starts, so a rendered value stays. Wiping appears only if someone adds it (`startWith(null)`) or implements a state operator wrongly.
- **Cancellation and retry are operators.** `switchMap` stops a stale response from overriding a newer one, and `retry({ count, delay })` gives backoff.
- **Composing events is what it is for.** Deriving actions or side effects from one event or a set of events (debounce, merge, sequences, time windows, "A then B within N seconds") is the native use of RxJS, and nothing else in this comparison does it better.
- **Maturity and control.** It is the foundation of everything else here, has no extra dependency, and is the right tool for sockets, polling and multi-step orchestration.

**Problems**

- **Chains: higher-order operators on wrapped values.** The moment a value is wrapped in a state, every operator after the wrapper has to know about it. A plain `map` needs bypass branches (`if (isLoading(x)) return x`). Higher-order operators are worse: in a `mergeMap` the loading and error markers have to be passed through as observables of their own, and a `concatMap` in that place behaves incorrectly (this is the ADR's analysis, written by the library's author; I did not re-run it. See "Why not use a single pipe to rule them all?" in [Chaining and pure RxJS interoperability](./adr.md#chaining-and-pure-rxjs-interoperability)). The other way out is to wrap each dependent step in its own state and merge the states by hand. Either way, a second request that depends on the first (`switchMap` to the next call) is where the state starts leaking into every operator.
- **Cold by default: a missing `shareReplay` multiplies requests.** Every subscription runs the whole pipeline again, so a stream bound in a template with several async pipes (the value, the pending flag, the error) sends one request for each. Measured with the operator above: three subscriptions made three requests, and one request with `shareReplay`. Adding it is easy to forget and then brings its own decisions: the lifetime (`refCount`) and the fact that `shareReplay` itself has no reset, which matters at logout (see [QoL](./QoL.md), "Active and inactive state"). `statefulObservable` shares by default: its `value$`, `pending$` and `error$` together made one request in the same kind of run.
- **A failure is not data.** The error channel ends the stream and is untyped (`unknown` or `any`). Turning loading and error into states, keeping the stream alive and typing the errors are all yours; the `withState` operator above writes it once for one stream.
- **A complex dataflow does not degrade gracefully by itself.** An error in one branch of a `combineLatest` ends the combined stream and every consumer below it. Keeping the failure local, carrying pending, error and inactive across each edge, naming which source failed and recovering a subtree are all written per edge, and the work grows with the graph.
- **Combining statuses** ("pending if any is pending", "which error wins", typed per-source errors) is hand-written. Each team writes it, usually slightly differently.
- **No shared shape.** Each unit invents its own state shape, so units do not plug together without adapters, which raises the cost of adding and of reusing a small unit. There is no uniform structure, the origin of a value depends on discipline, and there are no runtime devtools.
- **Caching, reload and time-based policies are DIY**, including the key-based result cache and recovering a derived handle layer by layer.
- **Convention.** The operator above is the same idea as `statefulObservable`. Writing it yourself is a build-versus-adopt decision, not a technical limitation of RxJS.

**Pick this when** your cases are few or unusual (websockets, polling with backoff, multi-step orchestration), you want zero dependencies, or your team already has its own state operator.

## 2. statefulObservable

The same scenario, in three layers. Each layer is a stateful observable, so layers compose without ceremony.

**Shared source** — an app-wide token. Errors are narrowed, typed and reported once, at the source:

```typescript
export const allProductsToken = new InjectionToken("allProducts", {
  providedIn: "root",
  factory: () => {
    const api = inject(ProductsApiService);
    return statefulObservable({
      loader: () => api.allProducts$(),
      name: "allProducts",
      refCount: false, // app-lifetime data: keep it without subscribers
    }).pipeError(trackError("products"));
  },
});
```

`trackError` stands for a custom RxJS operator that you write once; it is not part of the library. It narrows the error with type guards into a typed union, reports it (for example to Sentry) tagged with the name of the source, and passes the typed error on. The node's stream is shared, so the report runs once per error event at that node, not once per consumer.

**Component** — picks whatever it needs, in any combination:

```typescript
private readonly clientId$ = statefulObservable(toObservable(this.clientId));
private readonly allProducts$ = inject(allProductsToken);

public readonly client$ = this.clientId$
  .pipeValue(switchMap((id) => this.clientsApi.getClient$(id)))
  .pipeError(trackError("client"));

private readonly bucket$ = this.clientId$
  .pipeValue(switchMap((id) => this.bucketApi.getClientBucket$(id)))
  .pipeError(trackError("bucket"));

public readonly populatedBucket$ = combineStatefulObservables(
  [this.bucket$, this.allProducts$],
  ([bucket, products]) => prepareBucket(bucket, products),
);
```

**Template** — one generic block per stream:

```html
<app-stateful-block [stream]="populatedBucket$">
  @if (populatedBucket$ | async; as bucketData) {
    <app-client-bucket [bucket]="bucketData"></app-client-bucket>
  }
</app-stateful-block>
```

A feature service can expose its own combinations as well (for example a factory cache of per-id streams combined with `combineStatefulObservables`), and a component can combine those with its own streams and root tokens. See [recipes](./recipes.md).

### Evaluation: features (checked against source and tests, except where marked as a design argument)

- **Graceful degradation in a complex dataflow.** Pending, error and inactive are states that travel along every edge (pipes and combinations), so a failure blocks only its descendants and every other leaf still renders. A combined node says which source failed (typed per source), one `reload()` recovers the subtree behind a handle (`onlyFailed` or `where` narrow it), and `active` takes user-bound data and everything derived from it out together. By design a combination means "needs all of these", so data that is merely nice to have belongs in its own leaf.
- `value$`, `pending$` and `error$` are derived from one cached raw stream, so a new `pending` event does not clear the previous value.
- Errors in pipes are caught per node and re-emitted as error events. The stream keeps running and handles the next input.
- Operators in a pipe run as one pipeline, so stateful operators (`scan`, `distinctUntilChanged`) work as in plain RxJS, while an error thrown inside becomes an error event and later values are still processed. A result that arrives after a newer loading or error event is dropped, so an outdated response does not overwrite a newer state.
- `combineStatefulObservables` is typed: values are a tuple, errors are a tuple of `false | E` per source.
- Cached raw streams use `shareReplay` with `refCount` by default, so a stream is lazy and releases its source when nobody is subscribed. For a collapsed-section UI this means no extra code: with the stream consumed under an `@if` (an async pipe, or a stateful block that subscribes), the request starts when the section is first expanded and is released when it collapses. Expanding again repeats the request unless it is served by a `cacheKey` cache or a shared stream.
- It implements `InteropObservable`, so the async pipe, `toSignal`, `firstValueFrom` and similar accept it. Interop is meant to deliver data directly to a consumer, without the state information. An error event reaches that consumer's `error` callback, and the stream keeps going: a later value is delivered after it (checked with a probe and in `src/subscribable.ts`). That is outside the usual Observable contract on purpose: the library treats a stream that stops on the first error as a design gap of vanilla RxJS (see the [ADR](./adr.md#error-events-in-subscribe-and-interop)). Passing the stream into RxJS operators (`combineLatest([from(stream)])`) is possible but not what interop is for, and there the first error ends the consumer's stream as usual. To combine, use `combineStatefulObservables`; to show states, use `value$`, `pending$` and `error$`.
- **Purity is the path of least resistance.** A side effect can be written anywhere the language allows (in any operator, in a subscription, in a `computed`, in a mutable closure), and no library in this comparison can forbid it; reducers, selectors, `computed` and pipes are all caught by code review, not by the compiler. The goal is less ambitious than prevention: make side effects rare, so that each one violates the code style and is felt as a smell. The difference is what the structure steers you towards. Here there is no write API and no designated place for side effects, so the natural way to get a result is to derive it with a pure pipe, and a side effect inside a pipe stands out in review. The intent is that most needs are met without side effects or mutation, so a violation is a visible exception, not routine. Plain RxJS pipes can be as pure, since the library is built on them; what is added is the state handle, which removes the usual reason for mutating status flags (criterion 1 has the full argument). This is a design argument; it is not measured, and it depends on reviewers actually treating such code as a smell. What would count as evidence: (a) prevalence: a GitHub code search the author ran for `tap(() => this.loading` returned about 12 thousand files (a screenshot, undated; I could not run GitHub code search myself). It shows the pattern is widespread, not a rate: there is no denominator, files are counted and not projects, and copies, boilerplates and documentation files are among the hits. (b) writable members, since `angular-mermaider` classifies members as reactive, writable or mutable, by counting them in comparable components written both ways, which has not been done. Both are weak: (a) shows the quick pattern exists, not how common it is relative to alternatives and not that the library path is easier, and (b) uses a tool by the library's author. Legitimate effects still have places to live. Error reporting fits naturally in `pipeError` at the source, as above. Other effects (navigation after success, analytics) go in a `tap` or a `subscribe` at the edge; there is no dedicated construct like an NgRx effect, so such a `tap` is a conscious, visible choice.
- **Small units are cheap to create, move and combine.** A new data unit is one declaration (`statefulObservable(...)` or a pipe on an existing node). It has the standard handle, so anything that consumes a stateful observable accepts it without adapters, and it can live in a component, a service or a token and be moved between them by moving a value. Adding a source to an existing combination is a change to one array. There is no central place (action list, reducer, store config) to update when a unit is added or removed. This is a design argument, like the purity one: it is not measured, and it depends on the team actually choosing to cut code into small units.
- **Key-based caching.** `cacheKey` plus `cacheSize` caches successful results per key with LRU behaviour (errors are not cached, so a retry actually refetches). `statefulObservableFactory` goes one level up: it caches one stream per key, with `reset(force)` to drop entries (by default only those with no subscribers) and `reload()` to refetch every cached entry.
- **Recovery composes with the dataflow.** Every derived node carries a `reload()`: pipes reuse their parent's, and a combined node calls `reload()` on all its sources (or only on the failed or matching ones). In a graph with several layers of combinations, whatever handle a component finally receives can recover the whole subtree behind it, and the component does not need to know the sources, their keys or their layers. See "Recoverability of derived graphs" below.
- **Caching strategies compose with RxJS.** Inputs and loaders are plain `ObservableInput`s and `reload()` is a function, so a policy is an operator or an event source, not a feature request. Two seams were verified against the current code:
  - *Loader level.* Wrapping the loader's observable in a time-limited share (`share({ connector: () => new ReplaySubject(1), resetOnComplete: () => timer(ttl) })`) gave one request for inputs inside the window and a fresh request after it.
  - *Driving `reload()`.* `interval(...)`, a window-focus event or a websocket message calling `reload()` refetched on each tick. Retry with backoff is the same idea: `retry({ count, delay })` inside the loader.

  When composing a policy, keep in mind:
  - *A repeated key is a cache hit.* Re-emitting an input with the same `cacheKey` serves the cached result, as intended. To force a request, call `reload()` or use a different key.
  - *For a TTL, use `share` with `resetOnComplete`* (as above), not `shareReplay({ windowTime })`: `windowTime` limits how long values are replayed but does not resubscribe after the source completes.
  - *Caching operators work in `.pipe(...)` too.* The node stays connected for as long as the operators hold on to it, so a `share` with a reset delay or a `shareReplay(1)` there decides the lifetime, and a returning subscriber gets the latest state.
  
  What is missing is a packaged, tested policy layer: you write and test these yourself, which is the build-versus-adopt trade again.

### Recoverability of derived graphs

Imagine several layers: shared tokens, a feature service that combines some of them, a component that combines the result with its own streams, and a template that gets one final handle. The user sees an error and presses "retry" on that handle.

```typescript
// the template only knows this one handle
public readonly populatedBucket$ = combineStatefulObservables(
  [this.bucket$, this.allProducts$],   // bucket$ derives from clientId$, allProducts$ is a root token
  ([bucket, products]) => prepareBucket(bucket, products),
);
```

```html
<!-- wherever the error UI lives, the retry button calls: -->
<button (click)="populatedBucket$.reload()">Retry</button>
```

`reload()` on that handle reloads `bucket$` and `allProducts$`, and anything either of them is itself combined from. Adding another source to the combination later changes nothing in the template. To recover only part of it, the same handle takes a filter, for example `populatedBucket$.reload({ where: ({ name }) => name === "allProducts" })`, given that the token names its stream.

Other approaches can do this too. The difference is that recovery is a convention you write and maintain, not a property of the structure:

| Approach | What recovery of a derived handle takes |
| --- | --- |
| Plain RxJS | Return `{ data$, reload }` pairs from every layer and compose the `reload` functions by hand at each combine |
| Signals / resources | Each resource has its own `reload()`; a `computed` over several resources has none, so you build a helper that carries a recover function with the derived value |
| TanStack Query | Recover by key (`invalidateQueries`/`refetchQueries`), which requires the caller to know the keys behind the derived data, or return a combined `refetch` yourself from the combine step. As I read the `injectQueries` reference, the combined result contains only what your `combine` function returns, so a combined `refetch` is yours to add; verify on your version |
| NgRx SignalStore | Call the load method of each store the screen depends on; the caller must know which stores are involved |

None of these is hard in isolation. The cost is boilerplate: it must be written for every derived handle, kept in sync when sources are added, and be agreed on by the whole team. This is criterion 4 applied to the graph: here the graph's meta states (pending, error, inactive) and its recovery are part of every node, and no code is written per layer to get them.

Limits of this to be aware of:

- **Plain `reload()` refetches everything behind the handle, healthy sources included.** Its options narrow it, and they compose:
  - `{ onlyFailed: true }` reloads only sources whose latest state is an error, recursing through nested combinations. The node knows its sources' state only while it is subscribed; without that it falls back to reloading everything.
  - `{ where }` reloads the part whose `name` or `meta` matches, so a retry button can recover just the catalog without a reference to it. It works only for sources that were named or tagged: unnamed nodes are all `"unnamed"`.
  - `{ path: [0, 1] }` addresses a source by position, the same positions as in the nested `error$` tuple, so a per-source error view can retry exactly the failed source. A hard-coded path depends on the order of sources.
- **No time-based policy** is attached to it; `reload()` is an explicit user action or a call you make (a timer or event can make it, see "Caching strategies compose with RxJS").
- **A multi-source reload can emit a stale mix when a source settles synchronously.** Sources are reloaded one after another. With asynchronous loaders (requests) every source is pending before any answers, so the loading state clears the old value and `value$` gets only the new result *(ran)*. A source that settles synchronously (a loader returning `of(...)`) answers before the next source has been reloaded, so the combination briefly emits the new value of one source with the old value of another (*ran*: `1103` = new `a` + old `b`, before the correct `1104`). The final state is correct, and `distinctUntilChanged` does not help, because the stale mix is a different value. Accepted for now, since real data sources are asynchronous (see the [ADR](./adr.md#stale-mix-after-reloading-a-combination-of-synchronous-sources)).
- **Multi-layer recovery is covered by tests** (`tests/reloadGraph.spec.ts`): a two-layer combine with a failing source recovers with one `reload()` on the final handle, a pipe-only chain reaches its root, and a source that keeps failing emits its error again without killing the stream. These tests use loaders that return observables. A loader or `cacheKey` that throws synchronously is reported as an error event for that input and the stream handles the next one (`tests/syncThrow.spec.ts`).

### Dataflow as a diagram

Because the graph is made of pure wires (no writers on derived nodes, no mutation), where a value comes from can be read off the code, and that makes it automatable. [angular-mermaider](https://github.com/earthdmitriy/angular-mermaider) is a static analyser that does this for Angular components: it reads the component source and template, without running the app, and writes a Mermaid diagram of how data flows from injected sources and inputs, through the streams, to the template. Its README states the premise directly: it targets purely reactive dataflows and assumes components avoid in-place mutation and side effects.

For the component used as the running example above, its output reduces to this graph (simplified from the generated file; the tool also draws sources, processing and consumers as groups, marks reactive, writable and mutable members, and counts template reads):

```mermaid
graph LR
  clientId --> clientId$
  clientId$ --> client$
  clientsApi --> client$
  clientId$ --> bucket$
  bucketApi --> bucket$
  bucket$ --> populatedBucket$
  allProducts$ --> populatedBucket$
  client$ --> template
  populatedBucket$ --> template
```

What the library contributes, and what it does not:

- **The property comes from the model.** In the author's view (a reasoned position, not tested), without a pure graph (no writers on derived nodes, no mutation) collecting a reliable, deterministic map of the dataflow is expensive at the least: with shared mutable state the question "who can write this?" has no cheap answer. `statefulObservable` encourages a pure graph and, as a design argument, makes it the path of least resistance, which is what the tool relies on. Plain RxJS derived streams and `computed` signals are as pure as this wherever they are written that way; I did not compare how well the tool or others would analyse them.
- **It is a structure view, for any tool.** A static diagram answers "what feeds what". It does not show live events or state, so it complements runtime devtools and does not replace them.
- **Some wiring is runtime by nature, for any static analysis.** A diagram can show that a `statefulConnection` slot exists, but not which source `connect(...)` will receive. The same goes for a stream picked by a runtime key from a factory or a hand-written map, and for providers overridden at runtime or in tests. Such places appear as boundary nodes, not resolved edges.

About the tool, `angular-mermaider` (these are limits of that separate tool today, not of the library):

- **Scope is one Angular component at a time.** An injected token such as `allProducts$` appears as a source node. Following it into the token or service that defines it is not built into the tool yet; its README lists cross-file analysis as a future idea. The model does not stand in the way: a token with a `factory` or a service field is declared once and has no other writers, so its sources can be resolved statically *(reasoned)*.
- **It relies on the premise holding.** Detection is by member type, and its README warns that mixing imperative mutation with reactive pipelines gives incomplete or misleading results. The more purely the code is written, the more the diagram can be trusted.
- **It is young and written by the same author** (version 0.3.0 at the time of writing), so treat it as evidence that the structure can be analysed, not as a mature tool.
- **I did not evaluate static tooling for the other approaches.** This section argues that purity makes analysis cheap, not that other styles cannot be analysed. Other restricted styles give maps too (an action protocol such as NgRx's is statically listable *(reasoned)*), and runtime tracing gives an observed map of what happened, not a complete map of what can happen.

### Evaluation: problems

- **Not an event layer.** It does not compose events or derive side effects from sets of events over time; use RxJS for that. They combine: an event stream can be an `input`, and a side effect belongs at the edge (a `subscribe` or a deliberate `tap`).
- **Maturity and bus factor.** Version 0.7.0, one maintainer, small user base. The API has changed between minor versions (for example `rename` became `with`, and the `log` callback now receives a different shape). Choosing it means accepting that risk, or being ready to vendor it.

  Two things offset this. It is not a new paradigm: it is a thin layer over RxJS, so the behaviour you rely on (`switchMap` cancellation, `shareReplay` caching, `catchError`, `combineLatest`) is RxJS's own and mature, and the package can be used alongside plain RxJS code. And the design is not a first attempt: it grew out of earlier iterations described in the [ADR](./adr.md) (a wrapping operator, then `tinyRxStore`) and out of the repetitive loading/error boilerplate of a large Angular application. Version 0.7.0 has a test suite of over 300 tests. Tests show the library does what it claims, not that it is free of bugs: writing this document found several defects, fixed in 0.7.0 (see the [changelist](./changelist.md)). I have no data on adoption or production use, so I do not claim any.
- **No write path, by design.** There is no way to set or patch a value from outside; a value changes only because an input event went through the loader. The documented way to "write" is to push an action into the input stream and let the loader perform it ([recipes](./recipes.md#putting-update-result-into-stream)). That is the price of the traceability described above. The consequences to know about: a save shows the same pending state as a fetch, cached data is never patched, and state that is not derived from a request (a draft, a selected tab) does not belong here.

  Optimistic UI is still possible, as a derived overlay instead of a write: while `pending$` is true and the last action is an update, show the submitted value on top of the data. Rollback is automatic because the data was never changed; if the update fails, the overlay is simply dropped and `error$` fires. A probe confirmed the idea, and one sharp edge: `value$` and `pending$` are separate subscriptions, so an overlay computed from both can briefly apply on top of the new server value before `pending$` clears (an increment showed 10, 11, **12**, 11). Overlays that set a value (idempotent) are not affected; for others, derive from a single stream such as `raw$` (not tested). Also pick the mapping operator deliberately: the default `switchMap` unsubscribes from an in-flight update when another action arrives, so for writes you probably want `concatMap`; and with a `cacheKey`, give update actions a key that cannot hit the cache.
- **No configurable time-based cache policy.** There is key-based caching and `reload()`. Stale-time, refetch on focus or interval and invalidation by partial key are not options you set (the factory resets or reloads everything it holds); you compose them (see "Caching strategies compose with RxJS" above). The internal key cache itself is not pluggable and has no expiry.
- **Stale data is a decision the library makes for you.** Keeping old content while the next load runs avoids layout jumps, but it also means the screen can show data belonging to the previous input (the old client while the id has already changed). The UI must reflect `pending$` clearly; if showing stale data is wrong for your domain, you need to hide it.
- **Combined state has a fixed priority:** inactive, then pending, then error, then value. A slow source in the middle of a reload hides another source's error until it settles. Several simultaneous errors arrive as an array with `false` for sources that did not fail.
- **Errors live in a separate channel.** This is the design, and the cost is discipline: if nobody subscribes to `error$`, the failure is invisible in the UI. The library logs to the console in that case, but only if the default logging is active: supplying your own `log` callback **replaces** that warning.
- **Lifetime in shared places is your decision.** A token created with `refCount: false` (as above) never releases its source after the first subscription, which is right for small, app-lifetime data; with the default `refCount: true` it is released when the last subscriber leaves and fetched again on the next one. The same lifetime can come from an operator in `.pipe(...)`: the node stays connected for as long as the operators hold on to it, so `.pipe(shareReplay(1))` keeps it and `share({ resetOnRefCountZero: () => timer(ms) })` keeps it for a grace period (`tests/pipeLifetime.spec.ts`). A hand-written per-id map in a service has no eviction unless you write one; `statefulObservableFactory` bounds entries with `cacheSize` and can drop unused ones with `reset(false)`.
- **Many small units have their own costs.** With no central registry the graph exists only as references in code. A static overview can be generated from it (see "Dataflow as a diagram"), but that is a structure view, not a runtime one. Each shared node needs a deliberate lifetime choice (`refCount`), and consistent naming (`name`, `meta`) is needed to make logs, error messages and `reload({ where })` work. Granularity is a team habit, not something the library enforces.
- **It needs RxJS fluency.** The library hides boilerplate, not the operator model. Someone who does not know `switchMap` vs `concatMap` will still struggle.
- **No runtime devtools.** Nothing shows live events or replays state; the static diagram shows structure only. Why there is no integration is explained under "Criteria it does not optimize for". The `log` callback receives each event with the node's name and position, which is where an integration would hook in (a reading of the code, not something the prototype used).

## 3. Angular signals and resources

Signals are the framework's native reactivity primitive, and `resource` / `rxResource` / `httpResource` are the async layer on top. Signals were introduced to give Angular a reactive primitive so that change detection can move off zone.js's global, top-down checks (see the [Signals RFC](https://github.com/angular/angular/discussions/49685)), and that is the purpose they serve well. In the author's view, trouble starts when they are used everywhere without regard to that purpose, and a synchronous primitive is a weak fit for managing async data in a complex application. They are not aimed at the same problem as the other three options: signals excel at synchronous derived state, and resources apply that model to async loading.

The same page with resources:

```typescript
public readonly clientId = input<number>();
public readonly showBucket = input<boolean>();

private readonly bucketResource = rxResource({
  params: this.clientId,
  stream: ({ params }) => this.bucketApi.getClientBucket$(params),
});

private readonly productsResource = rxResource({
  stream: () => this.productsApi.allProducts$(),
});

// Angular has no combined resource, so a hand-written helper merges them
public readonly populatedBucketResource = combineResources(
  [this.bucketResource, this.productsResource],
  ([bucket, products]) => bucket && products && prepareBucket(bucket, products),
);
```

```html
@if (showBucket()) {
  <div [class.loading]="populatedBucketResource.isLoading()">
    @if (populatedBucketResource.error()) { <app-generic-error /> }
    @if (populatedBucketResource.value(); as data) { <app-client-bucket [bucket]="data" /> }
  </div>
}
```

Two things to notice:

- **Everything starts immediately.** The bucket section is under `@if (showBucket())`, but both resources are fields, so as soon as the component exists and `clientId` has a value, the bucket and the products requests run, even when `showBucket()` is false and nothing ever reads `populatedBucketResource`.
- **The shared catalog cannot be moved out cleanly.** In the stateful version the product catalog is a root token that any component can inject, and its request starts only when something subscribes to it. A `productsResource` held in a root service would instead start its request when the service is first instantiated, whether or not the consumer that injected it needs the catalog at all. Moving the catalog into a service therefore would not change when the request runs.

`combineResources` above stands for a helper you write yourself, since Angular has no combined resource. It has to merge loading flags, errors and values, and decide how statuses combine (for example whether a reload of one source counts as loading for the whole). That is DIY.

### Evaluation: features

- First-party and no extra dependency. It is the direction the framework is moving, so documentation and developer familiarity can be expected to grow (an expectation, not a measurement).
- A simple mental model for local state. Reading a signal in a template is the cheapest and most readable form.
- For "load once in a component" it is hard to beat for brevity.
- Mutation is explicit and cheap: `set`/`update` on a writable signal or a resource's local value is exactly what you want for form state and optimistic edits.

- Stale responses are handled: the guide says a resource aborts an outstanding load when `params` change, and the loader has to pass `abortSignal` to whatever does the work for the work itself to be cancelled (`rxResource` unsubscribes from its stream). The in-flight request is also aborted when the owning context is destroyed *(source)*.
- `reload()` per resource, and `retry` inside the `stream` of an `rxResource` for backoff.
- It needs RxJS only partly (the `stream` of an `rxResource`), and it is Angular-bound.

### Evaluation: problems

First checked against the Angular 20 resource guide; the guide at angular.dev was read again in November 2026 (through a page-summarising fetch, so verify against the page) and the points that changed are marked:

- **A complex dataflow has no graceful path.** Each resource isolates its own failure, but a dependency graph of resources has no merged status, no way to say which source failed and no recovery across layers; that is the helper you write.
- **Not for composing events.** `effect()` is a hook for a side effect on non-reactive APIs, which is how the Angular guide describes it. Combining several events or working with time (debounce, windows, sequences) goes through RxJS interop, so it is RxJS you write.
- **No key-based result cache, and time-based staleness is DIY.** I did not assess Angular DevTools support for signals and resources, so the table does not rate it.
- **Adding a unit is one declaration, but combining it with others is hand-written.**
- **Changing params resets the value.** The `loading` status, which applies when `params` change, has `value()` equal to `undefined`; `reloading` (after `reload()`) keeps the previous value. The Angular source agrees *(source, main branch, November 2026)*: the previous stream is carried over only when the request object is identical, i.e. on `reload()`; `reload()` returns `false` without doing anything while the resource is idle or loading; and in the `error` status `value()` throws, so a consumer guards with `hasValue()` (after a `reload()` from an error it returns the default). So "keep old content while loading for the new id" is not what a plain resource does. The current guide documents a way to add it: every resource has a `snapshot` signal, and a `withPreviousValue` example wraps a resource in `linkedSignal` and `resourceFromSnapshots` to keep the prior value while loading; `resourceFromSnapshots` is flagged experimental *(docs; not run, and not checked with `rxResource`)*. It is code you add, not the default.
- **Combining is manual.** There is no combined resource that merges status. You write `computed` rules for loading and error, or a helper like `combineResources` above.
- **`error()` does not carry a source error type.** The guide calls it "the most recent error" and gives no type; whatever the API reference declares (not checked), no error type flows from the source.
- **Status may still be moving.** The Angular 20 guide flagged `resource` as experimental. The current guide shows no such flag for `resource`, `rxResource` or `httpResource`, but flags `resourceFromSnapshots` as experimental *(docs, read through a page-summarising fetch)*. Check the API reference for your version.
- **Synchronous reading has a cost for async data.** A signal must always have a current value, so every consumer handles `undefined` or a status check (and for a resource in the `error` status, a `hasValue()` guard, since `value()` throws), and the question "is this value current or stale?" has to be answered by the resource. Observables answer it by order of events in time.
- **Writability is a design choice you manage.** Resources expose `set`/`update` and `linkedSignal` is writable. You can encapsulate with `asReadonly()` or by exposing computed signals, but the primitives do not prevent writes by default. Whether that is a problem depends on your team's discipline.
- **Eager: declaring a resource starts the request.** In the Angular source, constructing a resource registers an effect that runs the loader as soon as `params` produces a value. Reading `value()` or `status()` does not start anything, and nothing defers the loader until a consumer exists. Creating the field, or injecting a service that holds one, is enough for a request to run (a catalog resource held in a service starts on first injection, even if the consumer never needs it). Laziness is possible but it is yours to build: return `undefined` from `params` while a gating signal is false (the resource stays `idle`, which the guide documents), or create the resource inside a component that is only rendered when needed. With observables it is the other way round: the declaration is cold and consumption starts it, so a collapsed section needs nothing (`@if` plus an async pipe starts the request on expand and unsubscribes on collapse). On destroy of the owning context a resource aborts its in-flight request.

Signals and `statefulObservable` combine well, and this is a layering more than a choice. A stateful observable is accepted wherever a subscribable is, `toSignal` included, so async data can be combined, recovered and kept consistent in stateful streams and then spread synchronously across presentational components as signals: `toSignal(stream)` for the value, or `toSignal(stream.pending$)` and `toSignal(stream.error$)` when a template needs the states. In the other direction, signals can feed `input` (`toObservable(this.clientId)` in the running example).

One caveat. `subscribe` with an object observer forwards every error event to that observer's `error` callback and keeps delivering later values (see the interop bullet in section 2). What Angular 21.1 does with that *(ran)*:

- `toSignal(stream)`: after an error event, reading the signal throws; after a later value, it returns that value again.
- `stream | async`: the error event reaches Angular's `ErrorHandler` and is also reported as an uncaught error; the view shows nothing, then renders the later value.

So both recover, but every failed load surfaces as an application error. Prefer `toSignal(stream.value$)` with `toSignal(stream.pending$)` and `toSignal(stream.error$)`, or a stateful block that subscribes to `error$`.

## 4. A store (NgRx SignalStore)

The store option is shown with `@ngrx/signals` (SignalStore), the current signal-based NgRx API. A SignalStore is a composition of features (state, computed values, methods, hooks). It is provided locally, on a component or route, where it lives and dies with that component, or at root, where it is one shared instance. Classic `@ngrx/store` (actions, reducers, effects, selectors) is still the option for designs built around a global action log; it is mentioned only where it differs.

What this section rests on: the SignalStore guide on ngrx.io (core concepts), which I read directly. Points taken from other sources are marked as secondary.

```typescript
type BucketState = { bucket: Bucket | null; error: ApiError | null; loading: boolean };

export const BucketStore = signalStore(
  withState<BucketState>({ bucket: null, error: null, loading: false }),
  withMethods((store, api = inject(BucketApi)) => ({
    load: rxMethod<number>(
      pipe(
        tap(() => patchState(store, { loading: true, error: null })),
        switchMap((id) =>
          api.getBucket(id).pipe(
            tapResponse({
              next: (bucket) => patchState(store, { bucket }),
              error: (error: ApiError) => patchState(store, { error }),
              finalize: () => patchState(store, { loading: false }),
            }),
          ),
        ),
      ),
    ),
  })),
);

// combining with another store: a computed over both, with the statuses merged by hand
withComputed((store, products = inject(ProductsStore)) => ({
  populatedBucket: computed(() => {
    const bucket = store.bucket();
    const items = products.items();
    return bucket && items ? prepareBucket(bucket, items) : null;
  }),
  populatedLoading: computed(() => store.loading() || products.loading()),
})),
```

Things to notice, all from the guide unless marked:

- **The loading flag and the error are state you declare and set.** The guide's own example keeps `isLoading` in the store state. I did not find a built-in request-status feature; community packages such as the NgRx Toolkit add extensions *(secondary)*.
- **Writes go through the store's own methods.** State is protected from outside modification by default and updated with `patchState`; opening it up is an explicit option (`protectedState: false`).
- **Async work is RxJS in `rxMethod`.** The guide recommends RxJS for complex async side effects, with `debounceTime`, `switchMap` and `tapResponse` in its example. Error handling has to sit inside the inner pipe, because a pipeline without it stops on the first failure and later calls are ignored *(secondary)*.

### Evaluation: features

- **A uniform shape.** A store is built from the same few features (state, computed values, methods, hooks), and features can be extracted and reused; the guide calls the design opinionated. That a uniform shape pays off in a large team or for onboarding is the common expectation, and I have no evidence for it here.
- **Local or global, by where it is provided.** A store provided on a component or route is tied to its lifecycle; a root store is one shared instance. It is not global by default.
- **Controlled writes.** With protected state, the writers of a store's state are its own methods, in one file. Many places can still trigger them, but they cannot patch the state directly.
- **Previous data is kept naturally.** `patchState(store, { loading: true })` leaves `bucket` untouched, so the old content stays. That is not a feature you have to add. As with the library, it also means the screen can show the previous id's data until the new load finishes.
- **Cancellation and retry in the usual place.** `switchMap` in `rxMethod` stops a stale response from overriding a newer one, a reload is a call to the method again, and `retry` goes in the pipe.
- **Optional event-driven style.** The Events plugin (`eventGroup`, `withReducer`, `withEventHandlers`) gives named events and reducers for designs that want an explicit transition model. It was introduced as experimental in v19.2, and the most recent material found still calls it experimental, with no official statement that it has stabilised *(secondary)*.
- **Ecosystem.** NgRx is a long-established part of the Angular ecosystem *(unverified)*, and a community toolkit adds extensions on top: `withDevtools()` for Redux DevTools and `withResource()` for Angular resources *(secondary)*.

### Evaluation: problems

- **Graceful degradation in a complex dataflow is DIY, inside store features.** Statuses are fields you set, so merging them across stores, naming which store failed and reloading the dependent stores are written per feature, as the `loading` computed above shows. Each `rxMethod` needs its own error handling in the inner pipe.
- **Not lazy by consumption.** Reading state never triggers a load: a request starts when a method is called or from a hook such as `onInit`, so nothing runs until you say so, but the trigger is imperative, and nothing starts or stops because a template does or does not read it. For a collapsed section you provide the store in the section's component, or call the method when it opens, and handle collapse yourself.
- **Errors are typed by annotation.** The callback of `tapResponse` can be annotated, as above, but nothing carries the type from the source, so narrowing is yours.
- **No key-based result cache, and no time-based staleness.** Both are written by hand.
- **Origin of a change is a convention, not a trace.** Writers are the store's methods, which is cheap to follow, but a runtime log of what happened needs the toolkit's devtools or the Events plugin *(secondary)*.
- **Optimistic updates and rollback are yours.** Patch the state before the request and undo it in the error branch.
- **Deriving effects from combinations of events is RxJS in `rxMethod`.** Debounce, merges, sequences and time windows are written with RxJS operators there (or in event handlers), so it is RxJS you write. In the author's experience a facade does not change that: events that are not state transitions are still handled with RxJS primitives.
- **Sharing is a decision.** A root store gives one shared instance but then holds its data as long as the application runs; a local one is released with its component, at the price of loading again. Cleanup of a root store's data is manual.

## Side by side

A short summary. The reasoning and caveats are in the **Evaluation** block of each approach above. Things that are the same everywhere are in the baseline note below the table. Rows marked "design argument" are the author's judgment and not findings. "Which call site dispatched it" is not a row: it needs opt-in tracing in a developer session (see "The author's perspective"). Library cells rest on its source and tests; competitor cells are mostly readings of documentation. "DIY" means the tool does not provide it: you implement, test and maintain it yourself. "First-class" means the tool provides it as designed behaviour and you write no code for it; it does not mean the tool enforces it.

| | Vanilla RxJS | statefulObservable | Signals / resources | NgRx SignalStore |
| --- | --- | --- | --- | --- |
| Graceful degradation in a complex dataflow | DIY, grows with the graph | First-class, "needs all" per combination | DIY | DIY, in store features |
| Recover a derived handle | DIY, per layer | First-class (`reload`, by failure or by name and meta) | DIY | DIY, call each store |
| Combining sources with statuses | DIY | First-class, fixed priority | DIY | DIY (`withComputed`) |
| Wipes rendered data on fetch | No | No | On params change; documented pattern keeps it | No |
| Lazy until consumed | Yes | Yes | No | No, loads on call or hook, not on read |
| Typed errors | Annotation only, unchecked | After `pipeError` | No error type from the source | Annotation only, unchecked |
| Writes / optimistic UI | DIY | None by design; overlay (DIY) | `set` / `update` | Store methods; optimistic DIY |
| Who can write a value | Derived `pipe`: nobody; status without writers is DIY (the quick version sets Subjects from `tap`, a common pattern, unmeasured) | First-class: sources only; derived values and their status have no write API | `computed`: nobody; `linkedSignal`, writable signals, resources: `set` / `update` | Store methods, callable by any code holding the store |
| Key-based result cache | DIY | First-class | DIY | DIY |
| Reload | DIY | `reload()` | `reload()` | Call the method again |
| Composing events (debounce, merges, sequences) | First-class | Not its job, use RxJS | Not its job, use RxJS | RxJS in `rxMethod` |
| Runtime devtools (what happened) | None built in | Prototype, not shipped | Not assessed | Via community toolkit (secondary) |
| Uniform structure (design argument) | No | Graph, one handle | Not assessed | Feature-based, opinionated |
| Cost of adding a small unit (design argument) | Adapters needed | One declaration | One declaration, combine by hand | One store or feature |
| Maturity | Very high | Package low, RxJS base | High; parts flagged experimental | High, SignalStore newer than the classic store |
| Needs RxJS knowledge | Yes | Yes | Partly | Partly (`rxMethod`) |
| Framework coupling | None | None | Angular | Angular |

**Baseline (the same in every approach, so not a row).** All of these rely on RxJS operators or on equivalent behaviour, and none of them separates the approaches:

- **Automatic retry with backoff.** `retry({ count, delay })` inside the loader, the `stream` of an `rxResource`, or the `rxMethod` pipe.
- **A stale response cannot override a newer one.** `switchMap` in the stream (plain RxJS, the pipes of `statefulObservable`, `rxMethod`); a resource aborts the in-flight load when its params change.
- **Time-based staleness and background refetch.** DIY everywhere: a TTL operator on the loader, or `reload()` called from a timer or an event. See "Caching strategies compose with RxJS".

## Alternatives not covered above

- **TanStack Query (Angular adapter).** *(unverified: general knowledge, not tested here.)* The closest relative in purpose: server-state caching with loading and error states, retries, stale-while-revalidate, query invalidation, mutations and devtools. It is promise-based and key-addressed rather than RxJS-composed, and its mutations are writes by design. If your main need is ready-made, configurable time-based policy or invalidation by key, it ships as options what you would compose and test yourself here. If your main need is composing many sources into derived, traceable streams, the composition model here (combine, per-node pipes, reload through the graph) is the difference.
- **Classic `@ngrx/store` with effects.** Actions, reducers, effects and selectors around a global action log. The comparison above largely carries over with more ceremony per feature; it is the option to look at when a global, replayable record of events is the requirement.
- **NgRx ComponentStore.** Lifecycle-bound state, closer in spirit to a component-owned stream *(unverified; not evaluated)*.
- **`httpResource`.** Angular's HTTP-specific resource, built on `resource`; I assume the same params-change behaviour and did not check it.

## Choosing

- **Request-shaped, derived state that is combined in many places**, with a team comfortable with RxJS: `statefulObservable` gives you the state machine, combining and per-node pipes without writing them. Accept that it is young, that writes are outside its scope, and that you give up runtime devtools.
- **You want time-based policy as configuration** (staleness windows, background refetch, invalidation by partial key, mutations) rather than composed operators: evaluate TanStack Query first.
- **Many writers, audit needs or a large team that needs uniform structure:** a store (SignalStore, or classic `@ngrx/store` when a global action log is the requirement). This is the common expectation and the author's view; this document has no evidence for it either way.
- **Data that should load only when it is shown** (collapsed panels, tabs, rarely opened sections): streams, vanilla or stateful. Consuming them under an `@if` starts and stops the request; with resources you gate it yourself.
- **Local, synchronous UI state, and simple one-shot loads:** signals and resources.
- **Presentation layer:** signals on top of stateful streams. Combine and recover async data with stateful observables, then spread it synchronously across presentational components with `toSignal` (see section 3).
- **Unusual flows (sockets, polling, orchestration), or you only have one or two cases:** plain RxJS, possibly with your own `withState` operator.
- **Events and effects composed over time** (debounce, merging several streams, "something happened" with or without a payload): plain RxJS, whatever else you use. The other approaches either defer to it or run it inside effects.

A heuristic for the store-or-streams question, offered as the author's rule of thumb and not tested, and preferred over judging by page size: **where is the complexity growing?** If it grows inside a unit (a filter that gains validation, URL synchronisation, debounce and normalisation), keeping it local with only a small public stream as the contract is cheap, and the parent never needs to know. If it grows between units (many independent participants that must react to each other's transitions), an explicit coordinating model gets more attractive. Even then, in the author's view, extracting an orchestrating service or a state machine for that one page comes before a global store. The trade-off underneath (a design argument, not a finding): a central model makes global reasoning cheap and local reasoning expensive (a small change means reading the whole model); composed units do the opposite.

These are not exclusive. A reasonable layering is shared read-mostly data in stateful tokens or services, state with many writers in a store, local UI state in signals (which also serve as the presentation layer over stateful streams), and the orchestration in plain RxJS.

## See also

- [Architecture Decision Records](./adr.md) — why the library is shaped this way, including why not an operator, resources or signals
- [Recipes](./recipes.md) — concrete usage patterns

## Corrections

The draft was challenged claim by claim, and some corrections favoured the library while others added limits the first draft missed. The log of what changed, with each original claim, is in [compare-corrections.md](./compare-corrections.md).
