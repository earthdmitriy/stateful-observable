# Proposal: `active` and `firstPending` sentinels

Status: proposal, see "To Be Determined" in [ADR](./adr.md). Nothing here is implemented.

## Why

Today a consumer can tell four things apart: `inactive`, `loading` (pending), `error` and a value. Two situations are not distinguishable:

1. **Running, but the input has not emitted yet.** After `active` goes `true` (or on the first subscription) a root subscribes to its input. If the input is silent (a form's `valueChanges`, a `Subject`, a websocket), no event follows. After a re-activation the last event the consumer saw is still `inactive` (the root emits `inactive` on `active: false`, and `valueOrError$` is re-subscribed on `true`; nothing else is emitted until the input does). The stream is alive, but looks switched off.
2. **A pending state with nothing to show yet.** `loading` is the same event for a first load and for a reload. A UI wants a different picture: a skeleton when there is no data yet, a spinner overlay over the previous data when there is.

Proposal: two more sentinels.

| Sentinel | Meaning |
|---|---|
| `active` | The stream is running, but nothing has been received on its input yet. Nothing is in flight. |
| `firstPending` | Pending, emitted instead of `pending` at the first run (and after a re-activation): there is no previous result to keep showing. Explicit signal for the UI: skeleton instead of spinner overlay. |

Related ADR: "Pending state of a connection with a vanilla source". It concluded that a connection has no truthful *pending* before the first value. `active` is the truthful state for that moment: running, nothing started.

## Lifecycle

```
                 active$ = false
        ┌──────────────────────────────┐
        ▼                              │
   inactive ──active$ = true──► active ──input event, result is async──► firstPending ──► value | error
                                  │                                                           │
                                  └──input event, result is sync──► value | error             │
                                                                                              ▼
                                                      next input event / reload() ──► pending ──► value | error
```

Proposed emission rules (same technique as `loadingUnlessSync`, so the 0.7.0 rule "a change that finishes at once was never pending" holds):

- `active` is emitted only if nothing arrived synchronously after the root subscribed to its input. A `BehaviorSubject` or `of(...)` input, and a root with a sync loader, never emit it.
- `firstPending` replaces `pending` while the root has produced no settled event (value or error) since its activation, i.e. since the first subscription, since `active` went `true`, or after the node was released by `refCount` and subscribed again.
- After a settled event the next in-flight change is a plain `pending`, as before. An error counts as settled: the previous error stays visible during a retry (see "Priority of states in a combination").
- `inactive` resets the "settled" memory, so the first load after a re-activation is `firstPending` (the cache is dropped at that moment too).

## Matrix 1: typeguards x signals

Rows are the events, columns are the guards. `isFirstPending` and `isActive` are new.

| event | `isLoading` | `isFirstPending` | `isActive` | `isInactive` | `isError` | `isSuccess` |
|---|---|---|---|---|---|---|
| value | false | false | false | false | false | **true** |
| `loading` | **true** | false | false | false | false | false |
| `firstPending` | **true** | **true** | false | false | false | false |
| `active` | false | false | **true** | false | false | false |
| `inactive` | false | false | false | **true** | false | false |
| `error` | false | false | false | false | **true** | false |

Rules behind it:

- **`isLoading` stays true for both pending kinds.** `firstPending` is a refinement of pending, and `isFirstPending` tells the kinds apart. The type is `ResponsePending = ResponseLoading | ResponseFirstPending` and `isLoading` narrows to it.
- **`isActive` is not "not inactive".** It is true only for the `active` event: a value, a pending state or an error are not `isActive`. The name is the weak point of the proposal, see open questions.
- **Exactly one guard is true per event**, except `firstPending`, which is also `isLoading` by design.
- **`isSuccess` must exclude both new states.** It is a negative check (`!state || !statesSet.has(state)`), so a sentinel missing in `statesSet` is a *value*: it would reach `value$`, `subscribe(next)`, `forEach`, `pipeValue` and `mapCombinedValue`.

Why `isLoading` is a superset and not disjoint. With a disjoint `isLoading` every current call site that tests `isLoading` would need a second test, and the ones that are missed fail silently:

- `pending$` is `false` during the first load, so a spinner never shows;
- `error$` filters `!isLoading && !isInactive`, so `firstPending` would pass and emit `false` ("no error");
- `combineStatefulObservables` tests `some(isLoading)`, so a combination with a `firstPending` source would go on to the error/value branch and call `mapCombinedValue` with a sentinel.

## Matrix 2: what each existing call site does

Checked against the current source. "Works" means no change is needed once `isLoading` is a superset and `statesSet` is extended.

| Call site | `firstPending` | `active` |
|---|---|---|
| `value$`, `forEach`, `subscribe(fn)` (`isSuccess`) | skipped | skipped |
| `pending$` (`filter(!isInactive)`, `map(isLoading)`) | `true` (works) | `false` (works): nothing is in flight |
| `error$` (`filter(!isLoading && !isInactive)`) | skipped (works) | **needs `&& !isActive(e)`**, else it emits `false` |
| `subscribe(observer)` | `active(true)`, `pending(true)` (works) | `active(true)` only (works) |
| `pipeValue` (feeds `isSuccess` events) | passes by, like `loading` | passes by |
| `pipeError` (feeds `isError` events) | passes by | passes by |
| `pipe` (feeds everything) | fed to the operators like any event | fed to the operators like any event |
| `skipRepeatedLoading` | see below | untouched |
| combination | see Matrix 3 | see Matrix 3 |
| `reload({ onlyFailed })` (`isError`) | not failed, skipped | not failed, skipped |
| `serializeResponse` / `deserializeResponse` | **needs a variant** | **needs a variant** |
| `log` (through `serializeResponse`) | needs the variant, see below | needs the variant, see below |

Notes:

- **`skipRepeatedLoading`.** It drops a loading that directly follows another one, so a pipe's own async step does not repeat the parent's pending. With `isLoading` as a superset it would also drop a plain `loading` that follows a `firstPending`, which is the wanted result: the skeleton stays. The reverse (a `firstPending` after a `loading`) is dropped too, and should not occur in a single node.
- **A pipe's own loading.** `isolatedPipeline` emits `loading` when a fed value has no synchronous output. If the pipe node itself has produced nothing since (re)activation, this should be `firstPending`, or a root with a cache hit (sync value) followed by `pipeValue(switchMap(request))` shows a spinner over nothing. The pipe already keeps `last`; it would also need the "settled" memory.
- **Serialization.** An unknown sentinel falls through `serializeResponse` to `{ value: response }`, and `JSON.stringify` drops a symbol-valued `state`, so a log line would silently become `{ value: {} }`. Order matters too: with a superset `isLoading`, `isFirstPending` has to be tested before `isLoading`, or `firstPending` is logged as `{ pending: true }`. Proposed DTO: `firstPending` as `{ pending: true, first: true }`, which a reader of the current DTO still reads as pending; `active` as `{ active: true }`, which has no compatible encoding, since the current `deserializeResponse` throws a `TypeError` on a shape it does not know.
- **`statefulConnection`.** `connect(vanillaSource)` could emit `active` at once: running, nothing received. `connect(statefulSource)` passes the source's own events through.

## Matrix 3: combination priority

Today: `inactive` > `pending` > `error` > value. Proposed:

`inactive` > `firstPending` > `pending` > `active` > `error` > value

Reasoning, from the existing rule that an error event is emitted only when every source has settled: a source in `active` has not settled, so it holds the combination back from `error` and from a value. Something in flight is reported as pending whenever there is any, so `pending$` stays truthful.

Pairs that involve a new signal (the result is symmetric):

| source A | source B | combination | note |
|---|---|---|---|
| `inactive` | any | `inactive` | unchanged |
| `firstPending` | `pending` | `firstPending` | no data yet for at least one source |
| `firstPending` | `active` | `firstPending` | something is in flight |
| `firstPending` | `error` / value | `firstPending` | |
| `pending` | `active` | `pending` | wrinkle: spinner overlay while the combination has never had a value |
| `active` | `active` | `active` | |
| `active` | `error` | `active` | the error is shown when `active` settles, as with pending today |
| `active` | value | `active` | |
| `firstPending` | `firstPending` | `firstPending` | |

The `pending` + `active` row is the weak spot: stateless priority cannot know that the combination has no data. A fix is a stateful rule ("`firstPending` until the combination has produced a first settled event"), which turns the combination from a pure reduce into a node with memory.

## Cost: mixed library versions

Sentinels are global symbols (`Symbol.for`), so copies of the library at different versions interoperate. A copy without the new states treats an unknown `state` as a value (`isSuccess` is a negative check), so a combination or a consumer from an older copy would pass `{ state: activeSymbol }` to `mapCombinedValue` and to `value$`. Adding sentinels is therefore a breaking change for mixed copies, however the version is numbered.

## Open questions

1. **Names.** `isActive` reads as "the stream is active", which is also what `inactive` negates, what `active?: Observable<boolean>` configures and what the observer's `active(boolean)` reports. In that observer callback `active(true)` is already sent for every event except `inactive`. The new sentinel means something narrower, "running and nothing received". The existing sentinel is named `loading` (`loadingSymbol`, `isLoading`) while the concept everywhere else is *pending*; `firstPending` follows the concept, so `isFirstPending` would sit next to `isLoading`.
2. **Public API for the UI.** Guards on `raw$` are enough for custom code, but templates use `value$`, `error$`, `pending$` and `subscribe`. Something is needed to choose a skeleton: a `firstPending$` stream and `firstPending?: (boolean) => void` in the observer, or nothing beyond `raw$`. Not designed here.
3. **`active` for roots without an `active` option.** Every `statefulObservable(silentInput$)` would start emitting an `active` event where today it emits nothing. Intended by the proposal; a behaviour change for existing consumers of `raw$`.
4. **Combination state.** Stateless priority (Matrix 3) or a stateful "first settled event" memory.
5. **`refCount`.** Whether a node that was released and subscribed again starts with `firstPending`. The proposal says yes, since its cache and operator state are gone.
