import {
  MonoTypeOperatorFunction,
  Observable,
  Observer,
  OperatorFunction,
  Subject,
  Subscriber,
  Subscription,
  catchError,
  filter,
  finalize,
  identity,
  of,
  shareReplay,
  startWith,
  take,
} from "rxjs";
import {
  errorEvent,
  isError,
  isInactive,
  isLoading,
  isSuccess,
  loadingEvent,
} from "./response-container";
import {
  PipeErrorOperator,
  PipeRawOperator,
  PipeValueOperator,
  ResponseError,
  ResponseLoading,
} from "./types";

/** An observer that passes `error` and `complete` on to `subscriber`. */
export const forward = <T, R>(
  subscriber: Subscriber<R>,
  next: (value: T) => void,
): Observer<T> => ({
  next,
  error: (error: unknown) => subscriber.error(error),
  complete: () => subscriber.complete(),
});

/** Runs `run` on the first `false` of `active$`, then ends. */
export const onFirstInactive = (
  active$: Observable<boolean>,
  run: () => void,
): Subscription =>
  active$
    .pipe(
      filter((active) => !active),
      take(1),
    )
    .subscribe(run);

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
    const subscription = source.subscribe(
      forward(subscriber, (value) => {
        emitted = true;
        subscriber.next(value);
      }),
    );
    if (!emitted && !subscriber.closed) {
      subscriber.next(loadingEvent());
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
> => catchError((error: unknown) => of(errorEvent(error)));

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
> => startWith(loadingEvent());

/**
 * Wrapper for shareReplay with default parameters
 */
export const defaultCache = <T>(refCount = true): MonoTypeOperatorFunction<T> =>
  shareReplay({ bufferSize: 1, refCount });

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
 *
 * One subscriber at a time: a node is shared by `fillStatefulObservable`
 * (`shareReplay`), so the node itself does not multicast. A second concurrent
 * subscriber takes the node over.
 */
const isolatedPipeline =
  (
    operations: OperatorFunction<any, any>[],
    accept: (event: unknown) => boolean,
    extract: (event: any) => unknown,
    wrap: (output: any) => unknown,
  ) =>
  (raw: Observable<unknown>): Observable<any> => {
    // state of this node, kept across its subscriptions
    let consumer: Subscriber<unknown> | undefined;
    let feed: Subject<unknown> | undefined;
    let pipeline$: Observable<unknown> | undefined;
    let output: Subscription | undefined;
    let source: Subscription | undefined;
    let last: { readonly event: unknown } | undefined;
    // pipeline output is: 0 stale (a newer event passed by), 1 current,
    // 2 current and awaited (a fed event has no output yet)
    let route: 0 | 1 | 2 = 1;
    let sourceDone = false;
    // a loading that directly follows another is not sent again
    let lastWasLoading = false;

    const emit = (event: unknown) => {
      last = { event };
      const repeated = lastWasLoading;
      lastWasLoading = isLoading(event);
      if (!(lastWasLoading && repeated)) {
        consumer?.next(event);
      }
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
      route = 1;
      sourceDone = false;
      lastWasLoading = false;
    };

    // nobody listens and the operators let go of the feed: release upstream
    const releaseIfIdle = () => {
      if (source && !consumer && !feed?.observed) disconnect();
    };

    // the operators ended the stream (takeUntil, take, first, or the source
    // completed): complete the subscriber and release the source, as in
    // plain RxJS
    const finish = () => {
      consumer?.complete();
      disconnect();
    };

    const attach = () => {
      if (!pipeline$) return;
      output = pipeline$.subscribe({
        next: (value) => {
          if (route) {
            route = 1;
            emit(wrap(value));
          }
        },
        error: (error: unknown) => {
          if (route) {
            route = 1;
            emit(errorEvent(error));
          }
          // after the source completed nothing more can be fed: a rebuilt
          // pipeline would get a completed feed and may fail again (`last()`)
          if (sourceDone) finish();
          else build();
        },
        complete: finish,
      });
    };

    const build = () => {
      feed?.complete(); // lets operators of the previous pipeline go
      const current = new Subject<unknown>();
      feed = current;
      // an operator letting go of the feed may leave the node idle
      const held = current.pipe(finalize(releaseIfIdle));
      pipeline$ = operations.reduce<Observable<unknown>>(
        (piped, operation) => operation(piped),
        held,
      );
      output = undefined;
      if (consumer) attach();
      if (sourceDone) current.complete();
    };

    const onEvent = (event: unknown) => {
      if (isInactive(event)) {
        route = 0;
        output?.unsubscribe();
        build();
        emit(event);
        return;
      }
      if (accept(event)) {
        route = 2;
        feed?.next(extract(event));
        if (route === 2) emit(loadingEvent());
        return;
      }
      route = 0;
      emit(event);
    };

    const connect = () => {
      build();
      source = raw.subscribe({
        next: onEvent,
        error: (error: unknown) => consumer?.error(error),
        complete: () => {
          // the pipeline completes once its work is done, which completes
          // the subscribers (see attach)
          sourceDone = true;
          feed?.complete();
        },
      });
    };

    return new Observable<unknown>((subscriber) => {
      const before = last;
      consumer = subscriber;
      if (!source) {
        connect();
      } else {
        if (!output) {
          // coming back to a pipeline kept alive by its operators: the
          // subscriber has seen nothing yet
          lastWasLoading = false;
          attach();
        }
        // the latest state, unless attaching has just emitted a newer one
        if (before && last === before) {
          subscriber.next(before.event);
          lastWasLoading = isLoading(before.event);
        }
      }
      return () => {
        if (consumer !== subscriber) return; // taken over
        consumer = undefined;
        output?.unsubscribe();
        output = undefined;
        releaseIfIdle();
      };
    });
  };

export const pipeRaw: PipeRawOperator = (...operations) =>
  isolatedPipeline(operations, () => true, identity, identity);

export const pipeValue: PipeValueOperator = (
  ...operations: OperatorFunction<any, any>[]
) => isolatedPipeline(operations, isSuccess, identity, identity);

export const pipeError: PipeErrorOperator = (
  ...operations: OperatorFunction<any, any>[]
) => isolatedPipeline(operations, isError, (event) => event.error, errorEvent);

/**
 * Like `switchMap`, but the new inner stream is subscribed before the previous
 * one is unsubscribed, so what both share is never left without subscribers
 * (and is not released and loaded again). Only the newest inner stream's
 * events pass.
 */
export const switchOverlapping =
  <T, R>(project: (value: T) => Observable<R>) =>
  (source: Observable<T>): Observable<R> =>
    new Observable<R>((subscriber) => {
      let generation = 0;
      let inner: Subscription | undefined;
      let innerDone = true;
      let outerDone = false;
      const outer = source.subscribe({
        ...forward(subscriber, (value: T) => {
          const own = ++generation;
          const previous = inner;
          inner = undefined;
          innerDone = false;
          const next = project(value).subscribe({
            next: (result) => {
              if (own === generation) subscriber.next(result);
            },
            error: (error: unknown) => {
              if (own === generation) subscriber.error(error);
            },
            complete: () => {
              if (own !== generation) return;
              innerDone = true;
              if (outerDone) subscriber.complete();
            },
          });
          // a newer value may have arrived while subscribing
          if (own === generation) inner = next;
          else next.unsubscribe();
          previous?.unsubscribe();
        }),
        complete: () => {
          outerDone = true;
          if (innerDone) subscriber.complete();
        },
      });
      return () => {
        outer.unsubscribe();
        inner?.unsubscribe();
      };
    });
