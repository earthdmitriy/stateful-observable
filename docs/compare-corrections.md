# Comparing approaches: corrections log

This is the record of how [Comparing approaches to async state](./compare.md) changed while it was written and reviewed. It is kept apart from the article so that the article reads as a comparison; the article states the current position on every point below.

This log lists what the agent got wrong and what changed. Each entry gives the original claim, what the correction was, and where the text stands now. Minor wording changes (renamed labels, rephrased cells, clarified examples) are not listed; only corrections that changed a claim or its framing are.

Many of the corrections cluster around problems that are usually treated as unavoidable costs of an approach: who is allowed to write state and whether its origin can be traced, whether a failed derived value can be recovered cheaply, whether side effects creep into business logic, whether a dataflow can be seen as a whole, whether caching policy needs a framework. The agent's starting assumption was that these are open problems, and its first draft described the library's answers to them as gaps. They are design choices with consequences, and the corrections below record how the draft changed once they were pointed out and checked. Not all corrections favoured the library: some added limits that the first draft missed.

## Corrected by the library's author

1. **Global and shared state.**
   - *Initial claim:* a store is the right tool for "genuinely global state" (auth, cart, cross-cutting data); shared data was presented as a reason to pick NgRx.
   - *Correction:* shared app-wide data is handled with a root `InjectionToken` or service holding a stateful observable; feature services and components combine such sources in any combination without declaring the combination up front. This also became criterion 2.
   - *Now:* a store is recommended only for state with many writers, or for its conventions and devtools.

2. **"No write path" and "not pure" as weaknesses.**
   - *Initial claim:* the absence of a write path was a gap; that purity is only a convention enforced by code review, and that the library "is not side-effect free", were listed as weaknesses, as if specific to this library or as if the library claimed otherwise.
   - *Correction:* the missing write path is intentional. Writable shared stores make the origin of a value hard to establish because anyone can write to them. The differences are in defaults, not in what can be forbidden (criterion 1). The library does not claim to be side-effect free (some effects are unavoidable); the aim is to keep business logic free of them.
   - *Now:* stated as a design trade-off with its consequences, plus the "Purity is the path of least resistance" argument, marked as a design argument and not a measurement.

3. **Caching policy.**
   - *Initial claim:* "no cache policy": only `cacheKey`/`cacheSize` and `reload()`, no key-based caching to speak of; also that per-id stream caches grow without bound.
   - *Correction:* key-based caching exists (`cacheKey`, LRU `cacheSize`, and `statefulObservableFactory` with `reset` and `reload`). The unbounded cache was a hand-written map in the example application, not the library's factory.
   - *Now:* key-based caching listed as a strength; the factory is noted as `@experimental`.

4. **Time-based caching and retry.**
   - *Initial claim:* stale-time, background refetch and retry with backoff are "not provided"; TanStack Query does these and this library does not.
   - *Correction:* the library interoperates fully with RxJS, so any strategy can be composed with operators: wrap the loader in a time-limited share, drive `reload()` from a timer or event, put `retry({ count, delay })` in the loader.
   - *Now:* verified with throwaway probes (a TTL operator on the loader gave one request inside the window and a fresh one after it; a timer calling `reload()` refetched on each tick). Two pitfalls found while doing so are documented: re-emitting an input with the same cache key is served from the cache, and `shareReplay({ windowTime })` is not a TTL. What remains missing is a packaged, tested policy layer, and the doc says so.

5. **Recovery of a derived graph.**
   - *Initial claim:* `reload()` on combined streams was treated as one ordinary feature among others, and listed with "all-or-nothing" as its main caveat.
   - *Correction:* the point is that every derived node carries `reload()` and reaches its sources, so a component holding the final handle can recover the whole subtree, whereas the other approaches need that plumbing written and maintained per derived handle. Out of the box graph meta states and recovery is criterion 4.
   - *Now:* a dedicated section, a comparison table, and a multi-layer test (`tests/reloadGraph.spec.ts`).

6. **"Team structure" and "enforcement of code organisation".**
   - *Initial claim:* the library offers "light conventions" and lacks the enforced structure of a store; later, that it does not decide where files, tokens or services live.
   - *Correction:* the graph is the uniform structure: every piece of dataflow is an isolated wire exposed through the same handle. File layout belongs to the host framework, not to a framework-agnostic library.
   - *Now:* folded into criterion 1; the "Uniform structure" table row says so, and the bullet about code organisation was removed.

