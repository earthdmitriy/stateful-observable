# Comparing approaches: corrections log

This is the record of how [Comparing approaches to async state](./compare.md) changed while it was written and reviewed. It is kept apart from the article so that the article reads as a comparison; the article states the current position on every point below. Only corrections that changed a claim or its framing are listed, not wording changes, and not defects of the library that were found while writing and have since been fixed (those are in the [changelist](./changelist.md)).

The log is grouped by what changed, not by when; the chronological version is in the git history. Each entry carries two tags:

- **Trigger:** *author* (the library's author challenged the claim), *self-review* (the agent's own re-reading or evidence audit), *source check* (the text checked against the library's source), *reader review* (independent agents that read only the documents, as a reader sent the link would), *contest* (the same page built with each approach and judged by one test suite, in the rx-evo repository).
- **Direction:** *for* (the correction favours the library), *against* (it favours an alternative or adds a limit to the library), *neutral*. Entries in groups G and H are all neutral and carry only the trigger.

Entries in group I come from the contest. Its entries were written by agents, and the statefulObservable and resources entries were steered by hand by the library's author, which the article states.

Entries in group E reframe something the draft called a gap as a design choice. They are where steering by the author would show, so each one states the cost that remains, where one does.

## Summary

| Group | For | Against | Neutral | Total |
| --- | --- | --- | --- | --- |
| A. Claims about the library narrowed | 0 | 6 | 1 | 7 |
| B. Limits of the library added | 0 | 3 | 0 | 3 |
| C. Factual errors about a tool | 3 | 2 | 2 | 7 |
| D. Treatment of the alternatives | 1 | 4 | 2 | 7 |
| E. Gaps reframed as design choices | 14 | 0 | 2 | 16 |
| F. Criteria and scope set by the author | 4 | 0 | 2 | 6 |
| G. Coverage and disclosure added | 0 | 0 | 9 | 9 |
| H. Misreadings caused by missing documentation | 0 | 0 | 11 | 11 |
| I. Evidence from the contest | 6 | 1 | 1 | 8 |
| **All** | **28** | **16** | **30** | **74** |

Most corrections in favour of the library are in E and F, and most of those came from the author. Most corrections against it came from the agent's own reviews and from checking the text against the source.

## A. Claims about the library narrowed

- **A1. Combined error type** *(source check · against)*. "Always a tuple with a typed `false` entry per source" → exact for tuples; for an array of unknown length the type is `R[]` / `E[]`, and the `false` entries are missing from the type.
- **A2. Factory bound** *(source check · against)*. "Bounded by `cacheSize`" → the bound covers unused entries only; entries with subscribers are never evicted.
- **A3. RxJS depth** *(source check, reader review · against)*. "What remains is the operator basics", "handles most traps" → an explicit list of the traps handled; lifetimes, caching operators, write operators and interop still take RxJS knowledge, and the library's own API is listed as a learning cost.
- **A4. Dataflow tool** *(source check · against)*. `angular-mermaider` was presented without its author → the library's author's proof of concept, run on one example.
- **A5. One producer, and the pending hold** *(source check · against)*. "Every derived value has exactly one producer" ignored connections, whose producer is chosen at runtime (connections were later removed from the comparison, G9). "The pending hold removes the outdated combinations of `combineLatest`" → the parity tests cover two kinds of outdated combination, not all of them.
- **A6. Traceability** *(self-review, author · neutral)*. The library was credited with a traceable origin and vanilla RxJS with discipline, although a derived `pipe` and a `computed` have no write API either. The author objected that status flags in vanilla RxJS are usually writers, and that `linkedSignal` and resources are derived yet writable. Both points are kept: criterion 1 states the argument in three steps, the row became "Who can write a value", and *what happened*, *which call site* and *who can* are separated.
- **A7. Expandable rows** *(source check · against)*. "Expanding a row again is served from the factory's cache" → factory entries have no result cache of their own; with the default `refCount` a row expanded again fetches again, and only `refCount: false` keeps it.

## B. Limits of the library added

- **B1. Interop errors** *(self-review · against)*. "Interop only loses the state information" → a probe showed that through RxJS (`combineLatest([from(stream)])`) the first error event ends the consumer's stream, `firstValueFrom` rejects, and an object observer receives `error` and then further `next` calls.
- **B2. Errors reported to `ErrorHandler`** *(self-review · against)*. The caveat that `| async` on the stream reports each error event to Angular's `ErrorHandler` moved from the signals chapter into the library's own problems.
- **B3. Operators in pipes** *(reader review · against)*. Limits documented only in the ADR are now in the comparison: a value dropped inside a pipe leaves the node pending (with the boundary explained), and operator state restarts after an error.

## C. Factual errors about a tool

- **C1. Key-based caching** *(author · for)*. "No cache policy", and per-id caches that grow without bound → `cacheKey`, LRU `cacheSize` and `statefulObservableFactory` exist; the unbounded cache was a hand-written map in the example application.
- **C2. Typed errors in vanilla RxJS** *(author · for)*. "Yes" for vanilla, "Yes, via action payloads" for NgRx → an `Observable<T>` has no error type, so every approach receives `unknown` and types it on conversion; the library tracks the type from `pipeError` on.
- **C3. Shape of the combined error** *(self-review · for)*. "Several errors arrive as an array with `false`" → it is a tuple with one entry per source also when one source failed (narrowed later for arrays, A1).
- **C4. Resources: reload and the error status** *(author, self-review · neutral)*. Rechecked in the Angular source: `reload()` keeps the value of a resolved resource and is ignored while idle or loading; in the `error` status `value()` throws (November 2026 source), so consumers need a `hasValue()` guard.
- **C5. Resources from memory** *(self-review · neutral)*. Claims about eagerness, an untyped error and writability came from memory → checked against the Angular 20 guide and source: a params change resets the value, construction starts the loader, `asReadonly()` encapsulates writes.
- **C6. Resources out of date** *(self-review · against)*. "No documented way to keep the previous value" and "`resource` is experimental" → the current guide documents `withPreviousValue`, and only `resourceFromSnapshots` is flagged; unsupported cells ("Limited", "Light") became "Not assessed".
- **C7. NgRx keeps old data** *(self-review · against)*. "A store keeps old data only if you build it" → reducers and `patchState` keep it by default; local stores exist, and "global" is narrowed to the classic root store.

## D. Treatment of the alternatives

- **D1. Wiping in vanilla RxJS** *(author · against)*. Vanilla "wipes rendered data" → a plain `switchMap` keeps it; wiping appears only when written in (`startWith(null)`) or by a faulty state operator.
- **D2. Vanilla samples stricter than warranted** *(self-review · against)*. Variadic tuple typing was ignored; "loading and error at once" and "does not say which source failed" are labelled as properties of a minimal helper; "the buffer cannot be reset" became "`shareReplay` has no reset signal; a workaround is code you write".
- **D3. Vanilla example too simple** *(author · for)*. The first draft's `tap` plus `Subject` flags were replaced by a `withState` operator in self-review, which then looked like a complete answer. It now shows a combination and a shared service, and the caveats measured on running code (extra emissions and equality, wrapped values in operators).
- **D4. Inconsistent table cells** *(self-review · neutral)*. Typed errors described the same unchecked annotation differently for vanilla and NgRx; key-based cache "No" for signals became "DIY" like the others; NgRx loads "on call or hook"; vanilla devtools "None built in".
- **D5. NgRx Toolkit** *(reader review · against)*. The store was judged on hand-written flags → `withCallState` is described, with what it does not cover (merging across stores, recovery).
- **D6. Laziness of resources** *(reader review · against)*. The cell "No" → "No; gate it with `params` (DIY)".
- **D7. Signals as a presentation layer** *(author · neutral)*. Signals were placed only as an alternative for local state → they layer on top of stateful streams through `toSignal`.

## E. Gaps reframed as design choices

- **E1. No write path, "not pure"** *(author · for)*. Listed as weaknesses → an intentional trade-off: writable shared stores make the origin of a value hard to establish; the difference is in defaults, not in what can be forbidden. *Remaining:* no local patching; client-owned state (drafts, offline) is out of scope; purity is a default, not enforced, and the argument is not measured.
- **E2. Time-based caching and retry** *(author · for)*. "Not provided" → composed with RxJS operators (TTL on the loader, `reload()` from a timer, `retry` in the loader), verified with probes. *Remaining:* no packaged, tested policy layer; a repeated key is a cache hit; `shareReplay({ windowTime })` is not a TTL.
- **E3. Recovery of a derived graph** *(author · for)*. One feature among others → criterion 4, with its own section, table and test. *Remaining:* plain `reload()` refetches healthy sources; `where` needs names, `onlyFailed` a subscription, `path` a stable order.
- **E4. Structure** *(author · for)*. "Light conventions, no enforced structure" → the graph with one handle is the uniform structure; file layout belongs to the framework. *Remaining:* a design argument; granularity is a team habit.
- **E5. Overview of the dataflow** *(author's position · for)*. "No central overview" → a pure graph makes the map extractable by a tool. *Remaining:* one proof-of-concept tool by the author, one example; runtime wiring cannot be resolved statically.
- **E6. Optimistic UI** *(author · for)*. "None" → a derived overlay; rollback is dropping it. *Remaining:* hand-written; can briefly double-apply a non-idempotent change; the write operator has to be chosen.
- **E7. Partial results** *(author · for)*. "DIY" → each leaf depends only on what it needs, so a failure blocks only its descendants. A combination means "needs all of these", which is what a leaf that requires its sources wants; blocking a leaf on data it does not require is an antipattern in any approach, and the graph shape is what avoids it without extra code.
- **E8. Unread errors** *(self-review, author · for)*. "Errors live in a separate channel" as a problem → the only approach that reports an unread error. *Remaining:* a custom `log` replaces the report.
- **E9. Fixed combination rule** *(self-review · for)*. The fixed priority as a limit → a feature, since the others have no rule. *Remaining:* a pending source delays an error that is already known.
- **E10. Problems shared by every approach** *(self-review · for)*. Lifetime decisions, hand-composed time policy, events in RxJS, no registry, granularity, hand-written optimistic updates were listed against the library → moved to the baseline note, and the same pruning was applied to the other three lists.
- **E11. Naming for diagnostics** *(self-review · for)*. A problem → a condition of the `where` feature that the others do not have.
- **E12. RxJS fluency** *(author · for)*. "Needs RxJS" as a cost → every approach needs fluency in its own model; the row became "What you need to know". *Remaining:* the library's API and part of the RxJS depth (A3).
- **E13. "Glitches"** *(author · for)*. Intermediate combinations were added as a problem of push-based RxJS and then reverted: the term comes from the signals RFC, and emitting on every change is `combineLatest`'s contract. A neutral push-versus-pull row replaced it. *Remaining:* `reload()` of synchronous sources can emit a stale mix.
- **E14. Triggers and writes** *(reader review · neutral)*. The criticism of stores ("anyone can invoke an action") was not applied to `reload()` → triggers re-read the source of truth, writes replace it. *Remaining:* an unwanted trigger costs requests and pending states; the premise that the frontend owns no truth except user input is the author's.
- **E15. Cross-feature invalidation** *(reader review, author's position · neutral)*. Not discussed → an intended trade-off: no global registry. *Remaining:* another feature's handle has to be passed explicitly; there is no invalidation by key.
- **E16. Maturity** *(author · for)*. "Low", which read as a new paradigm → the package is young, its foundation (RxJS) is not. *Remaining:* 0.x, one maintainer, no data on adoption.

## F. Criteria and scope set by the author

- **F1. Shared state** *(author · for)*. "A store is right for global state" → root tokens or services holding stateful observables, combined anywhere (criterion 2); a store for many writers.
- **F2. Modular, atomic code** *(author · for)*. Added later as criterion 5.
- **F3. Graceful degradation** *(author · neutral)*. Credited for single-request handling → only complex dataflow is counted, since one request is simple everywhere.
- **F4. Laziness** *(author · for)*. Missing → a row for all four; the eagerness of resources verified in the Angular source, with the ways to gate it.
- **F5. Events** *(author · neutral)*. Missing → composing events is RxJS territory and a non-goal of the library.
- **F6. Graph-shaped dataflow as the foundation** *(author · for)*. Progressive loading, graceful degradation and recovery were treated as separate features → stated as consequences of one topology (leaves that depend only on what they need), with the library's aim being to make that topology cost nothing extra; the split into leaves is not enforced.

## G. Coverage and disclosure added

- **G1. Bias** *(self-review)*. The document now opens with its origin and a list of criteria it does not optimize for.
- **G2. Evidence** *(self-review)*. Evidence kinds are tagged; probes are throwaway; competitor cells are readings of documentation; author rationale is attributed.
- **G3. Read-through** *(self-review)*. Inconsistencies fixed: a trap claimed as measured that came from the ADR, a wrong cross-reference, a colliding sample field, a duplicated row, a prediction read as a feature.
- **G4. SignalStore** *(author)*. The store chapter described classic `@ngrx/store` → `@ngrx/signals`, with the classic store as an alternative.
- **G5. TanStack Query** *(self-review, reader review)*. Missing, then one unverified paragraph → evaluated from the Angular adapter's documentation (not run).
- **G6. Choice of alternatives** *(reader review)*. Explained: a baseline, a built-in option and popular libraries; others are not covered.
- **G7. SSR, testing, progressive rendering** *(reader review)*. Added: SSR as inherited from RxJS and Angular *(reasoned)*, testing as plain RxJS, progressive rendering as the author's design argument.
- **G8. Lists** *(reader review)*. Pagination, infinite and virtual scroll and expandable rows, from the author's demo application (read, not run).
- **G9. Connections removed** *(reader review, author)*. `statefulConnection` raised more questions than it answered and is not a primary feature; it is documented in [QoL](./QoL.md), and the comparison mentions it only as a wiring decision.

## H. Misreadings caused by missing documentation

Readers misunderstood these because the documentation did not answer them. Each entry says where the answer now is.

- **H1. Saving** *(reader review)*. "A save shows the same pending as a fetch" read as the only way to write → "No write path, by design" gives two ways to save and a CRUD flow; see also [recipes](./recipes.md#putting-update-result-into-stream).
- **H2. What `reload()` needs** *(reader review)*. Read as needing names → the recovery limits open with "plain `reload()` needs no names, no subscription".
- **H3. User code in the samples** *(reader review)*. The library's helpers seemed counted as given → a list of what is user code in each sample.
- **H4. Unread errors and reporting** *(reader review, source check)*. The report was called a "warning" and read as the reporting path → it is a `console.error` and a development signal; reporting belongs in `pipeError`; `log` is a tracing hook for a whole subtree.
- **H5. Errors during a retry, three subscriptions** *(reader review)*. Why an error stays visible during a retry, and whether separate `value$` / `pending$` / `error$` give inconsistent views → both explained in the features of section 2.
- **H6. The running sample** *(reader review)*. It used `| async` on the stream, which the text warned about → it reads `value$`, with the other form as a note.
- **H7. `subscribe`** *(author)*. The extended observer (`pending`, `active`) was undocumented → described next to interop.
- **H8. `value$`** *(author)*. The ADR listed it as a candidate for deprecation → a decided ADR entry keeps it.
- **H9. Mounted views after logout** *(reader review, author)*. Read as a data-leak risk → the stateful block pattern is extended to remove its content on `active(false)`.
- **H10. Cache lifetimes** *(reader review)*. No model of what holds data → a table under "Key-based caching".
- **H11. Typed errors through the graph** *(reader review, author)*. "After `pipeError`" hid that the type is carried through pipes and combinations → the table cell says so.

## I. Evidence from the contest

- **I1. Batching** *(contest · for)*. No row → a "Batching ids into one request" row: hand-written in vanilla RxJS (136 lines, met), a batch factory here, not met by the resources and SignalStore entries.
- **I2. Wiping on fetch** *(contest · for)*. "No" for vanilla RxJS and SignalStore → no for one stream or one store field; a keyed cache starts a new key empty, and on the contest page both blanked a section on a key switch, while this library kept the last value under the spinner.
- **I3. Resources as a shared cache** *(contest · for)*. Only "no key-based result cache" → a resource is a per-owner read; used as a shared cache (twelve registries, 289 lines) it cannot both keep and cancel an entry, writes blank by changing the key, and batching is not met. The article states where it fits (a simple page with no shared data) so this reads as a misfit, not a defect.
- **I4. SignalStore cache and laziness** *(contest · for)*. "Not lazy by consumption" → what building it costs: a keyed cache with observer counts and in-flight subjects (132 lines), attach and detach from an `effect()` wrapped in `untracked()`, and no batching.
- **I5. Cost of DIY in vanilla RxJS** *(contest · neutral)*. "Key-based result cache and reload are DIY" → measured: about 400 lines of generic code, and every scenario met. It supports "the entrance to the hole" and shows that DIY works.
- **I6. Unaided agent: other shapes are possible** *(contest · against)*. The contest's statefulObservable agent, deliberately not given the recipes, needed hand steering on the patterns the design arguments call the default. It was first listed as a problem of the library; that bullet was removed once the recipes were checked (I8), and a short notice stays: on a project without settled patterns, other shapes are possible.
- **I7. Factory entries after 0.8.0** *(source check · for)*. "No result cache of its own" and "resets or reloads all of its entries, not a partial key" → an entry keeps its last completed value without consumers, `refCount` only decides whether a load in flight is cancelled, one key reloads through its own stream, and a batch factory has the same API.
- **I8. Recipes checked** *(contest · for)*. "Whether an agent given the recipes finds it is not checked yet" → an agent given the recipes wrote the intended pattern on every steering point of a slice of the page, with no steering; the unaided run's bullet left the problems list.
