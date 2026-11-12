import {
  identity,
  merge,
  Observable,
  ObservableInput,
  ReplaySubject,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
} from "rxjs";
import { createCache, encodeCacheKey } from "./cache";
import { combineStatefulObservables } from "./combineStatefulObservables";
import { isMetaInfoList } from "./errorWatcher";
import { fillStatefulObservable } from "./fillStatefulObservable";
import { keepSettled } from "./keepSettled";
import { onFirstInactive, switchOverlapping } from "./operators";
import { projection } from "./projection";
import { metaSymbol } from "./response-container";
import { statefulObservable } from "./statefulObservable";
import type {
  ProjectCombine,
  ProjectManyCombine,
  StatefulObservable,
  StatefulObservableFactory,
  TmapOperator,
} from "./types";

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
 *
 * // an input-driven stream that shows the same entries as `get`
 * const item$ = factory.project(id$); // id$: Observable<number>
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
   * While `false` (inactive) stateful observable will keep all subscriptions alive, but won't emit any events on them
   * Use it temporarily disable dataflow in case if user logged out, auth token expired and waiting for renewal, or sometging else.
   */
  active?: Observable<boolean>;

  /**
   * Whether an entry stays connected to its loader after its last consumer
   * leaves.
   *
   * - `true` (default): the entry disconnects, so a load still in flight is
   *   cancelled. A load that has completed is kept: a consumer that comes back
   *   gets that value synchronously, with no new request. A loader that has
   *   not completed (a stream, or a request cut off) starts again.
   * - `false`: the entry stays connected until it leaves the cache, so a load
   *   in flight runs to the end and a streaming loader keeps emitting. Use it
   *   for live streams, prefetching, or work that must finish.
   *
   * Either way a kept value is dropped by `reload()`, by `active: false`, and
   * when the entry leaves the cache (`cacheSize`, `reset`). Errors are not kept.
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

  /**
   * A name for debugging, given to every entry and to the streams made with
   * `project` and `projectMany`, so it shows in logs and `reload({ where })`
   * can match it. Default: "unnamed".
   */
  name?: string;
}): StatefulObservableFactory<Input, Response> => {
  type Entry = {
    readonly stream: StatefulObservable<Response>;
    readonly hasSubscribers: () => boolean;
    readonly isFresh: () => boolean;
    /** Drops the value of the last completed load. */
    readonly forget: () => void;
    /** Ends the entry's subscriptions once it has left the cache. */
    readonly dispose: () => void;
  };
  // Entries with consumers are never evicted, so a live stream is not
  // duplicated by the next `get` for its key. A new entry is also kept for one
  // tick, so a burst of `get` calls (one render pass) cannot evict an entry
  // before its consumer subscribes.
  const cache = createCache<Entry>(
    params.cacheSize ?? 42,
    (entry) => !entry.hasSubscribers() && !entry.isFresh(),
    (entry) => entry.dispose(),
  );
  const complete$ = new Subject<void>();
  const refCount = params.refCount ?? true;
  const keyOf = params.cacheKey ?? ((x: Input) => [x]);
  const name = params.name ?? "unnamed";
  // The keys of a projected value, to tell a value that needs other entries
  // from one that only carries other data; `undefined` when `key` or
  // `cacheKey` throws, so the projection opens it and reports the throw.
  const signatureOf = (keys: () => unknown[]): string | undefined => {
    try {
      return encodeCacheKey(keys());
    } catch {
      return undefined;
    }
  };

  // Kept values may belong to the previous user, so they are dropped on the
  // first `active: false`, also when no entry is subscribed (then the entries
  // do not see `active`). One watch for the whole factory, held only while
  // some entry may keep a value; it ends on the first `false`.
  let logoutWatch: Subscription | undefined;
  const watchInactivity = () => {
    if (!params.active || (logoutWatch && !logoutWatch.closed)) return;
    logoutWatch = onFirstInactive(params.active, () => {
      cache.getAll().forEach((entry) => entry.forget());
    });
  };

  const get = (input: Input): StatefulObservable<Response> => {
    const key = encodeCacheKey(keyOf(input));
    const cached = cache.lookup(key);
    if (cached.hit) return cached.value.stream;

    // Counts consumers of the returned stream (and of streams derived from
    // it). It is counted after the shared cache, so with `refCount: false` a
    // kept source does not count as a consumer.
    let consumers = 0;
    // A completed load is kept and served to the next subscriber; a load in
    // flight is cancelled when the last subscriber leaves.
    const { loader, forget } = keepSettled(params.loader, watchInactivity);
    const base = statefulObservable<Input, Response>({
      // one value, never completes
      input: new Observable<Input>((subscriber) => subscriber.next(input)),
      loader,
      mapOperator: params.mapOperator,
      name,
      active: params.active,
      refCount: true,
    });
    // With `refCount: false` the exposed node stays connected after its
    // consumers leave, so it is ended when the entry leaves the cache, and a
    // reference to it kept elsewhere cannot connect it again (the subject
    // replays). With `refCount: true` it disconnects on its own and may
    // connect again, so nothing needs ending.
    const removed$ = new ReplaySubject<void>(1);
    // as a root does: only a reload that reaches this entry drops its value
    const reload: StatefulObservable<Response>["reload"] = (options) => {
      if (!options?.where && !options?.path?.length) forget();
      base.reload(options);
    };
    const baseMeta = base[metaSymbol];
    const internalMeta = isMetaInfoList(baseMeta)
      ? baseMeta
      : [{ errorSubscriptions: 0, refCount }];
    // The list is shared with the base, which reads it for error logging, so
    // it is kept and only told the factory's `refCount` (read by
    // `combineStatefulObservables`). Nothing has seen the list yet.
    internalMeta.forEach((info) => {
      info.refCount = refCount;
    });
    // End the raw stream when the factory is force-reset or the entry leaves the
    // cache. This has to be done on the raw stream: a `takeUntil` passed to
    // `.pipe(...)` only ends the operator pipeline, which does not complete the
    // node's consumers.
    //
    // The base always releases its source when its last subscriber leaves; the
    // factory's `refCount` applies to the exposed node only. So ending the
    // exposed node's source here also unsubscribes the loader and `active`.
    // With a kept base (`refCount: false` there too) nothing could release them.
    const stream = fillStatefulObservable<Response, unknown>({
      raw: base.raw$.pipe(takeUntil(merge(complete$, removed$))),
      name: base.name,
      meta: base.meta,
      internalMeta,
      index: base.index,
      reload,
      refCount,
      trackConsumers: {
        onSubscribe: () => consumers++,
        onEnd: () => consumers--,
      },
    });
    let fresh = true;
    queueMicrotask(() => {
      fresh = false;
    });
    cache.set(key, {
      stream,
      hasSubscribers: () => consumers > 0,
      isFresh: () => fresh,
      forget,
      dispose: () => {
        // a reference kept elsewhere must not serve it after a logout
        forget();
        if (refCount) return;
        removed$.next();
        removed$.complete();
      },
    });
    return stream;
  };

  // The overloads of `project` and `projectMany` are declared on
  // `StatefulObservableFactory`; with no `combine`, `Result` is `never`, so the
  // value is `Response` (`Response[]`).
  //
  // A projection always releases when its last subscriber leaves. Keeping a
  // loaded value is the job of the entry, per the factory's `refCount`: a
  // projection that stayed connected would count as a consumer of its entry
  // for good, and the entry could never be reset or evicted.

  function project<Item extends Input, Result = never>(
    input: Observable<Item>,
    options?: {
      readonly key?: (item: Item) => Input;
      readonly combine?: ProjectCombine<Item, Response, Result>;
    },
  ): StatefulObservable<Result | Response> {
    const select = options?.key ?? identity;
    return projection({
      input,
      signatureOf: (item) => signatureOf(() => keyOf(select(item))),
      open: (item, watch) => {
        const entry = get(select(item));
        return { source: entry, release: watch(entry) };
      },
      combine: options?.combine,
      switcher: params.mapOperator ?? switchMap,
      complete$,
      name,
    });
  }

  function projectMany<Item extends Input, Result = never>(
    input: Observable<readonly Item[]>,
    options?: {
      readonly key?: (item: Item) => Input;
      readonly combine?: ProjectManyCombine<Item, Response, Result>;
    },
  ): StatefulObservable<Result | Response[]> {
    const select = options?.key ?? identity;
    return projection({
      input,
      signatureOf: (items) =>
        signatureOf(() => items.map((item) => keyOf(select(item)))),
      open: (items, watch) => {
        if (items.length === 0) return { value: [] };
        const entries = items.map((item) => get(select(item)));
        // before combining: the combination reads the entries' meta lists
        const unwatch = entries.map((entry) => watch(entry));
        return {
          source: combineStatefulObservables(entries, (results) => results),
          release: () => unwatch.forEach((remove) => remove()),
        };
      },
      combine: options?.combine,
      // an entry in both lists keeps its load in flight
      switcher: switchOverlapping,
      complete$,
      name,
    });
  }

  const reset = (force: boolean) => {
    // complete all existing streams if force reset
    if (force) complete$.next();
    // by default only reset entries with no subscribers
    cache.reset(force ? undefined : (entry) => !entry.hasSubscribers());
    if (cache.getAll().length === 0) logoutWatch?.unsubscribe();
  };

  const reload = () => {
    cache.getAll().forEach(({ stream }) => {
      stream.reload();
    });
  };

  return { get, project, projectMany, reset, reload };
};