7. **"No central overview, no devtools to draw it."**
    - *Initial claim:* with no central registry the dataflow cannot be seen as a whole.
    - *Correction:* the accent was wrong. Without a pure graph, the author's position is that collecting a reliable, deterministic map of a dataflow is expensive at the least. `statefulObservable` encourages exactly that and makes it the path of least resistance, so the map can be extracted from the code by a tool. `angular-mermaider` already does this for a component and has been run on the running example. In the other approaches the same map needs DIY and discipline to keep the code analysable.
    - *Now:* the "Dataflow as a diagram" section is built on that premise. The limits of the tool and of any static view are listed there, kept apart by owner, and are not what the correction is about.

8. **Missing intent: modular, atomic code.**
    - *Initial claim:* the four intents given at the start were the whole yardstick.
    - *Correction:* a further intent is to reduce resistance for writing highly modular, atomic code.
    - *Now:* criterion 5, a strength, a table row, and a limit (no central registry, per-node lifetime decisions, granularity is a team habit).

9. **Signals as a presentation layer, not only an alternative.**
    - *Initial claim:* the "Choosing" section assigned signals and resources to "local, synchronous UI state and simple one-shot loads", as if signals were what you use instead of stateful observables for async data.
    - *Correction:* stateful observables interoperate with signals (`toSignal` accepts them), so async data can be combined and recovered in stateful streams and then spread synchronously across presentational components as signals.
    - *Now:* "Choosing" and section 3 describe it as a layering. One detail is left unverified there: what `toSignal(stream)` does on an error event.

10. **"Typed errors: Yes" for vanilla RxJS.**
    - *Initial claim:* the comparison table said vanilla RxJS has typed errors, and gave NgRx a plain "Yes, via action payloads".
    - *Correction:* an `Observable<T>` has no error type, so the error channel is `unknown` or `any`. Typed errors in vanilla RxJS are something you build by modelling errors as values. The same applies at the entry point of NgRx and of this library: both receive an untyped error and the type is established when it is converted.
    - *Now:* the row says so for all four. For this library, the type is tracked from `pipeError` onwards, including through `combineStatefulObservables`.

11. **"Optimistic updates: none".**
    - *Initial claim:* with no write path there is no optimistic update, and the UI shows the old value until the server answers.
    - *Correction:* optimistic UI can be implemented by listening to `pending$`: while a write is pending, show the submitted value as an overlay. The data is never patched, so rollback is just dropping the overlay.
    - *Now:* documented as a derived overlay, with the sharp edges found by a probe (an overlay computed from `value$` and `pending$` can briefly double-apply a non-idempotent change; the default `switchMap` can cancel an in-flight write) and a note that you write the overlay yourself.

12. **Wiping data on fetch in vanilla RxJS.**
    - *Initial claim:* the table said vanilla RxJS wipes rendered data "if you wrap each request and emit an empty state", which made wiping sound like a typical risk of plain RxJS.
    - *Correction:* a plain `switchMap` emits nothing when a new request starts, so the old value stays. Wiping appears only when someone writes it in (`startWith(null)`) or implements a state operator wrongly.
    - *Now:* the cell says "No by default" and lists those two ways it creeps in.

13. **Maturity framed one-sidedly.**
    - *Initial claim:* maturity was summed up as "Low (0.6.0)" with a one-maintainer bus-factor warning, which reads as if the approach itself were new and unproven.
    - *Correction:* `statefulObservable` is not a completely new solution. It is built on RxJS and intended to solve common problems of real-world applications; the package is young, the foundation is not.
    - *Now:* the table separates the package (low, 0.6.0, one maintainer) from its foundation (RxJS, very high; thin layer, not a new paradigm). The limits bullet adds that the design grew out of earlier iterations in the ADR and has a test suite of over 250 tests, while stating that there is no data on adoption or production use.

14. **Laziness versus eagerness was missing, and the resource claim was left unverified.**
    - *Initial claim:* the comparison had no row for laziness, and for resources it said only that the guide does not state when loading starts, with "in my experience" eager.
    - *Correction:* this is one of the author's reasons for not using signals for async data. A declared or injected resource means a running request, while with observables or `statefulObservable` a collapsed section is trivial: an async pipe under an `@if` starts the request only when the section is expanded. With resources it is DIY and not trivial. The same goes for a shared catalog: a resource held in a service starts when the service is first injected, even if the consumer does not need the data.
    - *Now:* a table row and text for all four approaches. The resource behaviour was checked in the Angular source: construction registers an effect that runs the loader as soon as `params` has a value, and reading the resource does not start or defer anything. Gating `params` with a signal or creating the resource in a conditionally rendered component are the ways to make it lazy. For `statefulObservable`, re-expanding repeats the request unless a `cacheKey` cache or a shared stream serves it.

