import {
  combineLatest,
  defer,
  distinctUntilChanged,
  finalize,
  map,
  Observable,
  of,
  OperatorFunction,
  share,
  startWith,
  takeUntil,
  takeWhile,
} from "rxjs";
import { errorWatcher, type WatchErrors } from "./errorWatcher";
import { fillStatefulObservable } from "./fillStatefulObservable";
import { catchResponseError } from "./operators";
import { errorEvent, isSuccess } from "./response-container";
import type {
  ResponseError,
  ResponseWithStatus,
  StatefulObservable,
} from "./types";

/**
 * What a projection shows for a value: a stateful source (with the removal of
 * its error watchers), or a value that needs no loading.
 */
export type Opened<Shown> =
  | {
      readonly source: StatefulObservable<Shown, unknown>;
      readonly release: () => void;
    }
  | { readonly value: Shown };

/** A value of the input with the signature of its keys. */
type Keyed<T> = { readonly item: T; readonly signature: string | undefined };

/** Values with the same keys; one whose keys could not be computed never. */
const sameKey = <T>(previous: Keyed<T>, next: Keyed<T>): boolean =>
  next.signature !== undefined && previous.signature === next.signature;

/**
 * `first` and the values after it, for as long as they keep its keys. They
 * are shown by the source opened for `first`, so what was loaded and the
 * value it is combined with always belong to the same keys.
 */
const sameKeys = <T>(
  values$: Observable<Keyed<T>>,
  first: Keyed<T>,
): Observable<T> =>
  first.signature === undefined
    ? of(first.item)
    : values$.pipe(
        takeWhile((next) => sameKey(first, next)),
        map((next) => next.item),
        startWith(first.item),
      );

/**
 * Skips a pair of the same event with another value when the output would
 * not change: the event is not a value, or nothing combines it with the value.
 */
const sameOutput =
  (combines: boolean) =>
  <E, T>(
    [previousEvent]: readonly [E, T],
    [nextEvent]: readonly [E, T],
  ): boolean =>
    previousEvent === nextEvent && (!combines || !isSuccess(nextEvent));

/** The result of `compute`, or an error event when it throws. */
const attempt = <T>(compute: () => T): T | ResponseError<unknown> => {
  try {
    return compute();
  } catch (error) {
    return errorEvent(error);
  }
};

/**
 * A stream that follows its input and shows, for each value, the source
 * `open` returns for it: the core of `factory.project` and
 * `factory.projectMany`.
 *
 * - A value with the same signature (its keys) as the current one opens
 *   nothing: `combine` runs again with the new value and what is shown. Values
 *   whose signature could not be computed (`undefined`) are never matched, so
 *   `open` gets them and turns the throw into an error event.
 * - `combine(shown, value)` computes the value from what was loaded for the
 *   value's keys and the value itself; a throw in it is an error event.
 *   Without it the value is what is shown.
 * - `switcher` moves between sources (`switchMap`, or `switchOverlapping` to
 *   keep what consecutive sources share).
 * - `reload()` reaches the source shown now. Error watchers added by `open`
 *   keep the shown nodes from reporting errors this stream's consumers read.
 * - Released when its last subscriber leaves; completed by `complete$`.
 */
export const projection = <Value, Shown, Result = never>(params: {
  readonly input: Observable<Value>;
  readonly signatureOf: (value: Value) => string | undefined;
  readonly open: (value: Value, watch: WatchErrors) => Opened<Shown>;
  readonly combine: ((shown: Shown, value: Value) => Result) | undefined;
  readonly switcher: <T, R>(
    project: (value: T) => Observable<R>,
  ) => OperatorFunction<T, R>;
  readonly complete$: Observable<void>;
  readonly name: string;
}): StatefulObservable<Result | Shown> => {
  const { combine } = params;
  const valueOf = (
    shown: Shown,
    value: Value,
  ): ResponseWithStatus<Result | Shown> =>
    combine ? attempt(() => combine(shown, value)) : shown;

  let current: StatefulObservable<Shown, unknown> | undefined;
  const { own, watch } = errorWatcher();

  // shared by the switch and the source shown now
  const values$ = params.input.pipe(
    map((item): Keyed<Value> => ({
      item,
      signature: params.signatureOf(item),
    })),
    share(),
  );

  const show = (
    first: Keyed<Value>,
  ): Observable<ResponseWithStatus<Result | Shown>> =>
    defer((): Observable<ResponseWithStatus<Result | Shown>> => {
      const following$ = sameKeys(values$, first);
      const opened = params.open(first.item, watch);
      if (!("source" in opened)) {
        current = undefined;
        return following$.pipe(map((value) => valueOf(opened.value, value)));
      }
      current = opened.source;
      return combineLatest([opened.source.raw$, following$]).pipe(
        distinctUntilChanged(sameOutput(combine !== undefined)),
        map(([event, value]) =>
          isSuccess(event) ? valueOf(event, value) : event,
        ),
        finalize(opened.release),
      );
    }).pipe(catchResponseError<ResponseWithStatus<Result | Shown>>());

  return fillStatefulObservable<Result | Shown, unknown>({
    raw: values$.pipe(
      distinctUntilChanged(sameKey),
      params.switcher(show),
      catchResponseError<ResponseWithStatus<Result | Shown>>(),
      takeUntil(params.complete$),
    ),
    name: params.name,
    internalMeta: [own],
    index: -1,
    reload: (options) => {
      current?.reload(options);
    },
    refCount: true,
  });
};
