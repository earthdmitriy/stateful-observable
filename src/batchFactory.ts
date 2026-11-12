import type { Observable, ObservableInput } from "rxjs";
import { BatchId, batchKeyOf, createBatcher } from "./batcher";
import { statefulObservableFactory } from "./factory";
import type { StatefulObservableFactory, TmapOperator } from "./types";

/**
 * Factory of stateful observables per id, loaded in batches. Consumers use it
 * as `statefulObservableFactory` (`get`, `project`, `reset`, `reload`); only the
 * loader differs: it takes a list of ids and returns a list of items.
 *
 * Ids requested within `batchTime` ms are sent together. The window opens with
 * the first id and is not restarted by later ones, so a steady stream of
 * requests cannot hold a batch back. With the default `0` it collects the ids
 * requested in one tick (one render pass).
 *
 * Items of the response are matched to ids with `idOf`. Ids are compared as
 * strings, so an id `1` matches an item whose id is `"1"`. An id whose batch
 * completes without its item gets an error, as does every id of a failed
 * batch; reloading one entry requests only its own id again, and reloads that
 * fall into one window (as `factory.reload()` does) share one batch.
 *
 * @example
 * const products = statefulObservableBatchFactory({
 *   loader: (ids: readonly number[]) => http.get<Product[]>(`/products?ids=${ids.join(",")}`),
 *   idOf: (product) => product.id,
 *   batchTime: 10,
 *   maxBatchSize: 50,
 * });
 *
 * // one request for both
 * products.get(1).subscribe(render);
 * products.get(2).subscribe(render);
 */
export const statefulObservableBatchFactory = <
  Id extends BatchId,
  Response,
>(params: {
  /**
   * Loads the items of a batch. Gets every id once, in the order requested.
   * The response may leave ids out (they get an error) and may emit several
   * times (every emission updates the ids it contains).
   */
  readonly loader: (ids: readonly Id[]) => ObservableInput<readonly Response[]>;

  /** The id of an item of the response. */
  readonly idOf: (item: Response) => Id;

  /**
   * How long ids are collected, in ms, counted from the first id of a batch.
   * Default: 0 (one tick).
   */
  readonly batchTime?: number;

  /**
   * Most ids per loader call; a larger batch is split into several calls.
   * Default: no limit.
   */
  readonly maxBatchSize?: number;

  /** As in `statefulObservableFactory`. */
  readonly active?: Observable<boolean>;

  /** As in `statefulObservableFactory`. Default: true. */
  readonly refCount?: boolean;

  /** As in `statefulObservableFactory`. Default: 42. */
  readonly cacheSize?: number;

  /** As in `statefulObservableFactory`. Default: `switchMap`. */
  readonly mapOperator?: TmapOperator;

  /** As in `statefulObservableFactory`. Default: "unnamed". */
  readonly name?: string;
}): StatefulObservableFactory<Id, Response> => {
  const batcher = createBatcher<Id, Response>({
    loader: params.loader,
    idOf: params.idOf,
    batchTime: params.batchTime ?? 0,
    maxBatchSize: params.maxBatchSize ?? Infinity,
  });

  return statefulObservableFactory<Id, Response>({
    loader: batcher.request,
    // the same key the batcher matches items with
    cacheKey: (id) => [batchKeyOf(id)],
    active: params.active,
    refCount: params.refCount,
    cacheSize: params.cacheSize,
    mapOperator: params.mapOperator,
    name: params.name,
  });
};