15. **"DIY for partial results".**
    - *Initial claim:* in the graceful-degradation row, partial results were called DIY for `statefulObservable`, because one failed source turns a whole combination into an error.
    - *Correction:* that overclaims. The library encourages writing wires so that each leaf depends only on the data it requires. No required data means nothing to show for that leaf, and a broken wire blocks only its descendants; every other leaf still renders. A combination is deliberately "needs all of these".
    - *Now:* the row says partial results come from the graph itself, and that data which is merely nice to have belongs in its own leaf.

16. **Graceful degradation was measured on a single request.**
    - *Initial claim:* the graceful-degradation row (and criterion 3) credited tools for turning an error into a state, keeping a stream alive and offering a retry, which is the handling of one request.
    - *Correction:* that is simple in every approach and is not worth claiming as supported. The difference is in a complex dataflow: a failure deep in layers of derived and combined data, and what happens to its descendants, to everything else, and to recovery.
    - *Now:* criterion 3 and the row are about complex dataflow, and the single-request handling is stated as not counted.

17. **Event management was missing.**
    - *Initial claim:* the comparison had no row for events. Everything about "unusual flows" was grouped under sockets, polling and orchestration, and it was left open whether NgRx covers event handling.
    - *Correction:* events ("something happened", with or without a payload) and effects derived from one event or a set of events, with debounce, merges and time windows, are where RxJS shines. "Managing effects" here means composing them, not a single side effect. NgRx does not remove the need: even with a facade, events are handled with RxJS primitives, and signals' `effect()` is not an event-composition tool.
    - *Now:* a table row, a non-goal for `statefulObservable`, evaluation bullets for each approach, and a "Choosing" bullet.

18. **The store example was the classic NgRx store.**
    - *Initial claim:* section 4 and the table's NgRx column described classic `@ngrx/store` (actions, reducers, effects, selectors), with `@ngrx/signals` as a side note.
    - *Correction:* `@ngrx/signals` is the more current approach, and several statements did not carry over to it: it is provided locally or at root and is not global by default, writes go through the store's methods with protected state, and there is no action log in what I read.
    - *Now:* section 4 and the table column are about SignalStore, based on the NgRx guide, with secondary sources marked. Classic `@ngrx/store` is kept as a short alternative. Older entries below that mention actions, reducers and a facade refer to the earlier draft.

