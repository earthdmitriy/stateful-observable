import {
  MonoTypeOperatorFunction,
  Observable,
  OperatorFunction,
  Subject,
  Subscriber,
  Subscription,
  catchError,
  of,
  shareReplay,
  startWith,
} from "rxjs";
import {
  errorSymbol,
  isError,
  isInactive,
  isLoading,
  isSuccess,
  loadingSymbol,
} from "./response-container";
import {
  PipeErrorOperator,
  PipeRawOperator,
  PipeValueOperator,
  ResponseError,
  ResponseLoading,
  ResponseWithStatus,
} from "./types";

/**
 * Subscribes to `source` and emits a loading sentinel only if nothing arrived
 * synchronously during the subscription. A synchronous result (a sync loader,
 * an input-only node, a cache hit) is emitted without a preceding loading
 * event; an asynchronous one is preceded by loading, as before.
 */
export const loadingUnlessSync = <T>(
  source: Observable<T>,
): Observable<T | ResponseLoading> =>
  new Observable<T | ResponseLoading>((subscriber) => {
    let emitted = false;
    const subscription = source.subscribe({
      next: (value) => {
        emitted = true;
        subscriber.next(value);
      },
      error: (error: unknown) => subscriber.error(error),
      complete: () => subscriber.complete(),
    });
    if (!emitted && !subscriber.closed) {
      subscriber.next({ state: loadingSymbol });
    }
    return subscription;
  });

/**
 * RxJS operator that catches any error from the upstream observable and
 * converts it into a ResponseError<unknown> value instead of letting the
 * stream error out.
 *
 * The operator leaves successful emissions of type T unchanged. If an error
 * occurs, it emits a single ResponseError<unknown> object constructed as:
 * { state: errorSymbol, error: <caught error> } and completes the stream.
 *
 * Use this when you want to represent errors as stream values (a "stateful"
 * error representation) rather than terminating the observable with an error.
 *
 * @typeParam T - Type of values emitted by the upstream observable.
 * @returns An OperatorFunction that maps Observable<T> to Observable<T | ResponseError<unknown>>.
 *
 * @remarks
 * - The returned observable will never error because upstream errors are
 *   transformed into a value of type ResponseError<unknown>.
 * - The wrapped error is stored in the `error` property of the ResponseError.
 * - The `state` property is set to `errorSymbol` to indicate the error state.
 *
 * @example
 * // source$: Observable<MyData>
 * // source$.pipe(catchResponseError<MyData>()) -> Observable<MyData | ResponseError<unknown>>
 */
export const catchResponseError = <T>(): OperatorFunction<
  T,
  T | ResponseError<unknown>
> =>
  catchError((error) =>
    of<ResponseError<unknown>>({ state: errorSymbol, error: error }),
  );

/**
 * Emits a loading sentinel before any values from the source observable.
 *
 * Prepends a ResponseLoading object ({ state: loadingSymbol }) to the stream so
 * subscribers receive an immediate "loading" state and then receive the actual
 * values emitted by the source. This is useful for UI/state management where a
 * loading indicator should be shown until the first real value arrives.
 *
 * @typeParam T - The type of values emitted by the source observable.
 * @returns An RxJS OperatorFunction that emits either a ResponseLoading or values of type T.
 *
 * @example
 * // Emits ResponseLoading first, then the source value(s)
 * source$.pipe(startWithLoading()).subscribe(value => {
 *   // value is ResponseLoading initially, then T values
 * });
 */
export const startWithLoading = <T>(): OperatorFunction<
  T,
  T | ResponseLoading
> => startWith({ state: loadingSymbol } as ResponseLoading);

/**
 * Wrapper for shareReplay with default parameters
 */
export const defaultCache = <T>(refCount = true): MonoTypeOperatorFunction<T> =>
  shareReplay({ bufferSize: 1, refCount });

// helper to apply an array of operator functions to an observable's pipe
export const applyPipe = <T, R = any>(
  obs: Observable<T>,
  operations: OperatorFunction<any, any>[],
): Observable<R> => (obs.pipe as any).apply(obs, operations) as Observable<R>;

/**
 * Drops a loading event that directly follows another loading event. A pipe
 * emits its own loading for asynchronous processing, which would otherwise
 * repeat the loading its parent already sent.
 */
