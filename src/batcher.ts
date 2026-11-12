import {
  defer,
  map,
  Observable,
  ObservableInput,
  Subscriber,
  Subscription,
} from "rxjs";

export type BatchId = string | number;

export type Batcher<Id extends BatchId, Response> = {
  /**
   * A cold stream of the item with this id. Subscribing queues the id for the
   * next batch; the stream emits the item every time a response of its batch
   * contains it, completes with the batch, and errors when the batch fails or
   * completes without the item. Unsubscribing before the batch is sent takes
   * the id out of it; when every request of a sent batch has unsubscribed,
   * the batch request is cancelled.
   */
  readonly request: (id: Id) => Observable<Response>;
};

type QueuedRequest<Id extends BatchId, Response> = {
  readonly id: Id;
  readonly key: string;
  readonly subscriber: Subscriber<Response>;
  /** Called once the request is sent, with its way out of the batch. */
  readonly attach: (detach: () => void) => void;
};

/** Ids match by `String(id)`, so `1` and `"1"` are the same item. */
export const batchKeyOf = (id: BatchId): string => String(id);

/** The error a request gets when its batch completes without its item. */
export const missingBatchItemError = (id: BatchId): Error =>
  new Error(`Batch response has no item with id ${JSON.stringify(id)}`);

const chunk = <T>(items: readonly T[], size: number): readonly T[][] =>
  items.length <= size
    ? [items.slice()]
    : Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
        items.slice(index * size, index * size + size),
      );

/**
 * Collects the ids requested within `batchTime` ms (counted from the first
 * one, not restarted by later ones) and loads them with one `loader` call per
 * `maxBatchSize` unique ids. Items of the response are matched to requests
 * with `idOf`.
 */
export const createBatcher = <Id extends BatchId, Response>(params: {
  readonly loader: (ids: readonly Id[]) => ObservableInput<readonly Response[]>;
  readonly idOf: (item: Response) => Id;
  readonly batchTime: number;
  readonly maxBatchSize: number;
}): Batcher<Id, Response> => {
  const maxBatchSize = Math.max(1, Math.floor(params.maxBatchSize));
  let queue: readonly QueuedRequest<Id, Response>[] = [];
  let pendingFlush: ReturnType<typeof setTimeout> | undefined;

  const send = (
    requests: readonly QueuedRequest<Id, Response>[],
    ids: readonly Id[],
  ) => {
    // requests still waiting for this batch
    const waiting = new Set(requests);
    const received = new Set<string>();
    let finished = false;
    let subscription: Subscription | undefined;

    const settle = (
      end: (request: QueuedRequest<Id, Response>) => void,
    ): void => {
      finished = true;
      // a snapshot: ending a request detaches it from `waiting`
      Array.from(waiting).forEach(end);
    };

    // attached first: a synchronous loader can end requests while subscribing
    requests.forEach((request) =>
      request.attach(() => {
        waiting.delete(request);
        if (!finished && waiting.size === 0) subscription?.unsubscribe();
      }),
    );

    subscription = defer(() => params.loader(ids))
      .pipe(
        // indexed in the pipe, so a throw in `idOf` fails this batch
        map(
          (items) =>
            // boxed, so an item that is itself `undefined` is still found
            new Map(
              items.map((item) => [batchKeyOf(params.idOf(item)), { item }]),
            ),
        ),
      )
      .subscribe({
        next: (byKey) => {
          Array.from(waiting).forEach((request) => {
            const found = byKey.get(request.key);
            if (!found) return;
            received.add(request.key);
            request.subscriber.next(found.item);
          });
        },
        error: (error: unknown) => {
          settle((request) => request.subscriber.error(error));
        },
        complete: () => {
          settle((request) => {
            if (received.has(request.key)) request.subscriber.complete();
            else request.subscriber.error(missingBatchItemError(request.id));
          });
        },
      });
    // every request may have left while a synchronous loader was emitting
    if (!finished && waiting.size === 0) subscription.unsubscribe();
  };

  const flush = () => {
    pendingFlush = undefined;
    const requests = queue;
    queue = [];
    // the first request of each id, in the order requested
    const seen = new Set<string>();
    const firsts = requests.filter(
      (request) => !seen.has(request.key) && !!seen.add(request.key),
    );
    chunk(firsts, maxBatchSize).forEach((chunkFirsts) => {
      const inChunk = new Set(chunkFirsts.map((request) => request.key));
      send(
        requests.filter((request) => inChunk.has(request.key)),
        chunkFirsts.map((request) => request.id),
      );
    });
  };

  const request = (id: Id): Observable<Response> =>
    new Observable<Response>((subscriber) => {
      let detach: (() => void) | undefined;
      const queued: QueuedRequest<Id, Response> = {
        id,
        key: batchKeyOf(id),
        subscriber,
        attach: (fn) => {
          detach = fn;
        },
      };
      queue = [...queue, queued];
      pendingFlush ??= setTimeout(flush, params.batchTime);

      return () => {
        if (detach) {
          detach();
          return;
        }
        queue = queue.filter((other) => other !== queued);
        if (queue.length === 0) {
          clearTimeout(pendingFlush);
          pendingFlush = undefined;
        }
      };
    });

  return { request };
};
