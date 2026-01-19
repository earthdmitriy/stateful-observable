import { ObservableInput, of, Subject, takeUntil, tap } from "rxjs";
import { createCache } from "./cache";
import { statefulObservable } from "./statefulObservable";
import { StatefulObservable, TmapOperator } from "./types";

type StatefulObservableFactory<Input, Response> = {
  /**
   * Create or retrieve a cached StatefulObservable for the given input.
   * @param input
   */
  get(input: Input): StatefulObservable<Response>;
  /**
   * Reset the cache. If `force` is true, all cached entries will be reset.
   * If `force` is false, only entries with no active subscribers will be reset.
   * @param force
   */
  reset(force: boolean): void;
  /**
   * Reload all cached StatefulObservables by invoking their loader functions again.
   */
  reload(): void;
};

/**
 * @experimental
 *
 * Factory to create and reuse stateful observables with internal caching.
 * @param {Object} params - Configuration object.
 * @param {Function} params.loader - Loader function which must be provided for this parameter shape. It maps
 * an input to an ObservableInput of Response. The result will be consumed
 * and cached according to the cache settings.
 * @param {Function} [params.cacheKey] - Function to generate a cache key from an input. If not provided, the input itself
 * will be used as the cache key.
 * @param {number} [params.cacheSize=42] - Maximum number of cache entries to retain.
 * @param {Function} [params.mapOperator=switchMap] - Operator used to map input -> response observable.
 *
 * @returns {StatefulObservableFactory<Input, Response>} A factory for creating and reusing stateful observables.
 *
 * @example
 * const factory = statefulObservableFactory<number, Item>({
 *   loader: (id) => http.get<Item>(`/items/${id}`),
 *   cacheKey: (id) => [id], // cache by item ID
 *   cacheSize: 100, // retain up to 100 items in cache
 * });
 *
 * const itemObservable = factory.get(42); // get stateful observable for item ID 42
 * const anotherItemObservable = factory.get(42); // reuses cached observable for item ID 42
 *
 * // reset cache entries with no active subscribers
 * factory.reset(false);
 *
 * // force reset all cache entries
 * factory.reset(true);
 */
export const statefulObservableFactory = <Input, Response>(params: {
  /**
   * Loader function which must be provided for this parameter shape. It maps
   * an input to an ObservableInput of Response. The result will be consumed
   * and cached according to the cache settings.
   */
  loader: (input: Input) => ObservableInput<Response>;
  /**
   * Function to generate a cache key from an input. If not provided, the input itself
   * will be used as the cache key.
   * @param i
   * @returns
   */
  cacheKey?: (i: Input) => any[];
  /**
   * Maximum number of cache entries to retain. See `ParamsWithInput`.
   */
  cacheSize?: number;

  /**
   * Operator used to map input -> response observable. Defaults to `switchMap`.
   */
  mapOperator?: TmapOperator;
}): StatefulObservableFactory<Input, Response> => {
  const cache = createCache<[StatefulObservable<Response>, number]>(
    params.cacheSize ?? 42,
  );
  const complete$ = new Subject<void>();

  const get = (input: Input): StatefulObservable<Response> => {
    const key = (params.cacheKey ?? ((x) => [x]))(input).join("|");
    return (
      cache.get(key)?.[0] ??
      (() => {
        let activeSubscriptions = 0;
        const stream = statefulObservable<Input, Response>({
          input: of(input),
          loader: params.loader,
          mapOperator: params.mapOperator,
        }).pipe(
          takeUntil(complete$),
          tap({
            subscribe: () => {
              activeSubscriptions++;
            },
            unsubscribe: () => {
              activeSubscriptions--;
            },
          }),
        );
        cache.set(key, [stream, activeSubscriptions]);
        return stream;
      })()
    );
  };

  const reset = (force: boolean) => {
    // complete all existing streams if force reset
    if (force) complete$.next();
    // by default only reset entries with no subscribers
    cache.reset(force ? undefined : ([_, subscribers]) => subscribers === 0);
  };

  const reload = () => {
    cache.getAll().forEach(([stream]) => {
      stream.reload();
    });
  };

  return { get, reset, reload };
};
