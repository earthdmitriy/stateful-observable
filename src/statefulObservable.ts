import {
  BehaviorSubject,
  combineLatest,
  defer,
  from,
  iif,
  isObservable,
  map,
  Observable,
  ObservableInput,
  of,
  switchMap,
  tap,
} from "rxjs";
import { createCache, toCacheKey } from "./cache";
import { fillStatefulObservable } from "./fillStatefulObservable";
import { catchResponseError, loadingUnlessSync } from "./operators";
import { inactiveSymbol, serializeResponse } from "./response-container";
import {
  ParamsWithInput,
  ParamsWithLoader,
  ResponseInactive,
  StatefulObservable,
  StatefulObservableParams,
} from "./types";

const expandInput = <Input, Response, Meta>(
  params: StatefulObservableParams<Input, Response, Meta>,
):
  | ParamsWithInput<Input, Response, Meta>
  | ParamsWithLoader<Input, Response, Meta> => {
  if (typeof params === "function") return { loader: params };
  if (isObservable(params)) return { input: params };
  return params;
};

/**
 * Create a stateful wrapper around an RxJS data flow.
 *
 * This factory accepts a configuration object with one of two shapes:
 *  - `ParamsWithInput` — you provide an `input: Observable<Input>` and an
 *    optional `loader` that maps each input to a response; or
 *  - `ParamsWithLoader` — you provide a `loader` and `input` is optional. In
 *    this mode a default single trigger is used when `input` is not supplied.
 *
 * The created `StatefulObservable` exposes:
 *  - `subscribe(params)` — subscribe to the underlying raw observable,
 *  - `value$` — successful values only,
 *  - `error$` — error payloads only,
 *  - `pending$` — boolean loading indicator,
 *  - `reload()` — trigger to re-run the loader for the current input,
 *  - `pipe` / `pipeValue` / `pipeError` helpers for composing further operators.
 *
 * @template Input - input value type (the type emitted by `input` when provided)
 * @template Response - response value type produced by the loader (or the same as Input when no loader is used)
 * @param {ParamsWithInput<Input, Response> | ParamsWithLoader<Input, Response>} options - Configuration object.
 * @param {Observable<Input>} [options.input] - Source observable that drives requests. If omitted and a `loader` is provided,
 *   the implementation will use a single trigger so the loader still runs when subscribed or reloaded.
 * @param {(input: Input) => ObservableInput<Response>} [options.loader] - Optional function that maps an input to an observable (eg. HTTP request). If omitted the input value itself is used as the response.
 * @param {TmapOperator} [options.mapOperator=switchMap] - Operator used to map each input to a response observable. Defaults to `switchMap`.
 * @param {(i: Input) => any[]} [options.cacheKey] - Optional cache key generator. Return an array of JSON-serializable values; it is encoded as JSON to form the cache key. An empty array skips caching.
 *   When the returned array is falsy or empty the value is not cached. When a truthy key is produced successful responses are cached and reused for identical keys.
 * @param {number} [options.cacheSize=42] - Maximum number of entries retained in the internal LRU-like cache.
 * @param {string} [options.name] - Optional name for debugging/logging purposes.
 * @param {LogInput<Input> & LogResponse<Response>} [options.log] - Optional logging function to log inputs and outputs of the stream.
 * @returns {StatefulObservable<Response, Error = unknown>} A stateful observable exposing typed streams and helpers.
 *
 * @remarks
 * - Errors thrown by the source or loader are converted to `ResponseError` values so the stream does not error out.
 * - A loading sentinel is emitted while an async loader is in-flight.
 * - Caching is optional and controlled by `cacheKey` + `cacheSize`.
 *
 * @example
 * const stream = statefulObservable({
 *   input: myId$,
 *   loader: id => http.get(`/items/${id}`),
 *   cacheKey: id => [id],
 *   cacheSize: 100,
 * });
 *
 * // Shorthand example without input observable:
 * const stream = statefulObservable(() => http.get("/items"));
 * // equal to
 * const stream = statefulObservable({
 *   loader: () => http.get("/items"),
 * });
 *
 * // Shorthand example without loader:
 * const stream = statefulObservable(myInput$);
 * // equal to
 * const stream = statefulObservable({
 *   input: myInput$,
 * });
 *
 * // use combineStatefulObservables instead of combineLatest
 * // resulting statefulObservable will merge pending, error, and value streams properly
 * const combined = combineStatefulObservables(
 *  [stream1,stream2, streamX],
 *  // tuple of values - type safe
 *  ([value1, value2, valueX]) => ({ value1, value2, valueX })
 * )
 *
 * More examples:
 * @see https://github.com/earthdmitriy/stateful-observable/blob/main/docs/recipes.md
 */
export const statefulObservable = <Input, Response = Input, Meta = undefined>(
  options: StatefulObservableParams<Input, Response, Meta>,
): StatefulObservable<Response, unknown, Meta> => {
  const {
    input,
    active,
    loader,
    mapOperator = switchMap,
    cacheKey = () => [] as never[], // an empty key skips caching
    cacheSize = 42,
    meta,
    name = "unnamed",
    log,
    refCount = true,
  } = expandInput(options);

  const source$ = input ?? of(true as Input);
  const cache$ = new BehaviorSubject(createCache<Response>(cacheSize));
  const resetCache = () => cache$.next(createCache<Response>(cacheSize));

  const makeObservableInput = (input: Input) =>
    loader ? loader(input) : of(input as unknown as Response);

  const valueOrError$ = combineLatest([source$, cache$]).pipe(
    mapOperator(([input, cache]) => {
      if (log) log({ input }, name, 0);
      // `defer` turns a synchronous throw (in `cacheKey`, in key encoding or
      // in the loader) into an error event for this input only, so the stream
      // keeps handling later inputs. Loading is emitted only when the result
      // does not arrive synchronously (input-only nodes, sync loaders, cache
      // hits): a change that finishes at once was never pending.
      return loadingUnlessSync(
        defer(() => {
          const key = toCacheKey(cacheKey(input));
          if (key !== null) {
            // a lookup, not a truthiness check: falsy results are cached too
            const cached = cache.lookup(key);
            if (cached.hit) return of(cached.value);
          }

          return from(makeObservableInput(input)).pipe(
            tap({
              next: (result) => {
                if (key !== null) cache.set(key, result);
              },
            }),
          );
        }).pipe(catchResponseError()),
      );
    }),
    catchResponseError(), // the source can throw errors too
    tap((raw) => {
      if (log) log(serializeResponse(raw), name, 0);
    }),
  );

  const raw = active
    ? active.pipe(
        switchMap((a) =>
          iif(
            () => a,
            valueOrError$,
            // Drop cached results when the stream goes inactive (logout): they
            // may belong to the previous user. Done here, after switchMap has
            // unsubscribed the active branch, so replacing the cache does not
            // trigger a reload.
            defer(() => {
              resetCache();
              return of({ state: inactiveSymbol } as ResponseInactive);
            }),
          ),
        ),
      )
    : valueOrError$;
  const internalMeta = [{ errorSubscriptions: 0, refCount }];

  return fillStatefulObservable<Response, unknown, Meta>({
    raw,
    name,
    meta,
    internalMeta,
    log,
    index: -1, // will be incremented to 0 in fillStatefulObservable
    // `where` still set here means nothing on the way to this root matched, and
    // a path left over goes deeper than the graph; `onlyFailed` is ignored by a
    // root (its combined parent already checked)
    reload: (options) => {
      if (!options?.where && !options?.path?.length) resetCache();
    },
    refCount,
  });
};
