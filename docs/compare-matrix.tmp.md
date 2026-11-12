# Compare: common criteria matrix (temporary)

Working file for re-evaluating [compare.md](./compare.md). Every feature, peculiarity and problem that appears in any of the four "Evaluation" blocks is a row here, and each row is filled for **all four** approaches. A bullet belongs in a per-approach Evaluation list only if its row shows a real difference; rows where all four behave alike go to the baseline note.

Legend: **+** provided / better, **=** same as the others (baseline), **−** missing / worse, **DIY** you write it, **~** depends on choices, **?** not assessed.

Column "Was listed as" shows where the old text put the item and against whom; "Verdict" says what happens to it.

## A. Single-source async state

| # | Criterion | Vanilla RxJS | statefulObservable | Signals / resources | NgRx SignalStore | Was listed as | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Loading / error as data | DIY (`withState`) | + built in | + built in (`status`, `error`) | DIY (fields + `patchState`) | RxJS problem | keep: differs |
| A2 | Stream survives an error | DIY (`catchError` inside) | + | + | DIY (error handling inside inner pipe) | RxJS problem, SO feature, store note | keep: differs |
| A3 | Keeps old value while loading new input | + (`switchMap` emits nothing) | + | − on params change; pattern documented | + (`patchState` leaves value) | feature for RxJS/store, problem for signals | keep |
| A4 | Can show data of the previous input (consequence of A3) | ~ same as A3 | ~ same as A3 | − only with the keep-value pattern | ~ same as A3 | **SO problem only** | overclaimed: same trade-off for 3 of 4, move to table |
| A5 | Stale response cannot override newer | = `switchMap` | = | = abort on params change | = `switchMap` | baseline + RxJS/store features | baseline only |
| A6 | Retry with backoff | = `retry` | = | = (`rxResource`) | = | baseline + RxJS/signals/store features | baseline only |
| A7 | Lazy until consumed | + | + | − eager | − imperative trigger | features / problems | keep |
| A8 | One request per node for many consumers | − cold, needs `shareReplay` | + shared by default | + one resource, many reads | + one store instance | RxJS problem | keep |
| A9 | Lifetime of shared data is a decision | ~ `refCount` | ~ `refCount` (+ `pipe(share…)`, factory `cacheSize`) | ~ owning injector; service field is eager | ~ root vs local | **SO problem**, store problem, RxJS aside | overclaimed: same for all, move to table |
| A10 | Clearing user data at logout | DIY (`shareReplay` has no reset) | + `active` | DIY | DIY (reset state by hand) | SO feature, store problem | keep |
| A11 | Error not rendered = invisible | − unhandled error terminates stream (visible in console) / with `withState` invisible | + console warning when nobody listens to `error$` (custom `log` replaces it) | − `error()` not read = invisible, no warning | − `error` field not read = invisible, no warning | **SO problem only** | overclaimed: SO is the only one that warns; keep only the `log` caveat |
| A12 | Previous error while a new load runs | ~ your operator | `error$` keeps last error (pending is filtered out of `error$`) | `error()` cleared on params change | ~ your `patchState` | not listed | peculiarity, mention |
| A13 | Reading before the first value | `async` gives `null` | `async` gives `null`; `value$` waits | value is `undefined`; `value()` **throws** in `error` | initial state you declare | signals problem | narrow to the throw |

## B. Composition and recovery

| # | Criterion | Vanilla RxJS | statefulObservable | Signals / resources | NgRx SignalStore | Was listed as | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | Combining statuses | DIY | + `combineStatefulObservables` | DIY (`computed` / helper) | DIY (`withComputed`) | all | keep |
| B2 | Combination rule | DIY: you choose, test, repeat | fixed: inactive > pending > error > value | DIY: you choose | DIY: you choose | **SO problem** ("fixed priority") | reframe: only SO has a rule at all; its one weak spot is B3 |
| B3 | A slow source delays a known error | ~ depends on your rule | − yes (pending wins) | ~ your rule | ~ your rule | SO problem | keep, see priority analysis |
| B4 | Which source failed | DIY (minimal helper: first error only) | + tuple, one entry per source, `false` = no error | DIY | DIY | **SO problem** ("array with false") | overclaimed: it is the feature, not a problem (see C) |
| B5 | Typed errors | annotation, unchecked | after `pipeError`; tuple types for tuples | no type from source | annotation, unchecked | row | keep; **new: array (non-tuple) sources typed `E[]`, runtime has `false`** |
| B6 | Dependent steps on wrapped values | − every operator must know the wrapper | + `pipeValue` / `pipeError` | ~ chain resources via `params`, statuses not merged | ~ steps inside `rxMethod`, statuses set by hand | RxJS problem | keep |
| B7 | Recover a derived handle | DIY per layer | + `reload()` through the graph | DIY | DIY | all | keep |
| B8 | Partial recovery (only failed / by name / by path) | DIY | + `onlyFailed`, `where`, `path` | DIY | DIY | SO feature | keep |
| B9 | Combination semantics | push: emits on every source change | push; a pending source holds the combination (fewer outdated values than vanilla with async sources) | pull: `computed` | pull: `computed` | was framed as "glitch" | neutral semantics row; "glitch" is the signals framing, not a defect of a push combination. Only the sequential `reload()` of sync sources stays a limit |
| B10 | Graceful degradation in a complex graph | DIY, grows with graph | + | DIY | DIY | all | keep |