19. **The vanilla RxJS example looked simple and hid caveats.**
    - *Initial claim:* the first draft showed vanilla RxJS as `tap` plus `Subject` flags, which a competent developer would not write (the agent corrected that in its own review). The replacement, a `withState` operator, then looked like a complete answer: a dozen lines that keep the previous value and survive errors.
    - *Correction:* the author pointed out that the implementation appeared simple but has multiple caveats, and that the example had no combination and no shared data in a service, which made it look as if two helpers could replace the library. The caveats of what the sample does implement, each measured or shown on running code:
      - **A tradeoff: no wiping, but extra emissions.** To avoid wiping the UI, the example keeps the previous value by copying the state. That emits a new state when each request starts and when it ends: a value consumer received four values for two requests, with the previous value re-emitted, and potentially re-renders. The first remedy, `distinctUntilChanged`, did not account for the shape of the data. By reference it works on the extracted value of a single stream, but a combined value is rebuilt on every emission and the state wrapper is a new object each time, so those need a deep or custom comparator, which has its own cost.
      - **Wrapped values in operators.** Even a plain `map` added to a descendant stream receives the container and not the value, so it has to deal with the loading and error fields before it can touch the value. Dependent steps and higher-order operators are worse: bypass branches for loading and error, and a `concatMap` that misbehaves in that place (the ADR's analysis).
    - *Now:* the chapter opens with its main point, that the rabbit hole is deep, shows the combination and the shared service, and lists the traps the sample does not cover (cold by default, combination rules, recovery, lifetimes, untyped errors) under Problems.

## Challenged and confirmed, with caveats

20. **Resources and `reload()`.** The author asked for a recheck of "on `reload()`: no" (the claim that a resource does not wipe data on reload). The Angular source confirmed it for a resolved resource, with two caveats that were added: `reload()` does nothing while a load is in flight, and after an error `value()` is already the default. A recheck of the current source (November 2026) found that `value()` now throws in the `error` status and returns the default only while reloading after an error; the text says so.

## Corrected during the agent's own review

21. **NgRx.** The first draft said a store keeps old data only if you build it; reducers keep it by default. It also ignored `@ngrx/signals` and local stores, which are now covered, and the claim that stores are global is narrowed to the classic root store.
22. **Angular resources.** Claims about eagerness, an untyped error and writability came from memory. They were checked against the Angular 20 guide: a params change resets the value (documented), eagerness was later confirmed in the Angular source (see correction 14), and `asReadonly()` can encapsulate writes.
23. **A missing competitor.** TanStack Query, the closest relative in purpose, was not mentioned in the first draft.
24. **Bias.** The document was written to the library's own criteria without saying so. It now opens with its origin and a "Criteria it does not optimize for" list.

## Corrected in a second review (evidence audit)

25. **"Traceable" was one word for three questions, and the library's edge was overclaimed.** The table cell "Origin of a value traceable" credited the library with structure and vanilla RxJS with discipline, but a derived `pipe` and a `computed` signal have no write API either. The author objected that this understated the library: in vanilla RxJS, loading and error flags are often side-effect Subjects (writers), and `linkedSignal` and resources are derived yet writable. Both points hold. Criterion 1 now states the argument once, in three steps (no tool can forbid it; the question is the default path; here the reason for status writers disappears), with the prevalence of the status-flag pattern marked as the author's experience plus one rough code search (existence, not rate), and vanilla's way out marked DIY. The purity bullet lists what would count as evidence. The cell is now "Who can write a value"; the author's perspective separates *what happened*, *which call site* and *who can*, and states that "devtools are not attached in the field" is an unverified assumption.
26. **Angular resources: two statements were out of date.** The document said the guide documents no way to keep the previous value on a params change and that `resource` is experimental. The current guide describes `withPreviousValue` (with `linkedSignal` and `resourceFromSnapshots`) and shows no experimental flag on `resource` itself, only on `resourceFromSnapshots`. The text and the table now say a documented pattern exists and that the status needs checking per version. "`error()` is untyped" was softened because the type was not looked up, and "Runtime devtools: Limited" and "Uniform structure: Light" were replaced with "Not assessed" because nothing supported them.
27. **The vanilla RxJS samples were stricter on vanilla than warranted.** "Overloads or give up per-source types" ignored variadic tuple typing; "loading and error at once" and "does not say which source failed" are properties of a minimal helper and are now labelled so; "the buffer cannot be reset from outside" became "`shareReplay` has no reset signal; a workaround is code you write".
28. **Table cells that were inconsistent or unsupported.** Typed errors: vanilla "No" versus NgRx "By annotation" described the same unchecked annotation, so both now say so. Key-based cache: signals "No" became "DIY" like the others. NgRx "No, starts on call" ignored that reading state never triggers anything, and now says loads happen on call or hook. Vanilla "Runtime devtools: No" became "None built in".
29. **Evidence kinds were not stated.** The document now says what kinds of evidence it uses, that the probes were throwaway and not reproducible from the repository, that competitor cells are mostly readings of documentation, and that TanStack Query, ComponentStore and `httpResource` were not evaluated. Author rationale for not shipping devtools, the "store or streams" heuristic and the NgRx recommendation are attributed to the author.
30. **Interop was described as only losing state information.** A probe showed more: through RxJS (`combineLatest([from(stream)])`) the first error event ends the stream for that consumer, and a direct object observer receives `error` and then further `next` calls. The interop bullet says so and recommends `value$`, `pending$` and `error$`; the `toSignal` caveat is now verified on the library side, and the `toSignal` throw-on-read behaviour from its API reference.
31. **Angular resources in the error status.** The text said that after an error `value()` is the default. The current source throws from `value()` in the `error` status (the default is returned only while reloading after an error), so consumers need a `hasValue()` guard. Eagerness, `reload()` being ignored while idle or loading, and abort on destroy were rechecked in the same source and still hold.
32. **Inconsistencies found in a read-through.** The vanilla chapter claimed every trap was measured, though one comes from the ADR; a cross-reference pointed "above" to a list below; the SignalStore sample defined a `loading` computed that would collide with the state field; the table repeated retry, which the baseline note covers; a prediction about signals ("familiarity will be good") read as a feature; a bullet named a class from the example application. The running example now says why the client and the recovery on a new id are not shown in every sample. Inline hedges were replaced by evidence tags defined once under "Read this first", and this log was moved out of the article.
