import {
  concat,
  NEVER,
  Observable,
  ObservableInput,
  of,
  Subject,
  takeUntil,
} from "rxjs";
import { createCache, encodeCacheKey } from "./cache";
import { fillStatefulObservable } from "./fillStatefulObservable";
import { metaSymbol } from "./response-container";
import { statefulObservable } from "./statefulObservable";
import { MetaInfo, StatefulObservable, TmapOperator } from "./types";

const isMetaInfoList = (value: unknown): value is MetaInfo[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "errorSubscriptions" in item &&
      "refCount" in item,
  );

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
 * Factory to create and reuse stateful observables with internal caching.
 * @param {Object} params - Configuration object.
 * @param {Function} params.loader - Loader function which must be provided for this parameter shape. It maps
 * an input to an ObservableInput of Response. The result will be consumed
 * and cached according to the cache settings.
 * @param {Function} [params.cacheKey] - Function to generate a cache key from an input. If not provided, the input itself
 * will be used as the cache key. The key is encoded as JSON, so object inputs are keyed by content; parts must be
 * JSON-serializable.
 * @param {number} [params.cacheSize=42] - Maximum number of cache entries to retain. Entries that have consumers
 * are not evicted, so the cache can temporarily hold more while that many streams are in use.
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
   * Option to temporary shut down observable.
   * While `false` (inactive) statefule observable will keep all subscriptions alive, but wan't emit any events on them
   * Use it temporarily disable dataflow in case if user logged out, auth token expired and waiting for renewal, or sometging else.
   */
  active?: Observable<boolean>;

  /**
   * Optional refCount.
   * Default: true
   */
  refCount?: boolean;

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
  type Entry = {
    readonly stream: StatefulObservable<Response>;
    readonly hasSubscribers: () => boolean;
    readonly isFresh: () => boolean;
  };
  // Entries with consumers are never evicted, so a live stream is not
  // duplicated by the next `get` for its key. A new entry is also kept for one
  // tick, so a burst of `get` calls (one render pass) cannot evict an entry
  // before its consumer subscribes.
  const cache = createCache<Entry>(
    params.cacheSize ?? 42,
    (entry) => !entry.hasSubscribers() && !entry.isFresh(),
  );
  const complete$ = new Subject<void>();

  const get = (input: Input): StatefulObservable<Response> => {
    const key = encodeCacheKey((params.cacheKey ?? ((x) => [x]))(input));
    const cached = cache.lookup(key);
    if (cached.hit) return cached.value.stream;

    // Counts consumers of the returned stream (and of streams derived from
    // it). It is counted after the shared cache, so with `refCount: false` a
    // kept source does not count as a consumer.
    let consumers = 0;
    const refCount = params.refCount ?? true;
    const base = statefulObservable<Input, Response>({
      input: concat(of(input), NEVER),
      loader: params.loader,
      mapOperator: params.mapOperator,
      active: params.active,
      refCount,
    });
    // End the raw stream when the factory is force-reset. This has to be
    // done on the raw stream: a `takeUntil` passed to `.pipe(...)` only ends
    // the operator pipeline, which does not complete the node's consumers.
    const baseMeta = base[metaSymbol];
    const stream = fillStatefulObservable<Response, unknown>({
      raw: base.raw$.pipe(takeUntil(complete$)),
      name: base.name,
      meta: base.meta,
      internalMeta: isMetaInfoList(baseMeta)
        ? baseMeta
        : [{ errorSubscriptions: 0, refCount }],
      index: base.index,
      reload: base.reload,
      refCount,
      trackConsumers: {
        onSubscribe: () => {
          consumers++;
        },
        onEnd: () => {
          consumers--;
        },
      },
    });
    let fresh = true;
    void Promise.resolve().then(() => {
      fresh = false;
    });
    cache.set(key, {
      stream,
      hasSubscribers: () => consumers > 0,
      isFresh: () => fresh,
    });
    return stream;
  };

  const reset = (force: boolean) => {
    // complete all existing streams if force reset
    if (force) complete$.next();
    // by default only reset entries with no subscribers
    cache.reset(force ? undefined : (entry) => !entry.hasSubscribers());
  };

  const reload = () => {
    cache.getAll().forEach(({ stream }) => {
      stream.reload();
    });
  };

  return { get, reset, reload };
};