const skipRepeatedLoading =
  <T>(): MonoTypeOperatorFunction<T> =>
  (source) =>
    new Observable<T>((subscriber) => {
      let lastWasLoading = false;
      return source.subscribe({
        next: (event) => {
          const loading = isLoading(event);
          if (!(loading && lastWasLoading)) subscriber.next(event);
          lastWasLoading = loading;
        },
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
    });

/**
 * Runs user operators as one long-lived pipeline per node, so operators that
 * keep state across values (`distinctUntilChanged`, `scan`, `startWith`) or
 * hold context (`shareReplay`, `share` with a reset delay) work as in plain
 * RxJS, while a failure stays local:
 * - events selected by `accept` are fed into the pipeline through a Subject;
 *   other events pass by it;
 * - an error inside the pipeline becomes an error event and only the pipeline
 *   is rebuilt (the Subject does not replay, so the failing event is not fed
 *   again);
 * - output that arrives after a newer event has passed by (a newer loading or
 *   error) is stale and dropped, until the next event is fed;
 * - `inactive` rebuilds the pipeline: work in flight is cancelled and
 *   operator state is reset;
 * - when a fed event produces no output synchronously, loading is emitted: the
 *   change was started and has no result yet (an asynchronous step, or a value
 *   dropped by an operator).
 *
 * Lifetime follows the operators: when the last subscriber leaves, the
 * upstream subscription is kept for as long as the operators stay subscribed
 * to the feed (a `shareReplay(1)` holds it, `map` lets go at once, a `share`
 * with a reset delay lets go later). A subscriber that comes back gets the
 * latest state: the operator's replay if it is current, otherwise the last
 * event.
 */
const isolatedPipeline =
  (
    operations: OperatorFunction<any, any>[],
    accept: (event: any) => boolean,
    extract: (event: any) => unknown,
    wrap: (output: any) => unknown,
  ) =>
  (raw: Observable<any>): Observable<any> => {
    // state of this node, shared by its subscriptions
    const downstream = new Set<Subscriber<any>>();
    let feed: Subject<unknown> | undefined;
    let pipeline$: Observable<unknown> | undefined;
    let generation = 0;
    let feedHolders = 0;
    let output: Subscription | undefined;
    let source: Subscription | undefined;
    let last: { readonly event: unknown } | undefined;
    let open = true;
    let answered = false;
    let sourceDone = false;

    const emit = (event: unknown) => {
      last = { event };
      downstream.forEach((subscriber) => subscriber.next(event));
    };

    const completeAll = () => {
      downstream.forEach((subscriber) => subscriber.complete());
    };

    const disconnect = () => {
      source?.unsubscribe();
      source = undefined;
      output?.unsubscribe();
      output = undefined;
      feed?.complete();
      feed = undefined;
      pipeline$ = undefined;
      last = undefined;
      open = true;
      sourceDone = false;
    };

    // nobody listens and the operators let go of the feed: release upstream
    const releaseIfIdle = () => {
      if (source && downstream.size === 0 && feedHolders === 0) disconnect();
    };

    const attach = () => {
      if (!pipeline$) return;
      output = pipeline$.subscribe({
        next: (value) => {
          answered = true;
          if (open) emit(wrap(value));
        },
        error: (error: unknown) => {
          answered = true;
          if (open) emit({ state: errorSymbol, error });
          build();
        },
        complete: () => {
          // the operators ended the stream (takeUntil, take, first, or the
          // source completed): complete the subscribers and release the
          // source, as in plain RxJS
          completeAll();
          disconnect();
        },
      });
    };

    const build = () => {
      feed?.complete(); // lets operators of the previous pipeline go
      const current = new Subject<unknown>();
      const own = ++generation;
      feed = current;
      feedHolders = 0;
      const held = new Observable<unknown>((subscriber) => {
        if (own === generation) feedHolders++;
        const subscription = current.subscribe(subscriber);
        return () => {
          subscription.unsubscribe();
          if (own === generation) {
            feedHolders--;
            releaseIfIdle();
          }
        };
      });
      pipeline$ = applyPipe(held, operations);
      output = undefined;
      if (downstream.size > 0) attach();
      if (sourceDone) current.complete();
    };

    const onEvent = (event: unknown) => {
      if (isInactive(event)) {
        open = false;
        output?.unsubscribe();
        build();
        emit(event);
        return;
      }
      if (accept(event)) {
        open = true;
        answered = false;
        feed?.next(extract(event));
        if (!answered) emit({ state: loadingSymbol });
        return;
      }
      open = false;
      emit(event);
    };

    const connect = () => {
      build();
      source = raw.subscribe({
        next: onEvent,
        error: (error: unknown) =>
          downstream.forEach((subscriber) => subscriber.error(error)),
        complete: () => {
          // the pipeline completes once its work is done, which completes
          // the subscribers (see attach)
          sourceDone = true;
          feed?.complete();
        },
      });
    };

    return new Observable<any>((subscriber) => {
      const before = last;
      downstream.add(subscriber);
      if (!source) {
        connect();
      } else if (!output) {
        // coming back to a pipeline kept alive by its operators
        attach();
        if (last === before && before) subscriber.next(before.event);
      } else if (before) {
        subscriber.next(before.event); // joining while others listen
      }
      return () => {
        downstream.delete(subscriber);
        if (downstream.size === 0) {
          output?.unsubscribe();
          output = undefined;
          releaseIfIdle();
        }
      };
    }).pipe(skipRepeatedLoading());
  };

export const pipeRaw: PipeRawOperator = (...operations) =>
  isolatedPipeline(
    operations,
    () => true,
    (event) => event,
    (output) => output,
  );

export const pipeValue: PipeValueOperator = (
  ...operations: OperatorFunction<any, any>[]
) =>
  isolatedPipeline(
    operations,
    (event) => isSuccess(event),
    (event) => event,
    (output) => output,
  );

export const pipeError: PipeErrorOperator = (
  ...operations: OperatorFunction<any, any>[]
) =>
  isolatedPipeline(
    operations,
    (event) => isError(event),
    (event) => event.error,
    (error): ResponseError<unknown> => ({ state: errorSymbol, error }),
  );