## C. Writes

| # | Criterion | Vanilla RxJS | statefulObservable | Signals / resources | NgRx SignalStore | Was listed as | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Write / patch cached value | ~ add a Subject | − none by design | + `set` / `update` | + store methods | SO problem, signals feature | keep (design trade-off) |
| C2 | Who can write a value | derived: nobody; status: DIY | sources only | `computed`: nobody; resources, `linkedSignal`: anyone holding them | store methods | row | keep |
| C3 | Optimistic UI and rollback | DIY | overlay DIY, rollback free | `set` then undo DIY | patch then undo DIY | SO problem, store problem | same cost everywhere except rollback; table |
| C4 | A save shows the same pending as a fetch | ~ with one `withState`: yes | yes | separate resource or plain call | ~ separate flag if you declare one | SO problem | SO-specific only vs store; keep inside C1 bullet |

## D. Caching

| # | Criterion | Vanilla RxJS | statefulObservable | Signals / resources | NgRx SignalStore | Was listed as | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Key-based result cache | DIY | + `cacheKey` / factory | DIY | DIY | all | keep |
| D2 | Time-based policy (stale time, refetch on focus / interval) | DIY | DIY (compose) | DIY | DIY | **SO problem**, signals problem, store problem, baseline | overclaimed: identical everywhere, baseline only |
| D3 | Built-in key cache has no expiry, not pluggable | n/a | − | n/a | n/a | SO problem | detail of a feature nobody else has; keep as a caveat on D1, not a problem |

## E. Events and side effects

| # | Criterion | Vanilla RxJS | statefulObservable | Signals / resources | NgRx SignalStore | Was listed as | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | Composing events over time | + native | = defers to RxJS | = defers to RxJS | = RxJS in `rxMethod` | RxJS feature, problem for SO, signals, store | keep as RxJS feature; drop from the three problem lists (row in table) |
| E2 | Designated place for effects | none | none (`tap` / `subscribe` at the edge) | `effect()` | `rxMethod`, Events plugin | SO feature (purity) | design argument, unchanged |
| E3 | Interop errors surface as application errors | n/a | − `| async` and `toSignal` on the stream itself report every error event | n/a | n/a | signals section caveat | SO-specific, move into SO list |

## F. Structure, tooling, team

| # | Criterion | Vanilla RxJS | statefulObservable | Signals / resources | NgRx SignalStore | Was listed as | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Shared shape across units | − | + one handle | + `Resource` / `Signal` (combine DIY) | + feature-based | RxJS problem | keep |
| F2 | Cost of adding a unit | adapters | one declaration | one declaration, combine by hand | one store or feature | all | keep |
| F3 | No central registry, graph exists only as references | = | = | = | − / + a store is a registry for its slice | **SO problem** | overclaimed: same as RxJS and signals; keep only the naming need (F4) |
| F4 | Naming needed for diagnostics / partial reload | n/a | ~ `name` / `meta` needed for `where` and readable logs | n/a | n/a | inside SO problem | keep, short |
| F5 | Granularity is a team habit | = | = | = | = | SO problem | baseline (no tool enforces it) |
| F6 | Runtime devtools | none | none | ? (Angular DevTools not assessed) | community toolkit | SO problem, RxJS problem | table only |
| F7 | Static dataflow diagram | ? | angular-mermaider (author's tool, young) | ? | ? | SO section | unchanged |
| F8 | Maturity, bus factor, API churn | very high | − pre-1.0, one maintainer | high; parts experimental | high; Events plugin experimental | SO problem, signals problem | keep |
| F9 | Needs RxJS fluency | yes | yes | partly | partly (`rxMethod`) | SO problem | keep only as a difference to signals/store; table |
| F10 | Framework coupling | none | none | Angular | Angular | table, signals feature | table |

## Resulting per-approach lists

Only rows where the approach differs from at least one other approach. Rows marked "=" or "~ same" go to the table or baseline.

- **Vanilla RxJS.** Features: A7, A3, E1, F10/F8. Problems: A1/A2, A8, B6, B1/B10, B4, F1, D1.
- **statefulObservable.** Features: B10, B1, B4, B7/B8, A8, A7, A10, A11, B6, D1, F1/F2. Problems / peculiarities: F8, C1, B3, B9, E3, B5 (array typing), A11 caveat (`log`), F4, F9.
- **Signals / resources.** Features: A1/A2, C1, B9, F10 (first-party), F8. Problems: A7, A3 (wipe), B1/B10/B7, B5, A13 (throws), C2 (writable), F8 (`resourceFromSnapshots` experimental), D1.
- **NgRx SignalStore.** Features: F1, C1/C2 (controlled writes), A3, B9, F6 (toolkit). Problems: A1/A2, B1/B10/B7, A7, B5, D1, C3 is equal → dropped.

## Moved to baseline (identical everywhere)

A5, A6, A9, D2, E1 (for the three non-RxJS approaches), F3, F5.
