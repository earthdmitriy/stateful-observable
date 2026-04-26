import { filter, map, Observable, tap } from "rxjs";
import { defaultCache, pipeError, pipeRaw, pipeValue } from "./operators";
import {
  isError,
  isInactive,
  isLoading,
  isSuccess,
  metaSymbol,
} from "./response-container";
import { flattenResponse } from "./statefulObservable";
import { makeSubscribe } from "./subscribable";
import {
  LogFn,
  MetaInfo,
  PipeErrorOperator,
  PipeRawOperator,
  PipeValueOperator,
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
export const fillStatefulObservable = <Result, Error>({
  raw,
  name,
  meta,
  log,
  index: prevIndex,
  reload,
  refCount,
}: {
  raw: Observable<ResponseWithStatus<Result, Error>>;
  name: string;
  meta: MetaInfo[];
  index: number;
  log?: LogFn<Result, Error>;
  reload: () => void;
  refCount: boolean;
}): StatefulObservable<Result, Error> => {
  const index = prevIndex + 1;

  const sideEffect = log
    ? tap<ResponseWithStatus<Result, Error>>(
        (value) =>
          !isLoading(value) &&
          !isInactive(value) &&
          log(flattenResponse(value), name, index),
      )
    : tap<ResponseWithStatus<Result, Error>>((value) => {
        if (isError(value) && !meta.some((m) => m.errorSubscriptions)) {
          // Log errors even if they are filtered out later, but only if there are active error subscribers
          console.error(
            `Unhandled error in statefulObservable '${name} #${index}'\nSubscribe to the 'error$' stream to handle and silence these errors.\nError details:`,
            value.error,
          );
        }
      });

  const cachedRaw$ = raw.pipe(sideEffect, defaultCache(refCount));

  const subscribe = makeSubscribe(cachedRaw$);

  return {
    raw$: cachedRaw$,
    name,
    [metaSymbol]: meta,
    index,
    reload,

    value$: cachedRaw$.pipe(filter(isSuccess)),
    error$: cachedRaw$.pipe(
      tap({
        subscribe: () => {
          meta.forEach((m) => m.errorSubscriptions++);
        },
        unsubscribe: () => {
          meta.forEach((m) => m.errorSubscriptions--);
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
        index,
        reload,
        refCount,
      }),

    pipeValue: (...args: Parameters<PipeValueOperator>) =>
      fillStatefulObservable({
        raw: cachedRaw$.pipe(pipeValue(...args)),
        name,
        meta,
        index,
        reload,
        refCount,
      }),

    pipeError: (...args: Parameters<PipeErrorOperator>) =>
      fillStatefulObservable({
        raw: cachedRaw$.pipe(pipeError(...args)),
        name,
        meta,
        index,
        reload,
        refCount,
      }),

    subscribe,
    [observable]: () => ({
      subscribe,
    }),

    forEach: (next: (value: Result) => void) =>
      cachedRaw$.forEach((x) => isSuccess(x) && next(x)),
  } as unknown as StatefulObservable<Result, Error>;
};
