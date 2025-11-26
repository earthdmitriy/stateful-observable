import {
  BehaviorSubject,
  combineLatest,
  from,
  map,
  merge, Observable,
  ObservableInput,
  ObservedValueOf,
  of,
  OperatorFunction,
  switchMap,
  tap
} from "rxjs";
import { createCache } from "./cache";
import { fillStatefulObservable } from "./chaining";
import { catchResponseError, mapToLoading } from "./operators";
import { StatefulObservable } from "./types";

type TmapOperator = <T, O extends ObservableInput<any>>(
  project: (value: T, index: number) => O
) => OperatorFunction<T, ObservedValueOf<O>>;

/**
 * Parameters when an `input` observable is provided.
 *
 * @template Input - type of values produced by the input observable
 * @template Response - type produced by the loader or passed through when no loader is used
 */
type ParamsWithInput<Input, Response> = {
  /**
   * Source observable that drives requests/values.
   * When provided, every emission from this observable will be processed
   * by the loader (if present) or passed through as the response.
   */
  input: Observable<Input>;

  /**
   * Optional function that returns a cache key for a given input value.
   * The returned array is joined internally to form a string key. If the
   * function returns a falsy/empty array the caching logic will be skipped
   * for that input.
   */
  cacheKey?: (i: Input) => any[];

  /**
   * Maximum number of entries to keep in the internal cache. Defaults to the
   * value supplied by the factory (42 in the implementation).
   */
  cacheSize?: number;

  /**
   * Optional loader that maps an input value to an ObservableInput of Response.
   * If omitted the input value itself is used as the response value.
   */
  loader?: (input: Input) => ObservableInput<Response>;

  /**
   * Operator used to map input -> response observable. Defaults to `switchMap`.
   * Accepts a project function that returns an ObservableInput and converts it
   * into an operator function compatible with RxJS pipe.
   */
  mapOperator?: TmapOperator;
};

/**
 * Parameters when a `loader` function is required but `input` is optional.
 *
 * This variant allows creating a stateful observable that starts from a
 * constant trigger (when `input` is not provided) but still requires a
 * `loader` to produce responses from an input value.
 */
type ParamsWithLoader<Input, Response> = {
  /**
   * Optional source observable. If omitted the implementation will use a
   * single default trigger (e.g. `of(true as Input)`) so the loader is still
   * invoked when the stateful observable is subscribed/reloaded.
   */
  input?: Observable<Input>;

  /**
   * Optional cache key generator for the input value. See `ParamsWithInput`.
   */
  cacheKey?: (i: Input) => any[];

  /**
   * Maximum number of cache entries to retain. See `ParamsWithInput`.
   */
  cacheSize?: number;

  /**
   * Loader function which must be provided for this parameter shape. It maps
   * an input to an ObservableInput of Response. The result will be consumed
   * and cached according to the cache settings.
   */
  loader: (input: Input) => ObservableInput<Response>;

  /**
   * Operator used to map input -> response observable. Defaults to `switchMap`.
   */
  mapOperator?: TmapOperator;
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
 * @returns {StatefulObservable<Response, Error = unknown>} A stateful observable exposing typed streams and helpers.
 *
 * @remarks
 * - Errors thrown by the source or loader are converted to `ResponseError` values so the stream does not error out.
 * - A loading sentinel is emitted while an async loader is in-flight.
 * - Caching is optional and controlled by `cacheKey` + `cacheSize`.
 *
 * @example
 * const store = statefulObservable({
 *   input: myId$,
 *   loader: id => http.get(`/items/${id}`),
 *   cacheKey: id => [id],
 *   cacheSize: 100,
 * });
 * 
 * More examples:
 * @see https://github.com/earthdmitriy/stateful-observable/blob/main/docs/recipes.md
 */
export const statefulObservable = <Input, Response = Input>(
  options: ParamsWithInput<Input, Response> | ParamsWithLoader<Input, Response>
): StatefulObservable<Response, unknown> => {
  const {
    input,
    loader,
    mapOperator = switchMap,
    cacheKey = () => [], // falsy cache key will skip caching
    cacheSize = 42,
  } = options;

  const source$ = input ?? of(true as Input);
  const cache$ = new BehaviorSubject(createCache<Response>(cacheSize));

  const loading$ = combineLatest([source$, cache$]).pipe(
    mapToLoading(),
    catchResponseError()
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
      if (key) {
        // skip if no cache key
        const cached = cache.get(key);
        if (cached) return of(cached);
      }

      return from(makeObservableInput(input)).pipe(
        tap({
          next: (result) => cache.set(key, result),
        }),
        catchResponseError()
      );
    }),
    catchResponseError()
  );

  const raw = merge(loading$, valueOrError$);

  return fillStatefulObservable<Response, unknown>(raw, () =>
    cache$.next(createCache<Response>(cacheSize))
  );
};
