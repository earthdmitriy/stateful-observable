import {
  BehaviorSubject,
  catchError,
  concatMap,
  from,
  Observable,
  ObservableInput,
  of,
  switchMap,
} from "rxjs";
import { fillStatefulObservable } from "./fillStatefulObservable";
import { errorEvent, inactiveEvent, loadingEvent } from "./response-container";
import { ResponseWithStatus, StatefulObservable } from "./types";

export type ConnectableSource<T, E = unknown> =
  StatefulObservable<T, E> | ObservableInput<T>;

export type StatefulConnection<
  T,
  E = unknown,
  Meta = undefined,
> = StatefulObservable<T, E, Meta> & {
  connect(source: ConnectableSource<T, E>): void;
  disconnect(): void;
};

const isStatefulObservableFn = <T, E>(
  source: ConnectableSource<T, E>,
): source is StatefulObservable<T, E> => {
  if (typeof source !== "object" || source === null) {
    return false;
  }

  if (!("raw$" in source) || !("reload" in source)) {
    return false;
  }

  return typeof source.reload === "function";
};

export const statefulConnection = <T, E = unknown, Meta = undefined>(options?: {
  name?: string;
  refCount?: boolean;
  meta?: Meta;
}): StatefulConnection<T, E, Meta> => {
  const { name = "connection", refCount = true, meta } = options ?? {};

  const source$ = new BehaviorSubject<ConnectableSource<T, E> | null>(null);

  const disconnect = () => {
    source$.next(null);
  };

  const connect = (source: ConnectableSource<T, E>) => source$.next(source);

  const raw = source$.pipe(
    switchMap((source): Observable<ResponseWithStatus<T, E>> => {
      if (!source) {
        return of(inactiveEvent());
      }

      if (isStatefulObservableFn(source)) {
        return source.raw$;
      } else {
        return from(source).pipe(
          concatMap((event) => [loadingEvent(), event]),
          catchError((error: E) => of(errorEvent(error))),
        );
      }
    }),
  );

  const connection = fillStatefulObservable<T, E, Meta>({
    raw,
    name,
    meta: meta as Meta,
    internalMeta: [{ errorSubscriptions: 0, refCount }],
    index: -1,
    reload: () => {},
    refCount,
  });

  return { ...connection, connect, disconnect };
};
