import { filter, map, Observable, tap } from "rxjs";
import { defaultCache, pipeError, pipeRaw, pipeValue } from "./operators";
import {
  isError,
  isInactive,
  isLoading,
  isSuccess,
  metaSymbol,
  serializeResponse,
} from "./response-container";
import { makeSubscribe } from "./subscribable";
import {
  LogFn,
  MetaInfo,
  PipeErrorOperator,
  PipeRawOperator,
  PipeValueOperator,
  ReloadOptions,
  ResponseWithStatus,
  StatefulObservable,
} from "./types";

// polyfill for InteropObservable
const observable = (() =>
  (typeof Symbol === "function" && Symbol.observable) || "@@observable")();

/*
 * Internal function.
 * Takes raw stream with additional params and makes public instance of statefulObservable
 */
export const fillStatefulObservable = <Result, Error, Meta = undefined>({
  raw,
  name,
  meta,
  internalMeta,
  log,
  index: prevIndex,
  reload,
  refCount,
  trackConsumers,
}: {
  raw: Observable<ResponseWithStatus<Result, Error>>;
  name: string;
  meta?: Meta;
  internalMeta: MetaInfo[];
  index: number;
  log?: LogFn<Result, Error>;
  reload: (options?: ReloadOptions) => void;
  refCount: boolean;
  /**
   * Called when a consumer subscribes to this node (directly or through a
   * stream derived from it) and when that subscription ends. Counted after the
   * shared cache, so it reflects consumers even with `refCount: false`.
   */
  trackConsumers?: {
    readonly onSubscribe: () => void;
    readonly onEnd: () => void;
  };
}): StatefulObservable<Result, Error, Meta> => {
  const index = prevIndex + 1;

  const sideEffect = log
    ? tap<ResponseWithStatus<Result, Error>>((value) =>
        log(serializeResponse(value), name, index),
      )
    : tap<ResponseWithStatus<Result, Error>>((value) => {
        if (isError(value) && !internalMeta.some((m) => m.errorSubscriptions)) {
          // Log errors even if they are filtered out later, but only if there are active error subscribers
          console.error(
            `Unhandled error in statefulObservable '${name} #${index}'\nSubscribe to the 'error$' stream to handle and silence these errors.\nError details:`,
            value.error,
          );
        }
      });

  const shared$ = raw.pipe(sideEffect, defaultCache(refCount));
  const cachedRaw$ = trackConsumers
    ? shared$.pipe(
        tap({
          subscribe: trackConsumers.onSubscribe,
          finalize: trackConsumers.onEnd,
        }),
      )
    : shared$;

  // Checks `where` against this node before delegating. A match reloads the
  // whole subtree (`where` is dropped); otherwise the search continues with
  // `where` intact. Children get this checked reload, so pipes and `.with`
  // nodes are checked too.
  const checkedReload = (options?: ReloadOptions) => {
    // a path still to follow is resolved first; `where` applies only after it
    if (options?.path?.length) {
      reload(options);
      return;
    }
    const where = options?.where;
    if (where && where({ name, meta })) {
      reload(options.onlyFailed ? { onlyFailed: true } : undefined);
      return;
    }
    reload(options);
  };

  const subscribe = makeSubscribe(cachedRaw$);

  return {
    raw$: cachedRaw$,
    name,
    meta,
    [metaSymbol]: internalMeta,
    index,
    reload: checkedReload,

    value$: cachedRaw$.pipe(filter(isSuccess)),
    error$: cachedRaw$.pipe(
      tap({
        subscribe: () => {
          internalMeta.forEach((m) => m.errorSubscriptions++);
        },
        unsubscribe: () => {
          internalMeta.forEach((m) => m.errorSubscriptions--);
        },
      }),
      filter((e) => !isLoading(e) && !isInactive(e)),
      map((e) => (isError(e) ? (e.error as Error) : false)),
    ),
    pending$: cachedRaw$.pipe(
      filter((e) => !isInactive(e)),
      map(isLoading),
    ),

    pipe: (...args: Parameters<PipeRawOperator>) =>
      fillStatefulObservable({
        raw: cachedRaw$.pipe(pipeRaw(...args)),
        name,
        meta,
        internalMeta,
        index,
        reload: checkedReload,
        refCount,
      }),

    pipeValue: (...args: Parameters<PipeValueOperator>) =>
      fillStatefulObservable({
        raw: cachedRaw$.pipe(pipeValue(...args)),
        name,
        meta,
        internalMeta,
        index,
        reload: checkedReload,
        refCount,
      }),

    pipeError: (...args: Parameters<PipeErrorOperator>) =>
      fillStatefulObservable({
        raw: cachedRaw$.pipe(pipeError(...args)),
        name,
        meta,
        internalMeta,
        index,
        reload: checkedReload,
        refCount,
      }),

    with: (options: { name?: string; meta?: Meta }) =>
      fillStatefulObservable({
        raw: cachedRaw$,
        name: options.name ?? name,
        meta: "meta" in options ? options.meta : meta,
        internalMeta,
        index,
        reload: checkedReload,
        refCount,
      }),

    subscribe,
    [observable]: () => ({
      subscribe,
    }),

    forEach: (next: (value: Result) => void) =>
      cachedRaw$.forEach((x) => isSuccess(x) && next(x)),
  } as unknown as StatefulObservable<Result, Error, Meta>;
};
