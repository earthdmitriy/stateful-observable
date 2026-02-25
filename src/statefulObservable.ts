import {
  BehaviorSubject,
  combineLatest,
  from,
  isObservable,
  map,
  merge,
  Observable,
  ObservableInput,
  of,
  switchMap,
  tap,
} from "rxjs";
import { createCache } from "./cache";
import { fillStatefulObservable } from "./chaining";
import { catchResponseError, mapToLoading } from "./operators";
import { isError } from "./response-container";
import {
  FlatResponseContainer,
  ParamsWithInput,
  ParamsWithLoader,
  ResponseError,
  StatefulObservable,
  StatefulObservableParams,
} from "./types";

const expandInput = <Input, Response>(
  params: StatefulObservableParams<Input, Response>,
): ParamsWithInput<Input, Response> | ParamsWithLoader<Input, Response> => {
  if (typeof params === "function") return { loader: params };
  if (isObservable(params)) return { input: params };
  return params;
};

export const flattenResponse = <Response, Error>(
  response: ResponseError<Error> | Response,
): FlatResponseContainer<Response, Error> => {
  if (isError(response)) {
    return { error: response.error };
  }
  return { value: response };
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
 * @param {(i: Input) => any[]} [options.cacheKey] - Optional cache key generator. Return an array of values which will be joined to form the cache key.
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
 * More examples:
 * @see https://github.com/earthdmitriy/stateful-observable/blob/main/docs/recipes.md
 */
export const statefulObservable = <Input, Response = Input>(
  options: StatefulObservableParams<Input, Response>,
): StatefulObservable<Response, unknown> => {
  const {
    input,
    loader,
    mapOperator = switchMap,
    cacheKey = () => [] as never[], // falsy cache key will skip caching
    cacheSize = 42,
    name = "unnamed",
    log,
  } = expandInput(options);

  const source$ = input ?? of(true as Input);
  const cache$ = new BehaviorSubject(createCache<Response>(cacheSize));

  const loading$ = combineLatest([source$, cache$]).pipe(
    mapToLoading(),
    catchResponseError(),
  ); // source can throw errors too

  const makeObservableInput = (input: Input) =>
    loader ? loader(input) : of(input as unknown as Response);

  const valueOrError$ = combineLatest([source$, cache$]).pipe(
    map(([input, cache]) => ({
      input,
      cache,
      key: cacheKey(input).join("|"),
    })),
    mapOperator(({ input, cache, key }) => {
      if (log) log({ input }, name, 0);
      if (key) {
        // skip if no cache key
        const cached = cache.get(key);
        if (cached) return of(cached);
      }

      return from(makeObservableInput(input)).pipe(
        tap({
          next: (result) => cache.set(key, result),
        }),
        catchResponseError(),
      );
    }),
    catchResponseError(),
    tap((raw) => {
      if (log) log(flattenResponse(raw), name, 0);
    }),
  );

  const raw = merge(loading$, valueOrError$);
  const meta = [{ errorSubscriptions: 0 }];

  return fillStatefulObservable<Response, unknown>({
    raw,
    name,
    meta,
    log,
    index: -1, // will be incremented to 0 in fillStatefulObservable
    reload: () => cache$.next(createCache<Response>(cacheSize)),
  });
};
