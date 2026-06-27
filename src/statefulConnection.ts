import {
  BehaviorSubject,
  from,
  isObservable,
  ObservableInput,
  Unsubscribable,
} from "rxjs";
import { fillStatefulObservable } from "./fillStatefulObservable";
import { catchResponseError } from "./operators";
import {
  errorSymbol,
  inactiveSymbol,
  isError,
  loadingSymbol,
} from "./response-container";
import {
  ObserverWithPending,
  ResponseError,
  ResponseWithStatus,
  StatefulObservable,
} from "./types";

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

const makeRelayObserver = <T, E>(
  relay$: BehaviorSubject<ResponseWithStatus<T, E>>,
): Partial<ObserverWithPending<T>> => ({
  active: (active) => {
    if (!active) relay$.next({ state: inactiveSymbol });
  },
  pending: (pending) => {
    if (pending) relay$.next({ state: loadingSymbol });
  },
  next: (value) => {
    relay$.next(value);
  },
  error: (error) => {
    relay$.next({ state: errorSymbol, error } as ResponseError<E>);
  },
});

export const statefulConnection = <T, E = unknown, Meta = undefined>(options?: {
  name?: string;
  refCount?: boolean;
  meta: Meta;
}): StatefulConnection<T, E, Meta> => {
  const { name = "connection", refCount = true, meta } = options ?? {};

  const relay$ = new BehaviorSubject<ResponseWithStatus<T, E>>({
    state: inactiveSymbol,
  });

  let sourceSub: Unsubscribable | undefined;

  const disconnect = () => {
    sourceSub?.unsubscribe();
    sourceSub = undefined;
    relay$.next({ state: inactiveSymbol });
  };

  const connect = (source: ConnectableSource<T, E>) => {
    disconnect();

    const isObservale = isObservable(source);
    const isStatefulObservable = isStatefulObservableFn(source);

    const relayObserver = makeRelayObserver(relay$);

    if (isStatefulObservable) {
      sourceSub = source.subscribe(relayObserver);
      return;
    }

    // pending until first value from source
    relayObserver.pending?.(true);

    sourceSub = from(source)
      .pipe(catchResponseError())
      .subscribe({
        next: (event) => {
          if (isError(event)) {
            relayObserver.error?.(event.error as E);
            return;
          }

          relayObserver.next?.(event);
        },
        error: (error) => {
          relayObserver.error?.(error as E);
        },
      });
  };

  const connection = fillStatefulObservable<T, E, Meta>({
    raw: relay$,
    name,
    meta: meta as Meta,
    internalMeta: [{ errorSubscriptions: 0, refCount }],
    index: -1,
    reload: () => {},
    refCount,
  });

  return { ...connection, connect, disconnect };
};
